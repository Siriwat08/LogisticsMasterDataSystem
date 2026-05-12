# 📐 Blueprint — Logistics Master Data System (LMDS)
> เอกสารออกแบบระบบฉบับสมบูรณ์ | Version 5.2.001-PH2

---

## สารบัญ

1. [วิสัยทัศน์และเป้าหมาย](#1-วิสัยทัศน์และเป้าหมาย)
2. [ปัญหาที่ระบบนี้แก้ไข](#2-ปัญหาที่ระบบนี้แก้ไข)
3. [สถาปัตยกรรมภาพรวม](#3-สถาปัตยกรรมภาพรวม)
4. [Entity Relationship Diagram](#4-entity-relationship-diagram)
5. [Module Blueprint](#5-module-blueprint)
6. [Matching Algorithm Design](#6-matching-algorithm-design)
7. [Cache Architecture](#7-cache-architecture)
8. [Data Lifecycle](#8-data-lifecycle)
9. [SYS_CONFIG Reference](#9-sys_config-reference)
10. [Security Model](#10-security-model)
11. [Performance Design](#11-performance-design)
12. [Scalability Roadmap](#12-scalability-roadmap)
13. [Decision Log](#13-decision-log)

---

## 1. วิสัยทัศน์และเป้าหมาย

### วิสัยทัศน์
> สร้างระบบที่รู้จัก "คนขับส่งของที่ไหน" แม่นยำขึ้นทุกครั้งที่ใช้งาน โดยไม่ต้องพึ่งการ Hardcode หรือ VLOOKUP แบบเดิม

### เป้าหมายหลัก 3 ข้อ

| # | เป้าหมาย | วัดผลด้วย |
|---|---|---|
| 1 | **Auto Match ≥ 80%** ของ Invoice ทั้งหมดโดยไม่ต้องแตะมือ | Match Rate ใน RPT_DATA_QUALITY |
| 2 | **พิกัดถูกต้อง** ทุกจุดส่งที่ผ่านระบบ ไม่ใช่พิกัดกลางถนน | distanceM < 50 เมตร จากจุดจริง |
| 3 | **ข้อมูลสะสม** ยิ่งใช้ยิ่งแม่น ผ่าน Alias Learning | usage_count เพิ่มขึ้นต่อเนื่อง |

### Non-Goals (สิ่งที่ระบบนี้ไม่ได้ทำ)
- ❌ ไม่ใช่ระบบ Routing/Navigation
- ❌ ไม่ใช่ระบบ Billing/Invoice
- ❌ ไม่ได้ Track สถานะการส่งแบบ Real-time
- ❌ ไม่ได้ Replace SAP/ERP ของ SCG

---

## 2. ปัญหาที่ระบบนี้แก้ไข

### ปัญหาก่อนมี LMDS

```
ข้อมูลดิบจาก Driver App:
"นาย สมชาย ใจดี COD โทรก่อนส่ง 081-234-5678"
  → ชื่อคนขับ? ชื่อลูกค้า? เบอร์ใคร?

"บจก.ไทวัสดุ รังสิต จก."
  → สถานที่เดียวกับ "ไทวัสดุ รังสิต" ไหม?

พิกัด: 13.9876, 100.5432
  → เคยไปที่นี่ก่อนไหม? ใครส่งบ้าง?
```

### ผลกระทบจากปัญหาเดิม

| ปัญหา | ผลกระทบ |
|---|---|
| ชื่อปลายทางสกปรก | VLOOKUP หาไม่เจอ → ต้อง Key มือทุกครั้ง |
| ไม่มีฐานพิกัดที่ verified | คนขับใช้พิกัดผิด → ส่งของผิดจุด |
| ข้อมูลไม่สะสม | ทุกวันต้องทำงานซ้ำจากศูนย์ |
| ไม่มี QA Process | ข้อมูลผิดพลาดไม่มีคนจับ |

### วิธีที่ LMDS แก้

```
"นาย สมชาย ใจดี COD โทรก่อนส่ง 081-234-5678"
          │
          ▼ normalizePersonNameFull()
    cleanName = "สมชาย ใจดี"
    phone     = "0812345678"
    notes     = ["COD", "โทรก่อนส่ง"]
          │
          ▼ resolvePerson() — ค้นหาใน M_PERSON
    ถ้าพบ → personId = "P001ABC..." (confidence 95%)
    ถ้าไม่พบ → CREATE_NEW → เพิ่มเข้า M_PERSON
          │
          ▼ ครั้งต่อไปที่เจอ "นายสมชาย ใจดี" หรือ "สมชาย"
    Match ได้ทันที → ไม่ต้อง Key ใหม่
```

---

## 3. สถาปัตยกรรมภาพรวม

### Layer Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  PRESENTATION LAYER                                             │
│  Google Sheets UI + Custom Menu (00_App.gs)                     │
│  ─────────────────────────────────────────────────────────────  │
│  ORCHESTRATION LAYER                                            │
│  Full Pipeline │ Match Engine │ Review Queue │ Report           │
│  ─────────────────────────────────────────────────────────────  │
│  SERVICE LAYER                                                  │
│  PersonService │ PlaceService │ GeoService │ DestinationService │
│  NormalizeService │ SearchService │ TransactionService          │
│  ─────────────────────────────────────────────────────────────  │
│  INFRASTRUCTURE LAYER                                           │
│  CacheService (RAM) │ Maps API │ SCG Web API │ PropertiesService│
│  ─────────────────────────────────────────────────────────────  │
│  DATA LAYER                                                     │
│  Google Sheets (Master/Fact/Queue/Config/Cache)                 │
└─────────────────────────────────────────────────────────────────┘
```

### Component Interaction Map

```
                    ┌─────────────┐
                    │  00_App.gs  │ ← onOpen / Menu
                    └──────┬──────┘
                           │ calls
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
   │04_SourceRepo│  │10_MatchEngine│  │18_ServiceSCG│
   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
          │                │                │
          ▼         ┌──────┼──────┐         ▼
   buildSourceObj   │      │      │   17_SearchService
                    ▼      ▼      ▼         │
               06_Person 07_Place 08_Geo    │
                    │      │      │         ▼
                    └──────┼──────┘   findBestGeoByPersonPlace
                           │
                    09_Destination
                           │
                    11_Transaction → FACT_DELIVERY
                           │
                    12_Review → Q_REVIEW (ถ้าไม่ชัวร์)
```

---

## 4. Entity Relationship Diagram

```
┌─────────────────┐         ┌─────────────────┐
│    M_PERSON     │         │    M_PLACE       │
│─────────────────│         │─────────────────│
│ PK person_id    │         │ PK place_id      │
│    canonical_name│        │    canonical_name │
│    normalized_name│       │    normalized_name│
│    phone        │         │    place_type     │
│    usage_count  │         │    province       │
│    record_status│         │    usage_count    │
└────────┬────────┘         └────────┬─────────┘
         │ 1                          │ 1
         │                            │
         │         ┌──────────────────┐
         │         │   M_GEO_POINT    │
         │         │──────────────────│
         │         │ PK geo_id        │
         │         │    lat / lng     │
         │         │    radius_m      │
         │         │    province      │
         │         │    usage_count   │
         │         └────────┬─────────┘
         │                  │ 1
         │ N                │ N                │ N
         └──────────────────┼──────────────────┘
                            │
                   ┌────────▼─────────┐
                   │  M_DESTINATION   │ ← Holy Trinity
                   │──────────────────│
                   │ PK dest_id       │
                   │ FK person_id     │
                   │ FK place_id      │
                   │ FK geo_id        │
                   │    lat / lng     │ ← พิกัดของแท้ 100%
                   │    usage_count   │
                   └────────┬─────────┘
                            │ 1
                            │ N
                   ┌────────▼─────────┐
                   │  FACT_DELIVERY   │ ← Transaction Log
                   │──────────────────│
                   │ PK tx_id         │
                   │ FK person_id     │
                   │ FK place_id      │
                   │ FK geo_id        │
                   │ FK destination_id│
                   │    invoice_no    │
                   │    match_status  │
                   │    match_conf    │
                   └──────────────────┘

┌─────────────────┐         ┌─────────────────┐
│  M_PERSON_ALIAS │         │  M_PLACE_ALIAS   │
│─────────────────│         │─────────────────│
│ PK alias_id     │         │ PK alias_id      │
│ FK person_id    │         │ FK place_id      │
│    alias_name   │         │    alias_name    │
│    match_score  │         │    match_score   │
│    active_flag  │         │    active_flag   │
└─────────────────┘         └─────────────────┘
(เรียนรู้จาก Review)        (เรียนรู้จาก Review)
```

---

## 5. Module Blueprint

### 04_SourceRepository — "ประตูทางเข้า"

```
ความรับผิดชอบ:
  1. อ่านข้อมูลดิบจากชีต Source
  2. แปลงแต่ละแถวเป็น srcObj มาตรฐาน
  3. กรองแถวที่ SYNC_STATUS = 'SUCCESS' ออก
  4. Cache Invoice ที่ผ่านแล้ว → ไม่ประมวลซ้ำ

srcObj Structure:
  {
    invoiceNo:      "IV001234"          ← Primary Key
    rawPersonName:  "นาย สมชาย ใจดี"   ← ชื่อปลายทาง (index 12)
    rawAddress:     "123 ถ.รัชดา..."   ← ที่อยู่ดิบ (index 18)
    resolvedAddr:   "ลาดยาว จตุจักร..."← จาก LatLong (index 24)
    bestAddress:    resolvedAddr || rawAddress
    rawLat:         13.8012             ← LAT จริง (index 14)
    rawLng:         100.5439            ← LONG จริง (index 15)
    hasGeo:         true/false
    driverName:     "สมศักดิ์ แข็งแรง" ← คนขับ (index 5)
    soldToName:     "SCG..."            ← เจ้าของสินค้า (index 11)
    warehouse:      "วังน้อย"           ← คลัง (index 17)
  }

Rules:
  [RULE 3] ห้าม hardcode index → ใช้ SRC_IDX เสมอ
  [RULE 6] อ่านทั้งชีตครั้งเดียว ไม่ getValue ในลูป
```

### 05_NormalizeService — "เครื่องล้างชื่อ"

```
Input:  "พ.ต.อ. สมชาย จก. ใจดี COD โทรก่อน 081-234-5678"
         │
         ├─ ขั้น 1: ดึงเบอร์โทรออก → "0812345678"
         ├─ ขั้น 2: ดึงเลขเอกสารออก
         ├─ ขั้น 3: ดึง Delivery Notes ออก → ["COD", "โทรก่อน"]
         ├─ ขั้น 4: ตรวจนิติบุคคล → isCompany = true ถ้าพบ
         ├─ ขั้น 5: ตัดคำนำหน้า (Greedy, เรียงยาวไปสั้น)
         └─ ขั้น 6: ล้างช่องว่างและอักขระพิเศษ
Output: cleanName = "สมชาย ใจดี"

Dictionary Design:
  PERSON_PREFIX_LIST  - sorted ยาวไปสั้น (pre-sort ครั้งเดียว)
  COMPANY_SUFFIX_LIST - sorted ยาวไปสั้น (pre-sort ครั้งเดียว)
  DELIVERY_NOTE_LIST  - keyword matching
  PHONE_PATTERN       - Regex pre-compiled
```

### 06_PersonService / 07_PlaceService — "นักสืบชื่อ"

```
Index Structure (O(1) lookup):
  ┌─────────────────────────────────────────────┐
  │ IDX_PERSON                                  │
  │  byPhone:          { "0812345678": ["P001"] }│
  │  byNorm:           { "สมชายใจดี": ["P001"] }│
  │  byPhonetic:       { "สมชย": ["P001","P002"]}│
  │  aliasToPersonIds: { "สมชาย": ["P001"] }    │
  └─────────────────────────────────────────────┘

Search Priority:
  1. Phone  → ถ้าตรง return ทันที (100% confident)
  2. Alias  → ถ้าตรง return (ใช้ชื่อที่เคยเจอก่อน)
  3. Norm   → ชื่อ normalized ตรง
  4. Phonetic → พยัญชนะคล้ายกัน
  5. Prefix  → 2 ตัวแรกตรง (fallback สุดท้าย)

Scoring (Person):
  ชื่อสั้น (< 4 ตัว): Levenshtein 60% + Dice 20% + Ratio 20%
  ชื่อยาว (≥ 4 ตัว): Dice 50% + Levenshtein 30% + Ratio 20%
  ถ้า score < 60 → return 0 (ไม่นับ)

Scoring (Place):
  Exact: 100%
  Dice 60% + Levenshtein 40%
  ถ้า score < 55 → return 0
  Branch Match: Chain Store + Province → 75-85%
```

### 08_GeoService — "ผู้เชี่ยวชาญพิกัด"

```
Grid Pre-filter Design:
  Grid Size: 0.01° ≈ 1.1 กม. ต่อ cell

  จุดค้นหา (13.75, 100.50)
  ↓
  สร้าง 9 Grid Keys รอบๆ (3×3):
  ┌─────┬─────┬─────┐
  │1374 │1374 │1375 │
  │_100 │_100 │_100 │
  │     │     │     │
  ├─────┼─────┼─────┤
  │1375 │1375 │1375 │
  │_100 │_100 │_101 │  ← ค้นเฉพาะ 9 ช่องนี้
  │     │  ★  │     │
  ├─────┼─────┼─────┤
  │1375 │1376 │1376 │
  │_101 │_101 │_101 │
  └─────┴─────┴─────┘
  ↓
  กรองเฉพาะ Geo ใน Grid ที่ตรง → Haversine บน subset เล็กๆ

Confidence Formula:
  confidence = 100 - ((distance / radius) × 30)
  ตัวอย่าง: distance=10m, radius=50m
  → confidence = 100 - (10/50 × 30) = 94%
  clamp: min 70%, max 100%
```

### 10_MatchEngine — "ผู้พิพากษา"

```
Decision Flow:

srcObj เข้ามา
    │
    ├─ resolvePerson() → personResult { status, confidence }
    ├─ resolvePlace()  → placeResult  { status, confidence }
    └─ resolveGeo()    → geoResult    { status, distanceM }
                │
                ▼
    ┌───────────────────────────────────────┐
    │  makeMatchDecision (8 Rules)          │
    │                                       │
    │  Rule 1: INVALID_LATLNG?  → REVIEW   │
    │  Rule 2: LOW_QUALITY?     → REVIEW   │
    │  Rule 3: GEO≠PLACE Prov? → REVIEW   │
    │  Rule 4: ✅ Geo+P+Pl     → AUTO_MATCH│ ← FULL_MATCH
    │  Rule 5: ✅ Geo+(P|Pl)   → AUTO_MATCH│ ← GEO_ANCHOR
    │  Rule 6: NEEDS_REVIEW?   → REVIEW   │
    │  Rule 7: ALL_NEW+GEO?    → CREATE   │
    │  Rule 7b: ALL_NEW-GEO?   → REVIEW   │
    │  Rule 8: DEFAULT         → CREATE   │
    └───────────────────────────────────────┘
                │
                ▼
    executeDecision()
    ├─ AUTO_MATCH → updateStats + findOrCreateDest
    ├─ CREATE_NEW → createPerson/Place/Geo/Dest
    └─ REVIEW     → enqueueReview → Q_REVIEW
                │
                ▼
    upsertFactDelivery() ← ทุกกรณี
```

### 17_SearchService — "สะพานเชื่อม Group 1 ↔ Group 2"

```
Input:  ShipToName, ShipToAddress, LatLong_SCG
         │
         ▼
    findBestGeoByPersonPlace()
    ├─ Tier A: Person+Place → FOUND (98%)
    ├─ Tier B: Place only   → FOUND_DOMINANT (85%)
    ├─ Tier C: Person only  → FOUND_FALLBACK (70%)
    ├─ Tier D: SCG API Lat  → SCG_API_FALLBACK (50%)
    └─ Tier E: Nothing      → NOT_FOUND (0%)

Output Color Coding ใน ตารางงานประจำวัน:
    🟢 FOUND / FOUND_DOMINANT → #b6d7a8 (เขียว)
    🟡 FOUND_FALLBACK         → #ffe599 (เหลือง)
    🔵 SCG_API_FALLBACK       → #cfe2f3 (ฟ้า)
    🔴 NOT_FOUND              → #f4cccc (แดง)

Memo Cache (ต่อรอบ):
    memoKey = normalizedPerson|normalizedPlace|scgLatLng
    → ถ้าคู่เดิม ใช้ผลเดิม ไม่ query ซ้ำ
```

---

## 6. Matching Algorithm Design

### Thai Phonetic Key

```javascript
buildThaiPhoneticKey("สมชาย") → "สมชย"
// ลบสระ: า ิ ี ึ ื ุ ู เ แ โ ใ ไ ็ ่ ้ ๊ ๋ ์ ํ
// เก็บเฉพาะพยัญชนะ 6 ตัวแรก

ใช้เป็น Pre-filter ก่อน Levenshtein:
"สมชาย" → "สมชย" → ค้นใน byPhonetic["สมชย"]
→ ได้ Candidate ≤ 20 คน → Levenshtein บน subset เล็ก
```

### Levenshtein Distance (Optimized)

```
แบบเดิม: Full Matrix O(n×m) memory
  "สมชาย" vs "สมชาย ใจดี"
  → Matrix 6×10 = 60 cells

แบบใหม่: Two-row DP O(m) memory
  prevRow = [0,1,2,3,4,5,6,7,8,9,10]
  currRow = [1,?,?,?,?,?,?,?,?,?,?]
  → ใช้แค่ 2 arrays × 11 = 22 cells (ประหยัด 63%)
```

### Dice Coefficient (Bigram)

```
"ไทวัสดุ" vs "ไทวัสดุ รังสิต"
Bigrams A: {ไท, ทว, วั, ัส, สด, ดุ}          = 6
Bigrams B: {ไท, ทว, วั, ัส, สด, ดุ, ุ , รั, ัง, งส, สิ, ิต} = 12
Intersection: 6
Dice = 2×6 / (6+12) = 0.667 → 67%

→ ต่ำกว่า AUTO threshold (90%) → ลอง Branch Match
→ พบ "ไทวัสดุ" ใน CHAIN_STORE_LIST → Branch Match!
```

### Confidence Composition (Rule 4)

```
กรณี AUTO_MATCH FULL_MATCH (Rule 4):
  confidence = (geo.conf × 0.5) + (person.conf × 0.3) + (place.conf × 0.2)

ตัวอย่าง:
  geo.confidence    = 94%  → 94 × 0.5 = 47.0
  person.confidence = 95%  → 95 × 0.3 = 28.5
  place.confidence  = 88%  → 88 × 0.2 = 17.6
                             Total     = 93.1% → AUTO_MATCH ✅

Weight Rationale:
  Geo 50%    ← พิกัดของแท้ หลักฐานทางกายภาพ
  Person 30% ← ชื่อคน สำคัญรองลงมา
  Place 20%  ← ชื่อสถานที่ อาจเปลี่ยนได้ (ร้านย้าย/เปลี่ยนชื่อ)
```

---

## 7. Cache Architecture

### 3-Tier Cache Design

```
┌─────────────────────────────────────────────────────────┐
│  TIER 1: Index Map (JavaScript Object in RAM)           │
│  TTL: ตลอด Execution (1 script run ≈ 6 นาที)          │
│  Size: ~few KB                                         │
│  Speed: O(1)                                           │
│  ข้อมูล: IDX_PERSON, IDX_PLACE, IDX_DEST              │
│                                                         │
│  Format: { byNorm: {"สมชาย": ["P001","P002"]} }       │
└────────────────────────────┬────────────────────────────┘
                             │ miss
┌────────────────────────────▼────────────────────────────┐
│  TIER 2: CacheService (RAM ของ Google Apps Script)      │
│  TTL: 6 ชั่วโมง (21,600 วินาที)                       │
│  Size: Max 100KB ต่อ key, Max 1MB รวม                  │
│  Speed: ~10ms                                          │
│  ข้อมูล: M_PERSON_ALL, M_PLACE_ALL, M_GEO_ALL         │
│           GEO_XXXX (Geocode results)                   │
└────────────────────────────┬────────────────────────────┘
                             │ miss
┌────────────────────────────▼────────────────────────────┐
│  TIER 3: MAPS_CACHE Sheet (Persistent ถาวร)            │
│  TTL: ไม่มี (จนกว่าจะ clearMapsCache())               │
│  Size: ไม่จำกัด (Sheets rows)                         │
│  Speed: ~200-500ms (Sheet read)                        │
│  ข้อมูล: Geocoding results เท่านั้น                   │
│  Upsert: ถ้า key ซ้ำ → update hit_count               │
└─────────────────────────────────────────────────────────┘
                             │ miss
                             ▼
                    Google Maps API (จริง)
                    บันทึกกลับ Tier 2+3
```

### Cache Key Design

```
Geocoding:    "GEO_"  + MD5(address.toLowerCase())
Reverse Geo:  "RGEO_" + MD5("lat,lng")
Person All:   "M_PERSON_ALL"
Person Index: "IDX_PERSON"
Place All:    "M_PLACE_ALL"
Place Index:  "IDX_PLACE"
Dest All:     "M_DEST_ALL"
Dest Index:   "IDX_DEST"
Geo All:      "M_GEO_ALL"
Config Map:   "SYS_CONFIG_MAP"
Fact Invoice: "FACT_INVOICE_SET"
Employee Map: "EMPLOYEE_EMAIL_MAP"
TH Geo Post:  "TH_GEO_POSTCODE"
TH Provinces: "TH_GEO_PROVINCES"
```

### Cache Invalidation Rules

| Event | Invalidate |
|---|---|
| createPerson / updatePersonStats | M_PERSON_ALL, IDX_PERSON |
| createPersonAlias | M_PERSON_ALIAS_ALL, IDX_PERSON |
| createPlace / updatePlaceStats | M_PLACE_ALL, IDX_PLACE |
| createPlaceAlias | M_PLACE_ALIAS_ALL, IDX_PLACE |
| createGeoPoint / updateGeoStats | M_GEO_ALL |
| createDestination / updateDestinationStats | M_DEST_ALL, IDX_DEST |
| buildGeoDictionary() | TH_GEO_POSTCODE, TH_GEO_PROVINCES |
| seedMissingPhase2Config_() | SYS_CONFIG_MAP |

---

## 8. Data Lifecycle

### วงจรชีวิตของ Invoice

```
ขั้น 1: INGESTION
  ชีต Source → buildSourceObj_() → srcObj
  ↓
  ข้าม ถ้า SYNC_STATUS = 'SUCCESS' หรือ Invoice อยู่ใน FACT แล้ว

ขั้น 2: NORMALIZATION
  srcObj.rawPersonName → normalizePersonNameFull()
  srcObj.bestAddress  → normalizePlaceName()

ขั้น 3: RESOLUTION
  resolvePerson(rawPersonName)  → personId (หรือ null)
  resolvePlace(bestAddress)     → placeId  (หรือ null)
  resolveGeo(rawLat, rawLng)    → geoId    (หรือ null)

ขั้น 4: DECISION
  makeMatchDecision() → { action, reason, confidence }

ขั้น 5: EXECUTION
  AUTO_MATCH → updateStats() + resolveDestination()
  CREATE_NEW → create*() functions
  REVIEW     → enqueueReview() → Q_REVIEW

ขั้น 6: TRANSACTION
  upsertFactDelivery() → FACT_DELIVERY (ทุกกรณี)

ขั้น 7: ENRICHMENT (Group 2)
  findBestGeoByPersonPlace() → LatLong_Actual
  loadEmployeeEmailMap()     → Email พนักงาน
```

### วงจรชีวิตของ Master Record

```
NEW RECORD:
  CREATE → record_status = 'Active' → usage_count = 1

MATCHED RECORD:
  updateStats() → last_seen = NOW, usage_count += 1

REVIEW → MERGE:
  applyReviewDecision('MERGE_TO_CANDIDATE')
  → createAlias(source_name → target_id)
  → updateStats(target_id)
  Source record ยังคงอยู่ ไม่ถูกลบ

DEPRECATED RECORD:
  record_status = 'Archived'
  → ถูก filter ออกจาก loadAll*()
  → ไม่ถูกลบ [RULE 4]

DUPLICATE RECORD:
  mergePersonRecords(sourceId → targetId)
  → source: record_status = 'Merged'
  → target: createAlias(sourceId)
  → ทั้งสองแถวยังอยู่ใน Sheet [RULE 4]
```

### Alias Learning Process

```
ครั้งที่ 1: ระบบเจอ "บจก.ไทวัสดุ รังสิต จก."
  → Normalize → "ไทวัสดุ รังสิต"
  → resolvePlace → NOT_FOUND
  → makeDecision → CREATE_NEW
  → createPlace("ไทวัสดุ รังสิต") → placeId = "PL001"

ครั้งที่ 2 (หลัง Review): Reviewer กด MERGE_TO_CANDIDATE
  → createPlaceAlias("PL001", "บจก.ไทวัสดุ รังสิต จก.", 75)
  → M_PLACE_ALIAS: ("ไทวัสดุ รังสิต จก" → "PL001")

ครั้งที่ 3 เป็นต้นไป: ระบบเจอ "บจก.ไทวัสดุ รังสิต จก." อีกครั้ง
  → Normalize → "ไทวัสดุ รังสิต"
  → loadPlaceIndex_() → aliasToPlaceIds["ไทวัสดุรังสิตจก"] = ["PL001"]
  → FOUND! ไม่ต้อง Review อีก ✅
```

---

## 9. SYS_CONFIG Reference

ค่า Config ทั้งหมดที่ปรับแต่งได้ใน `SYS_CONFIG`:

| Key | Default | หน่วย | คำอธิบาย |
|---|---|---|---|
| `PIPELINE_BATCH_LIMIT` | 50 | rows | จำนวนแถวต่อ Batch ใน MatchEngine |
| `GEO_RADIUS_M` | 50 | เมตร | รัศมี GPS Matching |
| `THRESHOLD_AUTO` | 90 | % | คะแนนขั้นต่ำ Auto Match |
| `THRESHOLD_REVIEW` | 70 | % | คะแนนขั้นต่ำส่ง Q_REVIEW |
| `THRESHOLD_IGNORE` | 50 | % | คะแนนต่ำกว่านี้ Ignore |
| `CACHE_TTL_SEC` | 21600 | วินาที | อายุ CacheService (6 ชม.) |
| `LOG_LEVEL` | INFO | enum | DEBUG / INFO / WARN / ERROR |
| `AI_MODEL` | gemini-1.5-flash | string | Gemini Model |
| `AI_BATCH_SIZE` | 20 | records | Records ต่อ Batch ส่ง AI |
| `SEARCH_WRITE_BATCH` | 200 | rows | Batch size สำหรับ setValues |
| `MAX_SHIPMENT_FETCH` | 200 | items | เพดาน Shipment ต่อการดึง API |
| `MAX_LOOKUP_ROWS` | 5000 | rows | เพดาน rows ต่อการ Enrich |
| `SCHEMA_VERSION` | 5.2.001 | string | Schema version ปัจจุบัน |
| `SYSTEM_VERSION` | 5.2.001-PH2 | string | App version ปัจจุบัน |

### การปรับ Threshold

```
Conservative (ปลอดภัย, Review เยอะ):
  THRESHOLD_AUTO   = 95
  THRESHOLD_REVIEW = 80
  → Auto Match น้อยลง แต่มั่นใจมากขึ้น

Aggressive (เร็ว, Review น้อย):
  THRESHOLD_AUTO   = 85
  THRESHOLD_REVIEW = 65
  → Auto Match มากขึ้น แต่อาจผิดพลาดบ้าง

แนะนำ Production (default):
  THRESHOLD_AUTO   = 90
  THRESHOLD_REVIEW = 70
```

---

## 10. Security Model

### API Key Management

```
❌ ห้าม:
  const API_KEY = "AIzaSyXXXXXXX"; // hardcode ในโค้ด

✅ ถูกต้อง:
  PropertiesService.getScriptProperties()
                   .setProperty('GEMINI_API_KEY', key);
  // ดึงใช้:
  const key = PropertiesService.getScriptProperties()
                               .getProperty('GEMINI_API_KEY');
```

### SCG Cookie Management

```
Cookie อยู่ใน:
  ชีต Input → Cell B1 (ไม่ได้ store ใน Script Properties)
  เพราะ Cookie หมดอายุบ่อย → User ต้อง refresh เอง

Validation ก่อนใช้:
  if (!cookie || cookie.length < 10) → alert + return

ไม่ Log Cookie ลง SYS_LOG:
  logInfo('SCG', `Fetching ${shipmentNos.length} shipments`)
  // ไม่รวม cookie value
```

### Script Lock

```
LockService.getScriptLock()
  ใช้ใน: fetchDataFromSCGJWD(), runMatchEngine()
  Timeout: 10,000 ms (APP_CONST.LOCK_TIMEOUT_MS)
  ป้องกัน: User กดปุ่มซ้ำ, Trigger ชนกัน
```

---

## 11. Performance Design

### Batch Read/Write Pattern

```
❌ Anti-pattern (ทำให้ช้า):
  for (let i = 0; i < 1000; i++) {
    sheet.getRange(i+2, 1).setValue(data[i]); // 1000 API calls!
  }

✅ LMDS Pattern:
  // อ่านครั้งเดียว
  const allData = sheet.getRange(2, 1, lastRow, colCount).getValues();

  // ประมวลผลใน Memory
  const results = allData.map(row => process(row));

  // เขียนครั้งเดียว (Chunk ถ้าใหญ่)
  chunkArray_(results, batchSize).forEach((chunk, i) => {
    sheet.getRange(2 + i*batchSize, col, chunk.length, 1)
         .setValues(chunk);
  });
```

### Time Complexity Summary

| Operation | Before PH2 | After PH2 | Improvement |
|---|---|---|---|
| Person Lookup | O(n) full scan | O(1) Index Map | ~1000× faster |
| Place Lookup | O(n) full scan | O(1) Index Map | ~500× faster |
| Geo Lookup | O(n) Haversine | O(k) Grid+Haversine | ~50× faster |
| Levenshtein | O(n×m) matrix | O(m) two-row | ~5× less memory |
| Email Map | O(n) per row | O(1) Map lookup | ~200× faster |

### Apps Script Quota Awareness

| Resource | Limit | LMDS Strategy |
|---|---|---|
| Maps API Geocode | 50 req/day (free) | Hybrid Cache ถาวร |
| Execution Time | 6 min | Time Guard + Checkpoint |
| CacheService | 1MB total | JSON.stringify ประหยัด |
| Sheet API calls | ไม่มีกำหนดแต่ช้า | Batch getValues/setValues |
| LockService | 1 lock per script | waitLock 10 วินาที |

---

## 12. Scalability Roadmap

### Phase ปัจจุบัน: Google Sheets (≤ 10,000 rows/เดือน)

```
✅ ทำงานได้ดีใน:
   - Shipment ≤ 200 รายการต่อครั้ง
   - M_PERSON ≤ 5,000 คน
   - M_PLACE  ≤ 3,000 สถานที่
   - M_GEO    ≤ 10,000 พิกัด

⚠️ เริ่มช้าเมื่อ:
   - FACT_DELIVERY > 50,000 แถว
   - M_PERSON > 10,000 คน (Cache overflow)
```

### Phase 2: Google Cloud Migration Path

```
เมื่อ Sheets ไม่พอ → ย้ายไป:

Google Sheets (ปัจจุบัน)
    │
    ▼ เมื่อ FACT_DELIVERY > 50K rows
BigQuery (Analytics Layer)
  - FACT_DELIVERY → BigQuery Table
  - RPT_DATA_QUALITY → BigQuery View
  - Query ด้วย SQL แทน getValues()

    │
    ▼ เมื่อ Master Data > 10K records
Firestore (Master Data Layer)
  - M_PERSON, M_PLACE, M_GEO → Firestore Collections
  - Real-time Index → ไม่ต้อง rebuild IDX_* ทุกรอบ

    │
    ▼ เมื่อต้องการ Real-time
Cloud Functions + Pub/Sub
  - Trigger เมื่อ Driver App บันทึกงาน
  - Process ทันทีไม่ต้องรอ Batch
```

### Migration Checklist (อนาคต)

```
□ Abstract Data Layer: แยก read/write ออกจาก Business Logic
  ✅ เริ่มทำแล้วใน v5.2 (loadAll*_() functions)

□ Unit Test: ทดสอบ Matching Logic โดยไม่ต้องใช้ Sheet
  🔲 ยังไม่ทำ

□ API Endpoint: Wrap ด้วย Apps Script Web App หรือ Cloud Run
  🔲 ยังไม่ทำ

□ Schema Migration Tool: รองรับการเปลี่ยน Schema โดยไม่ loss data
  ✅ มี PH2 Migration Helper แล้ว (บางส่วน)
```

---

## 13. Decision Log

บันทึกเหตุผลการตัดสินใจออกแบบสำคัญ:

### DEC-001: ทำไมใช้ Google Sheets แทน Database จริง

```
บริบท: ต้องการระบบที่ทีมโลจิสติกส์ใช้งานได้โดยไม่ต้องเรียนรู้เพิ่ม
ตัวเลือก: MySQL / PostgreSQL / Firestore / Google Sheets
เลือก: Google Sheets
เหตุผล:
  - ทีมคุ้นเคยกับ Sheets อยู่แล้ว
  - เปิดดู/แก้ไขได้โดยตรง ไม่ต้อง Query
  - Integration กับ Maps/Gmail/Drive ฟรีในตัว
  - ไม่มี Infrastructure ให้ดูแล
ข้อเสีย: Scale ได้จำกัด → มี Roadmap ย้ายไป Cloud
```

### DEC-002: ทำไมไม่ใช้ VLOOKUP

```
บริบท: เดิมใช้ VLOOKUP หา Destination จาก ShipToName
ปัญหา:
  - ชื่อสกปรก (มียศ/บจก./เบอร์โทร) → หาไม่เจอ
  - ไม่มี Fuzzy Match → ต่างแค่ space ก็พลาด
  - ไม่เรียนรู้ → ทุกวันยังต้อง Key ใหม่
เลือก: Match Engine + Alias Learning
เหตุผล: ยิ่งใช้ยิ่งแม่น (Self-improving)
```

### DEC-003: ทำไม Geo Weight 50% สูงกว่า Person/Place

```
บริบท: ออกแบบ Confidence Formula ใน Rule 4
เหตุผล:
  - พิกัด GPS เป็นหลักฐานทางกายภาพ ไม่ขึ้นกับการพิมพ์
  - ชื่อคนสามารถเขียนผิดได้หลายแบบ
  - ชื่อสถานที่เปลี่ยนได้ (ร้านย้าย/รีแบรนด์)
  - ในงานโลจิสติกส์ "ส่งถึงที่" สำคัญกว่า "ชื่อถูก"
```

### DEC-004: ทำไมไม่ลบข้อมูล Master เลย [RULE 4]

```
บริบท: จะทำอย่างไรกับ Record ที่ผิดพลาดหรือซ้ำ
เหตุผล:
  - FACT_DELIVERY อ้างอิง FK ไปยัง Master IDs
  - ถ้าลบ Master → FK Broken → ประวัติการส่งหาย
  - record_status = 'Archived' ทำให้ filter ออกได้โดยไม่ลบ
  - Audit Trail: สามารถย้อนดูได้ว่าเคยมีข้อมูลอะไร
```

### DEC-005: ทำไม resolvedAddr (index 24) น่าเชื่อถือกว่า rawAddress (index 18)

```
บริบท: ชีต Source มีที่อยู่ 2 แบบ
resolvedAddr (index 24) = "ชื่อที่อยู่จาก_LatLong"
  - ได้จาก Reverse Geocoding ของ Driver App
  - ตรงกับพิกัด GPS จริง
  - Format มาตรฐาน (จาก Google Maps)

rawAddress (index 18) = "ที่อยู่ปลายทาง"
  - พิมพ์โดยคนขับหรือ System
  - อาจสกปรก ย่อ ผิดพลาด

Strategy: ใช้ resolvedAddr เป็น primary, rawAddress เป็น fallback
```

---

*เอกสารนี้เป็น Living Document — อัปเดตเมื่อมีการเปลี่ยนแปลง Design*
*LMDS V5.2.001-PH2 | Schema 5.2.001 | © 2025 SCG-JWD Logistics Team*
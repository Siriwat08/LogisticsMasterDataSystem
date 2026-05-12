# 🚚 LMDS V5.2 — Logistics Master Data System

> **Production Hardening Phase 2** | Google Apps Script + Google Sheets  
> ระบบจัดการ Master Data และ Matching Engine สำหรับงานขนส่ง SCG-JWD

[![Version](https://img.shields.io/badge/version-5.2.001--PH2-blue)]()
[![Schema](https://img.shields.io/badge/schema-5.2.001-green)]()
[![Platform](https://img.shields.io/badge/platform-Google%20Apps%20Script-yellow)]()
[![License](https://img.shields.io/badge/license-Private-red)]()

---

## 📋 สารบัญ

1. [ภาพรวมระบบ](#1-ภาพรวมระบบ)
2. [สถาปัตยกรรม](#2-สถาปัตยกรรม)
3. [โครงสร้าง Module](#3-โครงสร้าง-module)
4. [โครงสร้างชีต (Sheet Schema)](#4-โครงสร้างชีต-sheet-schema)
5. [การติดตั้ง (Installation)](#5-การติดตั้ง-installation)
6. [การใช้งาน (Usage)](#6-การใช้งาน-usage)
7. [Data Flow](#7-data-flow)
8. [Matching Engine — 8 Rules](#8-matching-engine--8-rules)
9. [Hybrid Cache System](#9-hybrid-cache-system)
10. [Iron Rules (กฎห้ามละเมิด)](#10-iron-rules-กฎห้ามละเมิด)
11. [Changelog](#11-changelog)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. ภาพรวมระบบ

LMDS เป็นระบบ **Master Data Management (MDM)** ที่ทำงานบน Google Sheets + Google Apps Script โดยแบ่งเป็น 2 กลุ่มหลัก:

```
┌─────────────────────────────────────────────────────────┐
│  GROUP 1 — Master Data & Matching Engine                │
│  ข้อมูลดิบ (SCGนครหลวงJWDภูมิภาค)                      │
│      ↓ Normalize → Match → Decide → Execute             │
│  M_PERSON + M_PLACE + M_GEO_POINT → M_DESTINATION      │
│      ↓                                                  │
│  FACT_DELIVERY (Transaction Log)                        │
│      ↓ ถ้าไม่มั่นใจ                                    │
│  Q_REVIEW (Manual Review Queue)                         │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  GROUP 2 — Daily Operations (SCG-JWD)                  │
│  Input (Cookie + Shipment No.)                          │
│      ↓ fetchDataFromSCGJWD()                           │
│  ตารางงานประจำวัน                                       │
│      ↓ runLookupEnrichment()                           │
│  LatLong_Actual (พิกัดที่ verified แล้ว)               │
│      ↓                                                  │
│  สรุป_Shipment + สรุป_เจ้าของสินค้า                   │
└─────────────────────────────────────────────────────────┘
```

### จุดเด่นหลัก

| Feature | รายละเอียด |
|---|---|
| **Zero Data Loss** | ไม่มีการลบข้อมูล Master ใช้ `record_status = Archived/Merged` |
| **Hybrid Cache** | RAM Cache (6 ชม.) + Sheet Cache (ถาวร) + Index Map (O(1) lookup) |
| **Fuzzy Matching** | Levenshtein + Dice Coefficient + Thai Phonetic Key |
| **GPS Matching** | Haversine Distance + Grid Pre-filter (1.1 กม. per cell) |
| **Free Maps API** | ใช้ Apps Script Maps Service โควต้าฟรีรายวัน |
| **Concurrent-safe** | LockService ป้องกัน race condition |

---

## 2. สถาปัตยกรรม

```
┌──────────────────────────────────────────────────────────────────┐
│                        LMDS V5.2 Architecture                    │
│                                                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │ 00_App.gs   │    │ 01_Config.gs│    │  02_Schema.gs       │  │
│  │ Menu/Trigger│    │ Constants   │    │  Header Definitions │  │
│  └──────┬──────┘    └──────┬──────┘    └──────────┬──────────┘  │
│         │                 │ (SHEET, AI_CONFIG,     │             │
│         │                 │  SRC_IDX, etc.)        │             │
│         ▼                 ▼                        ▼             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   GROUP 1 PIPELINE                        │   │
│  │  04_SourceRepo → 05_Normalize → 06_Person → 07_Place     │   │
│  │       ↓               ↓             ↓           ↓        │   │
│  │  08_GeoService    09_Destination  10_MatchEngine         │   │
│  │       ↓               ↓             ↓                    │   │
│  │  11_Transaction   12_Review     13_Report                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   GROUP 2 PIPELINE                        │   │
│  │  18_ServiceSCG (fetch API) → 17_SearchService (lookup)   │   │
│  │       ↓                            ↓                     │   │
│  │  ตารางงานประจำวัน         LatLong_Actual (enriched)      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌────────────┐  ┌────────────────┐  ┌───────────────────────┐  │
│  │ 14_Utils   │  │ 15_GoogleMaps  │  │ 16_GeoDictionary      │  │
│  │ Helpers    │  │ Geocoding/Cache│  │ Province/Postcode Lookup│ │
│  └────────────┘  └────────────────┘  └───────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  03_SetupSheets (Create/Patch Sheets)                     │   │
│  │  19_Hardening   (Preflight Audit / Migration Helper)      │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. โครงสร้าง Module

| ไฟล์ | Version | หน้าที่ | แก้ใน PH2 |
|---|---|---|---|
| `00_App.gs` | v002 | Menu, onOpen, Full Pipeline | ✅ เพิ่มเมนูใหม่ |
| `01_Config.gs` | v002 | Sheet names, Column Index, Constants | ✅ แก้ SRC_IDX, EMPLOYEE_IDX |
| `02_Schema.gs` | v002 | Header Array ทุกชีต | ✅ แก้ SYS_TH_GEO, EMPLOYEE |
| `03_SetupSheets.gs` | v002 | สร้าง/Patch ชีต, Logging, Default Config | ✅ seed config ครบ |
| `04_SourceRepository.gs` | v002 | โหลดข้อมูลดิบจากชีต Source | ✅ แก้ buildSourceObj_ ทั้งหมด |
| `05_NormalizeService.gs` | v002 | ล้างชื่อบุคคล/สถานที่ภาษาไทย | ✅ pre-sort, regex guard |
| `06_PersonService.gs` | v002 | Match/Create/Alias M_PERSON | ✅ Index Map O(1) |
| `07_PlaceService.gs` | v002 | Match/Create/Alias M_PLACE | ✅ Index Map O(1) |
| `08_GeoService.gs` | v002 | GPS Match ด้วย Haversine + Grid | ✅ getCacheJson_ helper |
| `09_DestinationService.gs` | v002 | Holy Trinity: Person+Place+Geo | ✅ sort usageCount ครั้งเดียว |
| `10_MatchEngine.gs` | v002 | 8-Rule Decision Tree | ✅ แก้ Rule 5 confidence bug |
| `11_TransactionService.gs` | v002 | Upsert FACT_DELIVERY | ✅ guard getGeoLatLng_ |
| `12_ReviewService.gs` | v002 | Q_REVIEW: enqueue/apply/stats | ✅ Place Alias Learning |
| `13_ReportService.gs` | v002 | Data Quality Report | ✅ อ่าน 1 column |
| `14_Utils.gs` | v002 | Levenshtein, Dice, Haversine, Helpers | ✅ two-row DP, null guard |
| `15_GoogleMapsAPI.gs` | v002 | Geocode/Reverse/Cache | ✅ Upsert cache |
| `16_GeoDictionaryBuilder.gs` | v002 | Province/Postcode Lookup | ✅ แก้ TH_GEO_IDX ลำดับใหม่ |
| `17_SearchService.gs` | v002 | Bridge Group2→Group1 | ✅ แก้ Employee Email lookup |
| `18_ServiceSCG.gs` | v002 | Fetch SCG API, Summary | ✅ แก้ Summary schema จริง |
| `19_Hardening.gs` | v002 | Preflight Audit, Migration Helper | ✅ ตรวจ schema ครบ |

---

## 4. โครงสร้างชีต (Sheet Schema)

### กลุ่ม 1 — Master Data

#### `M_PERSON` (9 คอลัมน์)
| # | คอลัมน์ | ชนิด | รายละเอียด |
|---|---|---|---|
| 0 | `person_id` | String | UUID นำหน้า 'P' |
| 1 | `canonical_name` | String | ชื่อมาตรฐานที่ถูกต้อง |
| 2 | `normalized_name` | String | ชื่อหลังล้างคำ |
| 3 | `phone` | String | เบอร์โทร (นำหน้า `'`) |
| 4 | `first_seen` | Date | วันที่พบครั้งแรก |
| 5 | `last_seen` | Date | วันที่พบล่าสุด |
| 6 | `usage_count` | Number | จำนวนครั้งที่ถูกจับคู่ |
| 7 | `record_status` | String | Active / Archived / Merged |
| 8 | `note` | String | หมายเหตุ |

#### `M_PLACE` (13 คอลัมน์)
| # | คอลัมน์ | ชนิด | รายละเอียด |
|---|---|---|---|
| 0 | `place_id` | String | UUID นำหน้า 'PL' |
| 1 | `canonical_name` | String | ชื่อสถานที่มาตรฐาน |
| 2 | `normalized_name` | String | ชื่อหลังล้างคำ |
| 3 | `place_type` | String | condo / mall / house / site / other |
| 4 | `sub_district` | String | แขวง/ตำบล |
| 5 | `district` | String | เขต/อำเภอ |
| 6 | `province` | String | จังหวัด |
| 7 | `postcode` | String | รหัสไปรษณีย์ |
| 8–12 | ... | ... | first_seen, last_seen, usage_count, record_status, note |

#### `M_GEO_POINT` (13 คอลัมน์)
| # | คอลัมน์ | ชนิด | รายละเอียด |
|---|---|---|---|
| 0 | `geo_id` | String | UUID นำหน้า 'G' |
| 1 | `lat` | Number | Latitude |
| 2 | `lng` | Number | Longitude |
| 3 | `radius_m` | Number | รัศมี GPS Matching (default 50 ม.) |
| 4 | `resolved_address` | String | ที่อยู่จาก Reverse Geocode |
| 5 | `province` | String | จังหวัด |
| 6 | `district` | String | เขต/อำเภอ |
| 7 | `source` | String | driver / maps / manual |
| 8 | `coord_confidence` | Number | ความเชื่อมั่น 0-100 |

#### `M_DESTINATION` (11 คอลัมน์) — Holy Trinity
| # | คอลัมน์ | ชนิด | รายละเอียด |
|---|---|---|---|
| 0 | `dest_id` | String | UUID นำหน้า 'D' |
| 1 | `person_id` | String | FK → M_PERSON |
| 2 | `place_id` | String | FK → M_PLACE |
| 3 | `geo_id` | String | FK → M_GEO_POINT |
| 4 | `lat` | Number | Latitude ของแท้ 100% |
| 5 | `lng` | Number | Longitude ของแท้ 100% |
| 6–10 | ... | ... | route_label, delivery_date, usage_count, last_seen, record_status |

### กลุ่ม 1 — Transaction & Queue

#### `FACT_DELIVERY` (31 คอลัมน์)
Fact Table เก็บประวัติการส่งของทุกรายการ — **ห้ามลบ**

#### `Q_REVIEW` (23 คอลัมน์)
คิวรอตรวจสอบ Manual พร้อม Dropdown: `Pending / In_Review / Done / Escalated`

### กลุ่ม 1 — System

| ชีต | หน้าที่ |
|---|---|
| `SYS_CONFIG` | ค่า Config Key-Value (แก้ไขได้ที่นี่) |
| `SYS_LOG` | Log การทำงานทั้งหมด |
| `SYS_TH_GEO` | ฐานข้อมูลภูมิศาสตร์ไทย **ลำดับ: รหัสไปรษณีย์[A], แขวง[B], เขต[C], จังหวัด[D]** |
| `MAPS_CACHE` | Cache ผล Geocoding (ถาวร) |
| `RPT_DATA_QUALITY` | รายงาน Data Quality |

### กลุ่ม 2 — Daily Operations

#### `ตารางงานประจำวัน` (29 คอลัมน์)
คอลัมน์สำคัญ: `ShipToName[K]`, `ShipToAddress[L]`, `LatLong_SCG[M]`, `LatLong_Actual[AA]`

#### `ข้อมูลพนักงาน` (8 คอลัมน์) ⚠️ ลำดับสำคัญ
| # | คอลัมน์ |
|---|---|
| 0 | ID_พนักงาน |
| 1 | ชื่อ - นามสกุล ← ใช้ Match กับ DriverName |
| 2 | เบอร์โทรศัพท์ |
| 3 | เลขที่บัตรประชาชน |
| 4 | ทะเบียนรถ |
| 5 | เลือกประเภทรถยนต์ |
| **6** | **Email พนักงาน** ← field สำคัญ |
| 7 | ROLE |

#### `สรุป_Shipment` (7 คอลัมน์)
`ShipmentKey | ShipmentNo | TruckLicense | PlanDelivery | จำนวน_ทั้งหมด | จำนวน_E-POD_ทั้งหมด | LastUpdated`

#### `สรุป_เจ้าของสินค้า` (6 คอลัมน์)
`SummaryKey | SoldToName | PlanDelivery | จำนวน_ทั้งหมด | จำนวน_E-POD_ทั้งหมด | LastUpdated`

### ชีต Source — `SCGนครหลวงJWDภูมิภาค` (37 คอลัมน์)
คอลัมน์สำคัญที่ระบบใช้:

| Index | คอลัมน์ | หน้าที่ |
|---|---|---|
| 2 | วันที่ส่งสินค้า | deliveryDate |
| 5 | ชื่อ - นามสกุล | driverName (คนขับ) |
| 7 | Shipment No | shipmentNo |
| 8 | Invoice No | invoiceNo ← Primary Key |
| 11 | ชื่อเจ้าของสินค้า | soldToName |
| **12** | **ชื่อปลายทาง** | **rawPersonName** ← Match บุคคล |
| **14** | **LAT** | **rawLat** ← พิกัดของแท้ |
| **15** | **LONG** | **rawLng** ← พิกัดของแท้ |
| 17 | คลังสินค้า... | warehouse |
| **18** | **ที่อยู่ปลายทาง** | **rawAddress** ← Match สถานที่ |
| **24** | **ชื่อที่อยู่จาก_LatLong** | **resolvedAddr** ← น่าเชื่อถือกว่า |
| **36** | **SYNC_STATUS** | ข้ามถ้า = 'SUCCESS' |

---

## 5. การติดตั้ง (Installation)

### ข้อกำหนด
- Google Workspace Account (มี Maps Service)
- Google Sheets ที่มีชีตครบตามโครงสร้าง
- Gemini API Key (จาก [Google AI Studio](https://aistudio.google.com/app/apikey))

### ขั้นตอน

**1. เปิด Apps Script**
```
Google Sheets → Extensions → Apps Script
```

**2. วางไฟล์ทั้ง 20 ตัว**
```
00_App.gs  →  19_Hardening.gs
```
> ⚠️ ต้องวางทับทั้งหมด ไม่ใช่แค่ไฟล์ที่เปลี่ยน

**3. เปิดใช้งาน Maps Service**
```
Apps Script Editor → Services (ไอคอน +) → Maps → Add
```

**4. ตั้งค่า API Key**
```
เมนู LMDS → ระบบ → ⚙️ ตั้งค่า API Key → ใส่ Gemini API Key
```

**5. รัน Migration**
```
เมนู LMDS → ระบบ → 🚀 PH2 Migration Helper
```

**6. Import ข้อมูลภูมิศาสตร์**
```
นำข้อมูล จังหวัด/อำเภอ/ตำบล/ไปรษณีย์ วางลงชีต SYS_TH_GEO
ลำดับคอลัมน์: รหัสไปรษณีย์ | แขวง/ตำบล | เขต/อำเภอ | จังหวัด | หมายเหตุ
จากนั้น: เมนู LMDS → ระบบ → 🗺️ สร้าง Geo Dictionary
```

**7. ตรวจสอบก่อนใช้งาน**
```
เมนู LMDS → ระบบ → 🔬 ตรวจ Schema Integrity
เมนู LMDS → ระบบ → 🛡️ PH2 Preflight Audit   ← ต้องไม่มี ❌
```

---

## 6. การใช้งาน (Usage)

### กลุ่ม 1 — สร้าง Master Data

```
เมนู 🟩 กลุ่ม 1 → ▶️ รัน Full Pipeline (ทั้งหมด)
```
หรือรันทีละ Step:
```
Step 1 — โหลดข้อมูลดิบจากแหล่ง    (runLoadSource)
Step 2 — Normalize ชื่อ/ที่อยู่    (runNormalize)
Step 3 — Match Engine               (runMatchEngine)
```
หลังรันเสร็จ → ตรวจ Q_REVIEW:
```
เมนู 🟩 กลุ่ม 1 → 📋 เปิด Review Queue
→ ตั้ง Status = In_Review, เลือก Decision
→ เมนู 🟩 → ✅ ประมวลผล Review ที่ตัดสินแล้ว
```

### กลุ่ม 2 — งานประจำวัน

```
1. เปิดชีต Input
2. วาง Cookie ใน Cell B1
3. วาง Shipment No. ตั้งแต่ A4 ลงมา (หรือ B3 เป็น comma-separated)
4. เมนู 🟦 กลุ่ม 2 → 📥 ดึงข้อมูล SCG API
5. เมนู 🟦 กลุ่ม 2 → 📍 จับคู่พิกัด (LatLong_Actual)
```

### ความหมายสีใน `ตารางงานประจำวัน`
| สี | Status | ความหมาย |
|---|---|---|
| 🟢 เขียว | FOUND / FOUND_DOMINANT | เจอพิกัดจาก Master Data ตรงแน่ |
| 🟡 เหลือง | FOUND_FALLBACK | เจอพิกัดแบบ Fallback (บุคคลเดิม ไม่แน่ใจ Place) |
| 🔵 ฟ้า | SCG_API_FALLBACK | ใช้พิกัดจาก SCG API (ยังไม่ Verified) |
| 🔴 แดง | NOT_FOUND | ไม่พบข้อมูลในระบบ ต้องตรวจสอบ |

---

## 7. Data Flow

```
ชีต Source (SCGนครหลวงJWDภูมิภาค)
    │
    ▼ 04_SourceRepository.buildSourceObj_()
    │  ├─ invoiceNo        (index 8)
    │  ├─ rawPersonName    (index 12) ← ชื่อปลายทาง
    │  ├─ rawLat/rawLng    (index 14/15)
    │  ├─ rawAddress       (index 18)
    │  └─ resolvedAddr     (index 24) ← ชื่อที่อยู่จาก LatLong
    │
    ▼ 05_NormalizeService
    │  ├─ normalizePersonNameFull() → cleanName, isCompany, phone
    │  └─ normalizePlaceName()     → cleanPlace, placeType
    │
    ▼ 06/07/08 Services
    │  ├─ resolvePerson()  → personId + confidence
    │  ├─ resolvePlace()   → placeId + confidence
    │  └─ resolveGeo()     → geoId + distanceM
    │
    ▼ 10_MatchEngine.makeMatchDecision()
    │  ├─ AUTO_MATCH  → updateStats + createDestination
    │  ├─ CREATE_NEW  → createPerson/Place/Geo/Destination
    │  └─ REVIEW      → enqueueReview()
    │
    ▼ 11_TransactionService.upsertFactDelivery()
    └─ FACT_DELIVERY (บันทึกทุกกรณี)
```

---

## 8. Matching Engine — 8 Rules

| Rule | เงื่อนไข | Action | Priority |
|---|---|---|---|
| 1 | พิกัดไม่ถูกต้อง (INVALID/OUT_OF_BOUNDS) | REVIEW | 1 |
| 2 | ชื่อคุณภาพต่ำ (< 2 ตัวอักษร) | REVIEW | 2 |
| 3 | Province ของ Geo ≠ Province ของ Place | REVIEW | 2 |
| 4 | ✅ ครบ Trinity (Geo+Person+Place) | AUTO_MATCH (FULL) | 0 |
| 5 | ✅ Geo + (Person หรือ Place) | AUTO_MATCH (GEO_ANCHOR) | 0 |
| 6 | มี Candidate แต่ Score อยู่ใน Review Zone | REVIEW | 2 |
| 7 | ใหม่ทั้งหมด + มีพิกัด | CREATE_NEW | 0 |
| 7b | ใหม่ทั้งหมด + ไม่มีพิกัด | REVIEW | 3 |
| 8 | Default | CREATE_NEW | 1 |

### Confidence Threshold

```
≥ 90%  →  Auto Match ทันที
70-89% →  ส่ง Q_REVIEW
< 50%  →  Ignore (ไม่นำมาเป็น Candidate)
```

---

## 9. Hybrid Cache System

```
Request มา
    │
    ▼ ชั้น 1: RAM Cache (CacheService 6 ชม.)
    │  เร็วที่สุด — O(1) lookup
    │  ถ้าพบ → return ทันที
    │
    ▼ ชั้น 2: Index Map Cache
    │  byPhone / byNorm / byPhonetic / aliasToIds
    │  สร้างครั้งเดียวตอน load — O(1) lookup
    │  ถ้าพบ → return ทันที
    │
    ▼ ชั้น 3: Sheet Cache MAPS_CACHE (ถาวร)
    │  เฉพาะ Geocoding — จำตลอดไป
    │  ถ้าพบ → อัปเดต hit_count + return
    │
    ▼ ชั้น 4: API / Sheet Query จริง
       Maps API / getValues()
       บันทึกกลับไปชั้น 1+3
```

---

## 10. Iron Rules (กฎห้ามละเมิด)

```
[RULE 1] MODULE VERSIONING
         ทุกไฟล์ที่แก้ไขต้องเพิ่ม VERSION (NNN+1)

[RULE 2] COLUMN PRESERVATION
         ห้ามขยับ Column ที่มีอยู่
         เพิ่มได้เฉพาะต่อท้ายเท่านั้น

[RULE 3] SOURCE OF TRUTH
         อ้างอิง INDEX จาก 01_Config.gs เสมอ
         ห้าม Hardcode ตัวเลข Column ในโค้ด

[RULE 4] ZERO DATA LOSS
         ห้าม clearContent() / deleteRow() กับ Master
         ใช้ record_status = 'Archived' / 'Merged' แทน

[RULE 5] SECURITY
         API Key ต้องดึงจาก PropertiesService เท่านั้น
         ห้าม Hardcode ใน Source Code

[RULE 6] BATCH OPERATIONS
         ใช้ getValues() / setValues() เสมอ
         ห้าม getValue/setValue ใน Loop

[RULE 7] ERROR ISOLATION
         ใช้ try-catch ในทุก service function
         Log เสร็จก่อน throw ต่อ
```

---

## 11. Changelog

### v5.2.001-PH2 (Production Hardening Phase 2)

**🔴 Critical Bug Fixes**
- แก้ `SRC_IDX` ทั้งชุดให้ตรงกับชีต Source จริง (37 คอลัมน์)
- แก้ `TH_GEO_IDX` ลำดับคอลัมน์: รหัสไปรษณีย์[0]→จังหวัด[3]
- แก้ `EMPLOYEE_IDX` จาก 5 คอลัมน์ → 8 คอลัมน์จริง (Email อยู่ index 6)
- แก้ `SCHEMA.OWNER_SUMMARY` / `SCHEMA.SHIPMENT_SUM` ชื่อคอลัมน์จริง

**🟡 Logic Fixes**
- `processOneRow`: ส่ง `bestAddress` (resolvedAddr) แทน rawAddress เข้า `resolvePlace`
- `makeMatchDecision` Rule 5: แก้ confidence overflow กรณีบางส่วนเป็น 0
- `applyReviewDecision`: เพิ่ม Place Alias Learning (เดิมมีแค่ Person)
- `enqueueReview`: บันทึก `resolvedAddr` ลง `RAW_GEO_ADDR` ด้วย

**🟢 Performance**
- `levenshteinDistance`: two-row DP O(m) แทน full matrix O(n×m)
- `PERSON_PREFIX_LIST` / `COMPANY_SUFFIX_LIST`: pre-sort ครั้งเดียว
- `getReviewStats`: อ่าน 1 column แทนทั้งชีต
- `findFactRowByInvoice_`: อ่าน 1 column แทนทั้งแถว
- Regex: pre-compile ไว้นอก function

**🔵 New Features**
- `runSchemaIntegrityCheck()`: ทดสอบ Schema End-to-End
- `buildGeoDictionary()`: เพิ่มในเมนูระบบ
- `parseLatLngCombined_()`: Parse "จุดส่งสินค้าปลายทาง" แบบ robust
- Skip row ที่ `SYNC_STATUS = 'SUCCESS'` อัตโนมัติ
- Employee Email map เพิ่ม key จาก ทะเบียนรถ ด้วย

### v5.1.000-PH1 (Baseline Refactor)
- แก้ THRESHOLD_IGNORE = 50
- เพิ่ม SCG API URL จาก Script Properties
- อัปเกรด validateSheetHeaders ให้รายงาน orderMismatch

---

## 12. Troubleshooting

### ❌ "ไม่พบชีต SCGนครหลวงJWDภูมิภาค"
ตรวจสอบชื่อชีตให้ตรงทุกตัวอักษร รวมถึงชื่อภาษาไทย

### ❌ lookupByPostcode คืนค่า null ทั้งหมด
SYS_TH_GEO ลำดับคอลัมน์ผิด — ตรวจว่า **คอลัมน์ A = รหัสไปรษณีย์** แล้วรัน `buildGeoDictionary()` ใหม่

### ❌ Email พนักงานไม่ถูกเติม
ตรวจว่า ชีต `ข้อมูลพนักงาน` มี **Email พนักงาน ที่คอลัมน์ G (index 6)**  
รัน `runSchemaIntegrityCheck()` เพื่อยืนยัน

### ❌ Match Rate = 0% ทั้งหมด
ตรวจ `SRC_IDX` ว่า LAT อยู่ที่ index 14 และ LONG ที่ index 15  
รัน `runSchemaIntegrityCheck()` → ดูค่า LAT/LONG ของแถว 2

### ⚠️ "Service invoked too many times"
Maps API หมดโควต้ารายวัน — รอ 24 ชั่วโมง หรือตรวจ `MAPS_CACHE` ว่ามีข้อมูลซ้ำไหม  
รัน `PH2 Migration Helper` เพื่อ dedupe MAPS_CACHE

### ⚠️ Pipeline ช้ามากกว่า 15 นาที
ลด `PIPELINE_BATCH_LIMIT` และ `MAX_LOOKUP_ROWS` ใน SYS_CONFIG  
หรือรัน Full Pipeline เป็นหลาย Session (ระบบมี Checkpoint)

### ❌ Q_REVIEW Dropdown หายไป
รัน Setup > สร้างชีตทั้งหมด → ระบบจะ Patch dropdown อัตโนมัติ

---

## 📞 Support

| ช่องทาง | รายละเอียด |
|---|---|
| GitHub | [kamonwantanakun-svg/lmds_v5](https://github.com/kamonwantanakun-svg/lmds_v5_) |
| Issue Tracker | ใช้ GitHub Issues พร้อมแนบ SYS_LOG และ Error Message |

---

*เอกสารนี้อัปเดตล่าสุด: LMDS V5.2.001-PH2 · Schema 5.2.001*
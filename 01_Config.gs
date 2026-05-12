/**
 * VERSION: 003
 * FILE: 01_Config.gs
 * LMDS V5.0 — System Configuration
 * ===================================================
 * CHANGELOG v003 (Round 1 — Critical Fixes):
 *   - [ADD] SCORE_MIN_THRESHOLD: 60 (แทน hardcode ใน Module 06)
 *   - [ADD] PLACE_SCORE_MIN: 55    (แทน hardcode ใน Module 07)
 *   - [FIX] TH_GEO_IDX ลำดับถูกต้องตามชีตจริง
 *           (เดิมผิด: sub_district[0] → ถูก: postcode[0])
 *   - [FIX] EMPLOYEE_IDX เพิ่มเป็น 8 คอลัมน์ตามชีตจริง
 *   - [FIX] REVIEW_IDX.RAW_LNG ยืนยัน index 11 ถูกต้อง
 * ===================================================
 */

const SCHEMA_VERSION = '1.1.0'; // เพิ่มเมื่อแก้ SYS_TH_GEO + EMPLOYEE schema

// ============================================================
// SECTION 1: ชื่อชีตทั้งหมด
// ============================================================

const SHEET = Object.freeze({
  M_PERSON:       'M_PERSON',
  M_PERSON_ALIAS: 'M_PERSON_ALIAS',
  M_PLACE:        'M_PLACE',
  M_PLACE_ALIAS:  'M_PLACE_ALIAS',
  M_GEO_POINT:    'M_GEO_POINT',
  M_DESTINATION:  'M_DESTINATION',
  FACT_DELIVERY:  'FACT_DELIVERY',
  Q_REVIEW:       'Q_REVIEW',
  SOURCE:         'SCGนครหลวงJWDภูมิภาค',
  SYS_CONFIG:     'SYS_CONFIG',
  SYS_LOG:        'SYS_LOG',
  SYS_TH_GEO:     'SYS_TH_GEO',
  RPT_QUALITY:    'RPT_DATA_QUALITY',
  MAPS_CACHE:     'MAPS_CACHE',
  DAILY_JOB:      'ตารางงานประจำวัน',
  INPUT:          'Input',
  EMPLOYEE:       'ข้อมูลพนักงาน',
  OWNER_SUMMARY:  'สรุป_เจ้าของสินค้า',
  SHIPMENT_SUM:   'สรุป_Shipment',
});

// ============================================================
// SECTION 2: Column Index (0-based) — Master Tables
// [RULE 2] ห้ามขยับลำดับ
// ============================================================

const PERSON_IDX = Object.freeze({
  PERSON_ID:   0,
  CANONICAL:   1,
  NORMALIZED:  2,
  PHONE:       3,
  FIRST_SEEN:  4,
  LAST_SEEN:   5,
  USAGE_COUNT: 6,
  STATUS:      7,
  NOTE:        8,
});

const PERSON_ALIAS_IDX = Object.freeze({
  ALIAS_ID:    0,
  PERSON_ID:   1,
  ALIAS_NAME:  2,
  MATCH_SCORE: 3,
  CREATED_AT:  4,
  ACTIVE_FLAG: 5,
});

const PLACE_IDX = Object.freeze({
  PLACE_ID:     0,
  CANONICAL:    1,
  NORMALIZED:   2,
  PLACE_TYPE:   3,
  SUB_DISTRICT: 4,
  DISTRICT:     5,
  PROVINCE:     6,
  POSTCODE:     7,
  FIRST_SEEN:   8,
  LAST_SEEN:    9,
  USAGE_COUNT:  10,
  STATUS:       11,
  NOTE:         12,
});

const PLACE_ALIAS_IDX = Object.freeze({
  ALIAS_ID:    0,
  PLACE_ID:    1,
  ALIAS_NAME:  2,
  MATCH_SCORE: 3,
  CREATED_AT:  4,
  ACTIVE_FLAG: 5,
});

const GEO_IDX = Object.freeze({
  GEO_ID:        0,
  LAT:           1,
  LNG:           2,
  RADIUS_M:      3,
  RESOLVED_ADDR: 4,
  PROVINCE:      5,
  DISTRICT:      6,
  SOURCE:        7,
  CONFIDENCE:    8,
  FIRST_SEEN:    9,
  LAST_SEEN:     10,
  USAGE_COUNT:   11,
  STATUS:        12,
});

const DEST_IDX = Object.freeze({
  DEST_ID:       0,
  PERSON_ID:     1,
  PLACE_ID:      2,
  GEO_ID:        3,
  LAT:           4,
  LNG:           5,
  ROUTE_LABEL:   6,
  DELIVERY_DATE: 7,
  USAGE_COUNT:   8,
  LAST_SEEN:     9,
  STATUS:        10,
});

const FACT_IDX = Object.freeze({
  TX_ID:         0,
  SOURCE_SHEET:  1,
  SOURCE_ROW:    2,
  SOURCE_REC_ID: 3,
  DELIVERY_DATE: 4,  // ✅ Bug Fix: เดิม index 2
  DELIVERY_TIME: 5,
  INVOICE_NO:    6,
  SHIPMENT_NO:   7,
  DRIVER_NAME:   8,
  TRUCK_LICENSE: 9,
  CARRIER_CODE:  10,
  CARRIER_NAME:  11,
  SOLD_TO_CODE:  12,
  SOLD_TO_NAME:  13,
  SHIP_TO_NAME:  14,
  PERSON_ID:     15,
  PLACE_ID:      16,
  GEO_ID:        17,  // ✅ Bug Fix: เดิม index 5
  DEST_ID:       18,
  WAREHOUSE:     19,
  RAW_LAT:       20,
  RAW_LNG:       21,
  MATCH_STATUS:  22,
  MATCH_CONF:    23,
  MATCH_REASON:  24,
  MATCH_ACTION:  25,
  RESOLVED_LAT:  26,
  RESOLVED_LNG:  27,
  CREATED_AT:    28,
  UPDATED_AT:    29,
  RECORD_STATUS: 30,
});

const REVIEW_IDX = Object.freeze({
  REVIEW_ID:     0,
  ISSUE_TYPE:    1,
  PRIORITY:      2,
  SOURCE_REC_ID: 3,
  SOURCE_ROW:    4,
  INVOICE_NO:    5,
  RAW_PERSON:    6,
  RAW_PLACE:     7,
  RAW_SYS_ADDR:  8,
  RAW_GEO_ADDR:  9,
  RAW_LAT:       10,
  RAW_LNG:       11,  // ✅ Fix: raw_lng (ไม่ใช่ raw_long)
  CAND_PERSONS:  12,
  CAND_PLACES:   13,
  CAND_GEOS:     14,
  CAND_DESTS:    15,
  MATCH_SCORE:   16,
  RECOMMEND:     17,
  STATUS:        18,
  REVIEWER:      19,
  REVIEWED_AT:   20,
  DECISION:      21,
  NOTE:          22,
});

// ============================================================
// SECTION 3: SYS_TH_GEO Index
// [FIX v003] ลำดับถูกต้องตามชีตจริง (เดิมผิดทั้งหมด)
// ชีตจริง: รหัสไปรษณีย์[0], แขวง/ตำบล[1], เขต/อำเภอ[2], จังหวัด[3], หมายเหตุ[4]
// ============================================================

const TH_GEO_IDX = Object.freeze({
  POSTCODE:     0,  // รหัสไปรษณีย์ ← เดิมเป็น[3] ผิด
  SUB_DISTRICT: 1,  // แขวง/ตำบล   ← เดิมเป็น[0] ผิด
  DISTRICT:     2,  // เขต/อำเภอ   ← เดิมเป็น[1] ผิด
  PROVINCE:     3,  // จังหวัด     ← เดิมเป็น[2] ผิด
  NOTE:         4,  // หมายเหตุ    ← เดิมเป็น REGION ผิด
});

// ============================================================
// SECTION 4: ข้อมูลพนักงาน Index
// [FIX v003] เพิ่มเป็น 8 คอลัมน์ตามชีตจริง (เดิม 5 คอลัมน์ผิด)
// ============================================================

const EMPLOYEE_IDX = Object.freeze({
  EMP_ID:       0,  // ID_พนักงาน
  FULL_NAME:    1,  // ชื่อ - นามสกุล
  PHONE:        2,  // เบอร์โทรศัพท์
  NATIONAL_ID:  3,  // เลขที่บัตรประชาชน
  TRUCK_LIC:    4,  // ทะเบียนรถ
  TRUCK_TYPE:   5,  // เลือกประเภทรถยนต์
  EMAIL:        6,  // Email พนักงาน
  ROLE:         7,  // ROLE
});

// ============================================================
// SECTION 5: SCG Source Sheet Index (SRC_IDX)
// [FIX v003] ถูกต้องตามชีต SCGนครหลวงJWDภูมิภาค จริง
// ============================================================

const SRC_IDX = Object.freeze({
  ROW_ID:          0,   // head / ลำดับ
  SOURCE_ID:       1,   // ID_SCGนครหลวงJWDภูมิภาค
  DELIVERY_DATE:   2,   // วันที่ส่งสินค้า
  DELIVERY_TIME:   3,   // เวลาที่ส่งสินค้า
  LATLNG_COMBINED: 4,   // จุดส่งสินค้าปลายทาง (lat,lng รวม)
  DRIVER_NAME:     5,   // ชื่อ - นามสกุล (คนขับ)
  TRUCK_LICENSE:   6,   // ทะเบียนรถ
  SHIPMENT_NO:     7,   // Shipment No
  INVOICE_NO:      8,   // Invoice No
  BILL_PHOTO:      9,   // รูปถ่ายบิลส่งสินค้า
  CUSTOMER_CODE:   10,  // รหัสลูกค้า
  SOLD_TO_NAME:    11,  // ชื่อเจ้าของสินค้า (บริษัทผู้ขาย)
  RAW_PERSON_NAME: 12,  // ชื่อปลายทาง ← rawPersonName (สกปรก)
  EMPLOYEE_EMAIL:  13,  // Email พนักงาน
  LAT:             14,  // LAT ← lat จริง 100%
  LNG:             15,  // LONG ← lng จริง 100%
  DOC_RETURN_ID:   16,  // ID_Doc_Return
  WAREHOUSE:       17,  // คลังสินค้า
  RAW_ADDRESS:     18,  // ที่อยู่ปลายทาง ← rawAddress (สกปรก)
  PHOTO_PRODUCT:   19,  // รูปสินค้าตอนส่ง
  PHOTO_STORE:     20,  // รูปหน้าร้าน/บ้าน
  REMARK:          21,  // หมายเหตุ
  MONTH:           22,  // เดือน
  DIST_FROM_WH:    23,  // ระยะทางจากคลัง_Km
  RESOLVED_ADDR:   24,  // ชื่อที่อยู่จาก_LatLong ← rawPlaceName (สะอาด)
  SM_LINK:         25,  // SM_Link_SCG
  EMPLOYEE_ID:     26,  // ID_พนักงาน
  GPS_ON_SUBMIT:   27,  // พิกัดตอนกดบันทึกงาน
  TIME_START:      28,  // เวลาเริ่มกรอกงาน
  TIME_DONE:       29,  // เวลาบันทึกงานสำเร็จ
  MOVE_DIST_M:     30,  // ระยะขยับจากจุดเริ่มต้น_เมตร
  WORK_MIN:        31,  // ระยะเวลาใช้งาน_นาที
  SPEED_MPM:       32,  // ความเร็วการเคลื่อนที่_เมตร_นาที
  QC_RESULT:       33,  // ผลการตรวจสอบงานส่ง
  QC_ISSUE:        34,  // เหตุผิดปกติที่ตรวจพบ
  PHOTO_TIME:      35,  // เวลาถ่ายรูปหน้าร้าน_หน้าบ้าน
  SYNC_STATUS:     36,  // SYNC_STATUS ← เช็คก่อน process
});

// ============================================================
// SECTION 6: ตารางงานประจำวัน Index
// [PRESERVED] ห้ามขยับ — ตรงกับชีตจริง 100%
// ============================================================

const DATA_IDX = Object.freeze({
  JOB_ID:          0,
  PLAN_DELIVERY:   1,
  INVOICE_NO:      2,
  SHIPMENT_NO:     3,
  DRIVER_NAME:     4,
  TRUCK_LICENSE:   5,
  CARRIER_CODE:    6,
  CARRIER_NAME:    7,
  SOLD_TO_CODE:    8,
  SOLD_TO_NAME:    9,
  SHIP_TO_NAME:    10,
  SHIP_TO_ADDR:    11,
  LATLNG_SCG:      12,
  MATERIAL:        13,
  QTY:             14,
  QTY_UNIT:        15,
  WEIGHT:          16,
  DELIVERY_NO:     17,
  DEST_COUNT:      18,
  DEST_LIST:       19,
  SCAN_STATUS:     20,
  DELIVERY_STATUS: 21,
  EMAIL:           22,
  TOT_QTY:         23,
  TOT_WEIGHT:      24,
  SCAN_INV:        25,
  LATLNG_ACTUAL:   26,
  OWNER_LABEL:     27,
  SHOP_KEY:        28,
});

// ============================================================
// SECTION 7: SCG Config
// ============================================================

const SCG_CONFIG = Object.freeze({
  SHEET_DATA:           SHEET.DAILY_JOB,
  SHEET_INPUT:          SHEET.INPUT,
  SHEET_EMPLOYEE:       SHEET.EMPLOYEE,
  // [ADD v002] Fallback จาก PropertiesService
  get API_URL() {
    return PropertiesService.getScriptProperties()
                            .getProperty('SCG_API_URL')
           || 'https://fsm.scgjwd.com/Monitor/SearchDelivery';
  },
  INPUT_START_ROW:      4,    // Shipment No เริ่มแถว 4
  COOKIE_CELL:          'B1', // Cookie อยู่ที่ B1
  SHIPMENT_STRING_CELL: 'B3', // ShipmentNos string อยู่ที่ B3
  GPS_THRESHOLD_METERS: 50,
  // ค่า SYNC_STATUS ที่ถือว่าประมวลผลแล้ว
  SYNC_DONE_VALUE:      'SUCCESS',
});

// ============================================================
// SECTION 8: AI & Matching Config
// [FIX v002] THRESHOLD_IGNORE: 70→50
// [ADD v003] SCORE_MIN_THRESHOLD, PLACE_SCORE_MIN
// ============================================================

const AI_CONFIG = Object.freeze({
  THRESHOLD_AUTO:       90,  // >= 90 → Auto Match
  THRESHOLD_REVIEW:     70,  // 70-89 → Q_REVIEW
  THRESHOLD_IGNORE:     50,  // < 50  → ไม่พิจารณา (Fix v002)
  SCORE_MIN_THRESHOLD:  60,  // [ADD v003] min score สำหรับ Person (แทน hardcode)
  PLACE_SCORE_MIN:      55,  // [ADD v003] min score สำหรับ Place (แทน hardcode)
  MODEL:                'gemini-1.5-flash',
  BATCH_SIZE:           20,
  RETRIEVAL_LIMIT:      50,
  CACHE_TTL_SEC:        21600,
  GEO_RADIUS_M:         50,
});

// ============================================================
// SECTION 9: App Constants
// ============================================================

const APP_CONST = Object.freeze({
  STATUS_ACTIVE:   'Active',
  STATUS_ARCHIVED: 'Archived',
  STATUS_MERGED:   'Merged',

  COLOR_FOUND:     '#b6d7a8',
  COLOR_FALLBACK:  '#ffe599',
  COLOR_NOT_FOUND: '#f4cccc',
  COLOR_BRANCH:    '#cfe2f3',

  MAX_RETRIES:     3,
  LOCK_TIMEOUT_MS: 10000,
  PIPELINE_BATCH:  50,

  MATCH_FULL:   'FULL_MATCH',
  MATCH_GEO:    'GEO_ANCHOR',
  MATCH_FUZZY:  'FUZZY_MATCH',
  MATCH_NEW:    'CREATE_NEW',
  MATCH_REVIEW: 'NEEDS_REVIEW',
  MATCH_ERROR:  'ERROR',
});

// ============================================================
// SECTION 10: validateConfig
// ============================================================

/**
 * validateConfig — ตรวจสอบค่า Config สำคัญก่อนใช้งาน
 * เรียกจาก onOpen() ใน 00_App.gs
 */
function validateConfig() {
  if (AI_CONFIG.THRESHOLD_AUTO <= AI_CONFIG.THRESHOLD_REVIEW) {
    throw new Error(
      'Config ผิด: THRESHOLD_AUTO ต้องมากกว่า THRESHOLD_REVIEW\n' +
      `AUTO=${AI_CONFIG.THRESHOLD_AUTO}, REVIEW=${AI_CONFIG.THRESHOLD_REVIEW}`
    );
  }
  if (AI_CONFIG.THRESHOLD_REVIEW <= AI_CONFIG.THRESHOLD_IGNORE) {
    throw new Error(
      'Config ผิด: THRESHOLD_REVIEW ต้องมากกว่า THRESHOLD_IGNORE\n' +
      `REVIEW=${AI_CONFIG.THRESHOLD_REVIEW}, IGNORE=${AI_CONFIG.THRESHOLD_IGNORE}`
    );
  }
  // ตรวจ Schema vs IDX (ถ้า SCHEMA โหลดแล้ว)
  if (typeof SCHEMA !== 'undefined') {
    const checks = [
      { name: SHEET.M_PERSON,      idx: PERSON_IDX,  label: 'M_PERSON'      },
      { name: SHEET.M_PLACE,       idx: PLACE_IDX,   label: 'M_PLACE'       },
      { name: SHEET.M_GEO_POINT,   idx: GEO_IDX,     label: 'M_GEO_POINT'   },
      { name: SHEET.M_DESTINATION, idx: DEST_IDX,    label: 'M_DESTINATION' },
      { name: SHEET.FACT_DELIVERY, idx: FACT_IDX,    label: 'FACT_DELIVERY' },
      { name: SHEET.Q_REVIEW,      idx: REVIEW_IDX,  label: 'Q_REVIEW'      },
    ];
    checks.forEach(item => {
      const schemaArr = SCHEMA[item.name];
      if (!schemaArr) return;
      const idxLen = Object.keys(item.idx).length;
      if (schemaArr.length !== idxLen) {
        throw new Error(
          `Schema Mismatch: ${item.label}\n` +
          `  SCHEMA.length=${schemaArr.length} IDX.keys=${idxLen}`
        );
      }
    });
  }
  logInfo('Config', `validateConfig ผ่าน — Schema v${SCHEMA_VERSION}`);
}

// ============================================================
// SECTION 11: API Key Helper
// ============================================================

/**
 * getGeminiApiKey — ดึง API Key จาก PropertiesService
 * [RULE 5] ห้าม Hardcode
 */
function getGeminiApiKey() {
  const key = PropertiesService.getScriptProperties()
                               .getProperty('GEMINI_API_KEY');
  if (!key || key.length < 20) {
    throw new Error(
      'GEMINI_API_KEY ยังไม่ได้ตั้งค่า\n' +
      'กรุณารัน เมนู LMDS > ระบบ > ตั้งค่า API Key ก่อน'
    );
  }
  return key;
}

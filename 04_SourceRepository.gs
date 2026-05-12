/**
 * VERSION: 003
 * FILE: 04_SourceRepository.gs
 * LMDS V5.0 — Source Data Repository
 * ===================================================
 * CHANGELOG v003 (Round 1 — Critical Fixes):
 *   - [FIX] SRC_IDX ทั้งหมด ตามชีตจริง SCGนครหลวงJWDภูมิภาค
 *   - [FIX] buildSourceObj_: เพิ่ม rawPlaceName แยกจาก rawAddress
 *   - [FIX] buildSourceObj_: NaN guard สำหรับ lat/lng
 *   - [FIX] buildSourceObj_: parse LATLNG_COMBINED เป็น fallback
 *   - [FIX] processSrcBatch_: แยก try-catch ระดับ row
 *   - [FIX] runLoadSource: loaded++ หลัง process สำเร็จ
 *   - [ADD] SYNC_STATUS check — ข้าม row ที่ประมวลผลแล้ว
 *   - [ADD] logWarn เมื่อ Cache เต็ม
 *   - [FIX] อ่านแค่คอลัมน์ที่จำเป็น
 * ===================================================
 */

// ============================================================
// SECTION 1: Constants
// ============================================================

// Cache key สำหรับ Source data
const CACHE_KEY_SOURCE   = 'SOURCE_ROWS_V3';
const CACHE_KEY_INVOICES = 'PROCESSED_INVOICES_V3';

// จำนวน columns ที่ต้องอ่านจากชีต Source
// SRC_IDX.SYNC_STATUS = 36 → ต้องอ่าน 37 columns
const SRC_READ_COLS = 37;

// ============================================================
// SECTION 2: Entry Point
// ============================================================

/**
 * runLoadSource — โหลดข้อมูลดิบจากชีต Source
 * เรียกจาก runFullPipeline() หรือ Menu
 */
function runLoadSource() {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const srcSheet = ss.getSheetByName(SHEET.SOURCE);

  if (!srcSheet) {
    logError('SourceRepo', `ไม่พบชีต: ${SHEET.SOURCE}`);
    throw new Error(`ไม่พบชีต "${SHEET.SOURCE}" กรุณาตรวจสอบชื่อชีต`);
  }

  const totalRows = srcSheet.getLastRow();
  if (totalRows < 2) {
    logWarn('SourceRepo', 'ไม่มีข้อมูลในชีต Source');
    return;
  }

  logInfo('SourceRepo', `เริ่มโหลด Source — ${totalRows - 1} แถว`);
  invalidateSourceCache();

  // [RULE 6] อ่านทั้งหมดครั้งเดียว — อ่านแค่คอลัมน์จำเป็น
  const colsToRead = Math.min(SRC_READ_COLS, srcSheet.getLastColumn());
  const allRows    = srcSheet.getRange(2, 1, totalRows - 1, colsToRead)
                             .getValues();

  // โหลด Invoice ที่ประมวลผลแล้ว
  const doneSet   = getProcessedInvoiceSet_();

  let processed   = 0;
  let skipped     = 0;
  let synced      = 0;
  let batchRows   = [];

  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];

    // ข้ามแถวที่ Invoice ว่าง
    if (!row[SRC_IDX.INVOICE_NO]) {
      skipped++;
      continue;
    }

    // [ADD v003] ข้าม row ที่ SYNC_STATUS = SUCCESS แล้ว
    const syncStatus = String(row[SRC_IDX.SYNC_STATUS] || '').trim();
    if (syncStatus === SCG_CONFIG.SYNC_DONE_VALUE) {
      synced++;
      continue;
    }

    const invoiceNo = String(row[SRC_IDX.INVOICE_NO]).trim();

    // ข้าม Invoice ที่มีใน FACT แล้ว
    if (doneSet.has(invoiceNo)) {
      skipped++;
      continue;
    }

    const srcObj = buildSourceObj_(row, i + 2);
    batchRows.push(srcObj);

    if (batchRows.length >= AI_CONFIG.BATCH_SIZE * 5) {
      // [FIX v003] นับ processed หลัง batch จริง
      processed += processSrcBatch_(batchRows);
      batchRows = [];
    }
  }

  if (batchRows.length > 0) {
    processed += processSrcBatch_(batchRows);
  }

  logInfo('SourceRepo',
    `โหลด Source เสร็จ — ประมวลผล:${processed} ` +
    `ข้าม:${skipped} Synced:${synced}`);
}

// ============================================================
// SECTION 3: ดึงข้อมูล Source
// ============================================================

/**
 * getAllSourceRows — คืน Array ของ Source Objects ทั้งหมด
 * [RULE 6] CacheService ลด Read ซ้ำ
 */
function getAllSourceRows() {
  const cache  = CacheService.getScriptCache();
  const cached = cache.get(CACHE_KEY_SOURCE);

  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const srcSheet = ss.getSheetByName(SHEET.SOURCE);
  if (!srcSheet || srcSheet.getLastRow() < 2) return [];

  const colsToRead = Math.min(SRC_READ_COLS, srcSheet.getLastColumn());
  const totalRows  = srcSheet.getLastRow() - 1;
  const allData    = srcSheet.getRange(2, 1, totalRows, colsToRead)
                             .getValues();

  const result = allData
    .filter(row => row[SRC_IDX.INVOICE_NO])
    .filter(row => {
      const sync = String(row[SRC_IDX.SYNC_STATUS] || '').trim();
      return sync !== SCG_CONFIG.SYNC_DONE_VALUE;
    })
    .map((row, i) => buildSourceObj_(row, i + 2));

  // [FIX v003] logWarn เมื่อ Cache เต็ม
  try {
    cache.put(CACHE_KEY_SOURCE, JSON.stringify(result), AI_CONFIG.CACHE_TTL_SEC);
  } catch (e) {
    logWarn('SourceRepo', 'Cache เต็ม — ข้อมูล Source ใหญ่เกินกว่าจะ Cache ได้');
  }

  return result;
}

/**
 * getUnprocessedRows — ดึงเฉพาะแถวที่ยังไม่ผ่าน Match Engine
 */
function getUnprocessedRows() {
  const allRows = getAllSourceRows();
  if (allRows.length === 0) return [];
  const doneSet = getProcessedInvoiceSet_();
  return allRows.filter(row => !doneSet.has(row.invoiceNo));
}

/**
 * getProcessedInvoiceSet_ — อ่าน Invoice ที่มีใน FACT_DELIVERY แล้ว
 */
function getProcessedInvoiceSet_() {
  const cache    = CacheService.getScriptCache();
  const cached   = cache.get(CACHE_KEY_INVOICES);
  if (cached) {
    try { return new Set(JSON.parse(cached)); } catch (e) {}
  }

  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const factSheet = ss.getSheetByName(SHEET.FACT_DELIVERY);
  const doneSet   = new Set();

  if (!factSheet || factSheet.getLastRow() < 2) return doneSet;

  const invoiceCol  = FACT_IDX.INVOICE_NO + 1;
  const lastRow     = factSheet.getLastRow() - 1;
  const invoiceData = factSheet.getRange(2, invoiceCol, lastRow, 1)
                               .getValues();

  invoiceData.forEach(r => {
    if (r[0]) doneSet.add(String(r[0]).trim());
  });

  try {
    cache.put(CACHE_KEY_INVOICES, JSON.stringify([...doneSet]),
              AI_CONFIG.CACHE_TTL_SEC);
  } catch (e) {}

  return doneSet;
}

// ============================================================
// SECTION 4: Builder
// ============================================================

/**
 * buildSourceObj_ — แปลง Row Array เป็น Source Object
 * [FIX v003] SRC_IDX ถูกต้องตามชีตจริง
 * [FIX v003] เพิ่ม rawPlaceName field
 * [FIX v003] NaN guard สำหรับ lat/lng
 * [FIX v003] parse LATLNG_COMBINED เป็น fallback
 *
 * @param {Array} row    - ข้อมูลหนึ่งแถวจากชีต Source
 * @param {number} rowNum - หมายเลขแถวใน Sheet (เริ่มจาก 2)
 */
function buildSourceObj_(row, rowNum) {
  // --- parse lat/lng จาก column LAT/LNG โดยตรง ---
  const rawLatNum = Number(row[SRC_IDX.LAT]);
  const rawLngNum = Number(row[SRC_IDX.LNG]);

  // [FIX v003] NaN guard — ต้องเป็นตัวเลขจริงและไม่ใช่ 0 ทั้งคู่
  let rawLat = (!isNaN(rawLatNum) && rawLatNum !== 0) ? rawLatNum : 0;
  let rawLng = (!isNaN(rawLngNum) && rawLngNum !== 0) ? rawLngNum : 0;

  // [ADD v003] ถ้า LAT/LNG ว่าง ลอง parse จาก LATLNG_COMBINED (col 4)
  // รูปแบบ "13.xxxxxx,100.xxxxxx"
  if (rawLat === 0 || rawLng === 0) {
    const combined = String(row[SRC_IDX.LATLNG_COMBINED] || '').trim();
    if (combined) {
      const parsed = parseLatLng(combined);
      if (parsed && isValidLatLng(parsed.lat, parsed.lng)) {
        rawLat = parsed.lat;
        rawLng = parsed.lng;
      }
    }
  }

  const hasGeo = !isNaN(rawLat) && !isNaN(rawLng) &&
                 rawLat !== 0    && rawLng !== 0;

  // [ADD v003] rawPlaceName = ชื่อที่อยู่จาก_LatLong (สะอาดกว่า rawAddress)
  // ถ้าไม่มี fallback ไปใช้ rawAddress
  const resolvedAddr = String(row[SRC_IDX.RESOLVED_ADDR] || '').trim();
  const rawAddr      = String(row[SRC_IDX.RAW_ADDRESS]   || '').trim();
  const rawPlaceName = resolvedAddr || rawAddr;

  // deliveryDate — แปลงเป็น ISO String ก่อนเก็บ (ป้องกัน Date พัง JSON)
  let deliveryDate = '';
  if (row[SRC_IDX.DELIVERY_DATE]) {
    try {
      deliveryDate = new Date(row[SRC_IDX.DELIVERY_DATE]).toISOString();
    } catch (e) {
      deliveryDate = String(row[SRC_IDX.DELIVERY_DATE]);
    }
  }

  return {
    sourceSheet:     SHEET.SOURCE,
    sourceRow:       rowNum,
    invoiceNo:       String(row[SRC_IDX.INVOICE_NO]      || '').trim(),
    shipmentNo:      String(row[SRC_IDX.SHIPMENT_NO]     || '').trim(),
    deliveryDate:    deliveryDate,
    deliveryTime:    String(row[SRC_IDX.DELIVERY_TIME]   || '').trim(),
    driverName:      String(row[SRC_IDX.DRIVER_NAME]     || '').trim(),
    truckLicense:    String(row[SRC_IDX.TRUCK_LICENSE]   || '').trim(),
    carrierCode:     '',
    carrierName:     String(row[SRC_IDX.SOLD_TO_NAME]    || '').trim(),
    soldToCode:      String(row[SRC_IDX.CUSTOMER_CODE]   || '').trim(),
    soldToName:      String(row[SRC_IDX.SOLD_TO_NAME]    || '').trim(),
    rawPersonName:   String(row[SRC_IDX.RAW_PERSON_NAME] || '').trim(),
    rawPlaceName:    rawPlaceName,   // [ADD v003] ชื่อสถานที่ (clean)
    rawAddress:      rawAddr,        // ที่อยู่ดิบ (สกปรก)
    rawLat:          rawLat,
    rawLng:          rawLng,
    hasGeo:          hasGeo,
    warehouse:       String(row[SRC_IDX.WAREHOUSE]       || '').trim(),
    province:        '',  // ดึงจาก Reverse Geocode ภายหลัง
    sourceId:        String(row[SRC_IDX.SOURCE_ID]       || '').trim(),
    remark:          String(row[SRC_IDX.REMARK]          || '').trim(),
  };
}

// ============================================================
// SECTION 5: Batch Processor
// ============================================================

/**
 * processSrcBatch_ — ส่ง Source Batch เข้า Match Engine
 * [FIX v003] แยก try-catch ระดับ row ป้องกัน data loss เงียบ
 * @return {number} จำนวน row ที่ประมวลผลสำเร็จ
 */
function processSrcBatch_(batch) {
  let successCount = 0;
  batch.forEach(srcObj => {
    try {
      processOneRow(srcObj);
      successCount++;
    } catch (err) {
      // [FIX v003] log ทีละ row แทน catch ทั้ง batch
      logError('SourceRepo',
        `processSrcBatch_ แถว ${srcObj.sourceRow} ` +
        `Invoice:${srcObj.invoiceNo} — ${err.message}`);
    }
  });
  return successCount;
}

// ============================================================
// SECTION 6: Cache Management
// ============================================================

/** invalidateSourceCache — ล้าง Cache ของ Source */
function invalidateSourceCache() {
  const cache = CacheService.getScriptCache();
  cache.remove(CACHE_KEY_SOURCE);
  cache.remove(CACHE_KEY_INVOICES);
}

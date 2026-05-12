/**
 * VERSION: 003
 * FILE: 11_TransactionService.gs
 * LMDS V5.0 — Transaction (FACT_DELIVERY) Service
 * ===================================================
 * CHANGELOG v003 (Round 1 — Critical Fixes):
 *   - [FIX] getGeoLatLng_: คืน null แทน {lat:0,lng:0}
 *   - [FIX] upsertFactDelivery: เรียก getGeoLatLng_ ครั้งเดียว
 *   - [FIX] upsertFactDelivery: fallback ไปใช้ srcObj.rawLat/rawLng
 *   - [FIX] findFactRowByInvoice_: extract targetInvoice นอก loop
 * ===================================================
 */

// ============================================================
// SECTION 1: upsertFactDelivery
// ============================================================

/**
 * upsertFactDelivery — สร้างหรืออัปเดต FACT_DELIVERY
 * [FIX v003] เรียก getGeoLatLng_ ครั้งเดียว + fallback to rawLat/rawLng
 */
function upsertFactDelivery(srcObj, personId, placeId, geoId, destId, decision) {
  const ss         = SpreadsheetApp.getActiveSpreadsheet();
  const factSheet  = ss.getSheetByName(SHEET.FACT_DELIVERY);
  if (!factSheet) {
    logError('TransactionService', `ไม่พบชีต ${SHEET.FACT_DELIVERY}`);
    return null;
  }

  const existingRow = findFactRowByInvoice_(factSheet, srcObj.invoiceNo);
  const now         = new Date();
  const txId        = existingRow > 0 ? null : generateShortId('TX');

  // [FIX v003] เรียก getGeoLatLng_ ครั้งเดียว แล้ว destructure
  let resolvedLat = 0;
  let resolvedLng = 0;

  if (geoId) {
    const geoLL = getGeoLatLng_(geoId);
    if (geoLL) {
      resolvedLat = geoLL.lat;
      resolvedLng = geoLL.lng;
    }
  }

  // [FIX v003] fallback → rawLat/rawLng ถ้า getGeoLatLng_ คืน null
  if (resolvedLat === 0 || resolvedLng === 0) {
    if (srcObj.rawLat && srcObj.rawLng &&
        !isNaN(Number(srcObj.rawLat)) && !isNaN(Number(srcObj.rawLng))) {
      resolvedLat = Number(srcObj.rawLat);
      resolvedLng = Number(srcObj.rawLng);
    }
  }

  // แยก deliveryDate/deliveryTime
  let deliveryDateVal = '';
  let deliveryTimeVal = srcObj.deliveryTime || '';

  if (srcObj.deliveryDate) {
    try {
      deliveryDateVal = new Date(srcObj.deliveryDate);
    } catch (e) {
      deliveryDateVal = srcObj.deliveryDate;
    }
  }

  if (existingRow > 0) {
    // --- UPDATE ---
    const rowRange = factSheet.getRange(existingRow, 1, 1,
                      SCHEMA[SHEET.FACT_DELIVERY].length);
    const rowData  = rowRange.getValues()[0];

    rowData[FACT_IDX.PERSON_ID]    = personId  || rowData[FACT_IDX.PERSON_ID];
    rowData[FACT_IDX.PLACE_ID]     = placeId   || rowData[FACT_IDX.PLACE_ID];
    rowData[FACT_IDX.GEO_ID]       = geoId     || rowData[FACT_IDX.GEO_ID];
    rowData[FACT_IDX.DEST_ID]      = destId    || rowData[FACT_IDX.DEST_ID];
    rowData[FACT_IDX.RESOLVED_LAT] = resolvedLat || rowData[FACT_IDX.RESOLVED_LAT];
    rowData[FACT_IDX.RESOLVED_LNG] = resolvedLng || rowData[FACT_IDX.RESOLVED_LNG];
    rowData[FACT_IDX.MATCH_STATUS] = decision.action  || rowData[FACT_IDX.MATCH_STATUS];
    rowData[FACT_IDX.MATCH_CONF]   = decision.confidence;
    rowData[FACT_IDX.MATCH_REASON] = decision.reason  || '';
    rowData[FACT_IDX.MATCH_ACTION] = decision.action  || '';
    rowData[FACT_IDX.UPDATED_AT]   = now;

    rowRange.setValues([rowData]);
    return rowData[FACT_IDX.TX_ID];

  } else {
    // --- INSERT ---
    const newRow = new Array(SCHEMA[SHEET.FACT_DELIVERY].length).fill('');

    newRow[FACT_IDX.TX_ID]          = txId;
    newRow[FACT_IDX.SOURCE_SHEET]   = srcObj.sourceSheet   || SHEET.SOURCE;
    newRow[FACT_IDX.SOURCE_ROW]     = srcObj.sourceRow     || 0;
    newRow[FACT_IDX.SOURCE_REC_ID]  = srcObj.sourceId      || '';
    newRow[FACT_IDX.DELIVERY_DATE]  = deliveryDateVal;
    newRow[FACT_IDX.DELIVERY_TIME]  = deliveryTimeVal;
    newRow[FACT_IDX.INVOICE_NO]     = srcObj.invoiceNo     || '';
    newRow[FACT_IDX.SHIPMENT_NO]    = srcObj.shipmentNo    || '';
    newRow[FACT_IDX.DRIVER_NAME]    = srcObj.driverName    || '';
    newRow[FACT_IDX.TRUCK_LICENSE]  = srcObj.truckLicense  || '';
    newRow[FACT_IDX.CARRIER_CODE]   = srcObj.carrierCode   || '';
    newRow[FACT_IDX.CARRIER_NAME]   = srcObj.carrierName   || '';
    newRow[FACT_IDX.SOLD_TO_CODE]   = srcObj.soldToCode    || '';
    newRow[FACT_IDX.SOLD_TO_NAME]   = srcObj.soldToName    || '';
    newRow[FACT_IDX.SHIP_TO_NAME]   = srcObj.rawPersonName || '';
    newRow[FACT_IDX.PERSON_ID]      = personId             || '';
    newRow[FACT_IDX.PLACE_ID]       = placeId              || '';
    newRow[FACT_IDX.GEO_ID]         = geoId                || '';
    newRow[FACT_IDX.DEST_ID]        = destId               || '';
    newRow[FACT_IDX.WAREHOUSE]      = srcObj.warehouse     || '';
    newRow[FACT_IDX.RAW_LAT]        = srcObj.rawLat        || 0;
    newRow[FACT_IDX.RAW_LNG]        = srcObj.rawLng        || 0;
    newRow[FACT_IDX.MATCH_STATUS]   = decision.action      || '';
    newRow[FACT_IDX.MATCH_CONF]     = decision.confidence  || 0;
    newRow[FACT_IDX.MATCH_REASON]   = decision.reason      || '';
    newRow[FACT_IDX.MATCH_ACTION]   = decision.action      || '';
    newRow[FACT_IDX.RESOLVED_LAT]   = resolvedLat;
    newRow[FACT_IDX.RESOLVED_LNG]   = resolvedLng;
    newRow[FACT_IDX.CREATED_AT]     = now;
    newRow[FACT_IDX.UPDATED_AT]     = now;
    newRow[FACT_IDX.RECORD_STATUS]  = APP_CONST.STATUS_ACTIVE;

    factSheet.appendRow(newRow);
    return txId;
  }
}

// ============================================================
// SECTION 2: Helper Functions
// ============================================================

/**
 * findFactRowByInvoice_ — ค้นหาแถวใน FACT_DELIVERY จาก Invoice No
 * [FIX v003] extract targetInvoice นอก loop แทนแปลงทุก iteration
 * [ADD v003-R3] Cache Map Invoice→RowNumber ป้องกัน O(n) loop ซ้ำ
 * @return {number} หมายเลขแถว (1-based) หรือ -1 ถ้าไม่พบ
 */
function findFactRowByInvoice_(factSheet, invoiceNo) {
  if (!invoiceNo || factSheet.getLastRow() < 2) return -1;

  const targetInvoice = String(invoiceNo).trim();

  // [ADD v003-R3] ตรวจ Cache Map ก่อน
  const cacheKey    = 'FACT_INVOICE_MAP';
  const ramCache    = CacheService.getScriptCache();
  const cachedMap   = ramCache.get(cacheKey);

  if (cachedMap) {
    try {
      const invoiceMap = JSON.parse(cachedMap);
      if (invoiceMap[targetInvoice] !== undefined) {
        return invoiceMap[targetInvoice]; // คืน row number จาก Cache
      }
    } catch (e) {}
  }

  // Cache miss → อ่านจาก Sheet
  const invoiceCol = FACT_IDX.INVOICE_NO + 1;
  const lastRow    = factSheet.getLastRow() - 1;
  const data       = factSheet.getRange(2, invoiceCol, lastRow, 1).getValues();

  // สร้าง Map ทั้งหมดแล้วเก็บ Cache
  const invoiceMap = {};
  let   foundRow   = -1;

  for (let i = 0; i < data.length; i++) {
    const inv = String(data[i][0]).trim();
    if (inv) {
      invoiceMap[inv] = i + 2;
      if (inv === targetInvoice) foundRow = i + 2;
    }
  }

  // บันทึก Cache Map (6 ชั่วโมง)
  try {
    ramCache.put(cacheKey, JSON.stringify(invoiceMap), AI_CONFIG.CACHE_TTL_SEC);
  } catch (e) {
    // Map ใหญ่เกิน Cache → ยอมรับได้
  }

  return foundRow;
}

/**
 * getGeoLatLng_ — ดึง lat/lng จาก M_GEO_POINT
 * [FIX v003] คืน null แทน {lat:0,lng:0} เมื่อไม่เจอ
 *            ป้องกัน Marker ตกทะเล (0,0)
 * @param {string} geoId
 * @return {{ lat: number, lng: number } | null}
 */
function getGeoLatLng_(geoId) {
  if (!geoId) return null;

  const allGeos = loadAllGeos_();
  const geo     = allGeos.find(g => g.geoId === geoId);

  // [FIX v003] คืน null ถ้าไม่เจอ หรือ lat/lng = 0
  if (!geo || geo.lat === 0 || geo.lng === 0) return null;
  return { lat: geo.lat, lng: geo.lng };
}

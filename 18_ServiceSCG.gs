/**
 * VERSION: 003
 * FILE: 18_ServiceSCG.gs
 * LMDS V5.0 — SCG API Service (Group 2 Commander)
 * ===================================================
 * CHANGELOG v003 (Round 1 — Critical Fixes):
 *   - [FIX] fetchOneShipment_: muteHttpExceptions + break → retry HTTP 5xx
 *   - [FIX] buildShipmentSummary: SCHEMA.SHIPMENT_SUMMARY → SCHEMA[SHEET.SHIPMENT_SUM]
 *   - [FIX] buildOwnerSummary: SCHEMA.OWNER_SUMMARY → SCHEMA[SHEET.OWNER_SUMMARY]
 *   - [FIX] fetchDataFromSCGJWD: ลบ Dead Variable shipmentString
 *   - [ADD] fetchDataFromSCGJWD: Time Guard
 *   - [FIX] buildDailyJobRow_: เพิ่ม fallback latLong fields
 * ===================================================
 */

// ============================================================
// SECTION 1: fetchDataFromSCGJWD — ดึงข้อมูลจาก SCG API
// ============================================================

function fetchDataFromSCGJWD() {
  const ss         = SpreadsheetApp.getActiveSpreadsheet();
  const inputSheet = ss.getSheetByName(SCG_CONFIG.SHEET_INPUT);
  const dataSheet  = ss.getSheetByName(SCG_CONFIG.SHEET_DATA);

  if (!inputSheet || !dataSheet) {
    SpreadsheetApp.getUi().alert(
      '❌ ไม่พบชีต Input หรือ ตารางงานประจำวัน\nกรุณารัน Setup ก่อน'
    );
    return;
  }

  const cookie = String(
    inputSheet.getRange(SCG_CONFIG.COOKIE_CELL).getValue() || ''
  ).trim();

  if (!cookie) {
    SpreadsheetApp.getUi().alert(
      '❌ กรุณาใส่ Cookie ใน Cell B1 ของชีต Input ก่อน'
    );
    return;
  }

  const lastInputRow = inputSheet.getLastRow();
  if (lastInputRow < SCG_CONFIG.INPUT_START_ROW) {
    SpreadsheetApp.getUi().alert(
      '❌ ไม่พบ Shipment No. ในชีต Input (เริ่มจากแถว 4)'
    );
    return;
  }

  const shipmentNos = inputSheet
    .getRange(SCG_CONFIG.INPUT_START_ROW, 1,
              lastInputRow - SCG_CONFIG.INPUT_START_ROW + 1, 1)
    .getValues()
    .map(r => String(r[0] || '').trim())
    .filter(s => s.length > 0);

  if (shipmentNos.length === 0) {
    SpreadsheetApp.getUi().alert('❌ ไม่พบ Shipment No. ที่ถูกต้อง');
    return;
  }

  logInfo('ServiceSCG', `fetchDataFromSCGJWD: ${shipmentNos.length} Shipments`);
  ss.toast(`กำลังดึงข้อมูล ${shipmentNos.length} Shipment...`, APP_NAME, -1);

  const startTime  = new Date();
  const timeLimit  = 5 * 60 * 1000;
  const allNewRows = [];
  let   fetchFail  = 0;

  for (const shipNo of shipmentNos) {
    // [ADD v003] Time Guard
    if (new Date() - startTime > timeLimit) {
      logWarn('ServiceSCG', 'fetchDataFromSCGJWD: Time Guard หยุดก่อนครบ');
      ss.toast('⚠️ หยุดดึงข้อมูลก่อนครบเพราะใกล้ Timeout', APP_NAME, 5);
      break;
    }

    try {
      const rows = fetchOneShipment_(shipNo, cookie);
      rows.forEach(r => allNewRows.push(r));
    } catch (err) {
      fetchFail++;
      logError('ServiceSCG', `Fetch ${shipNo} ล้มเหลว: ${err.message}`);
    }
  }

  if (allNewRows.length === 0) {
    SpreadsheetApp.getUi().alert(
      `⚠️ ไม่มีข้อมูลที่ดึงได้\n(เช็ค Cookie / Shipment No.)\nล้มเหลว: ${fetchFail}`
    );
    return;
  }

  // [RULE 6] Batch Write ทีเดียว
  const startRow = dataSheet.getLastRow() + 1;
  dataSheet.getRange(startRow, 1, allNewRows.length, SCHEMA[SHEET.DAILY_JOB].length)
           .setValues(allNewRows);

  logInfo('ServiceSCG',
    `fetchDataFromSCGJWD เสร็จ — ${allNewRows.length} แถว (fail:${fetchFail})`);
  ss.toast(`✅ ดึงข้อมูลเสร็จ ${allNewRows.length} รายการ`, APP_NAME, 5);

  buildOwnerSummary();
  buildShipmentSummary();
}

// ============================================================
// SECTION 2: fetchOneShipment_
// ============================================================

/**
 * fetchOneShipment_
 * [FIX v003] muteHttpExceptions: true + break ทำให้ไม่ Retry HTTP 5xx
 *            แก้: ตรวจ httpCode ใน try block → throw ถ้าไม่ใช่ 200
 *            ทำให้ catch block → retries++ → ลอง retry ใหม่
 */
function fetchOneShipment_(shipNo, cookie) {
  const payload = JSON.stringify({ shipmentNo: shipNo });
  const options = {
    method:             'POST',
    contentType:        'application/json',
    headers:            { Cookie: cookie },
    payload:            payload,
    muteHttpExceptions: true,
  };

  let response;
  let retries = 0;

  while (retries < APP_CONST.MAX_RETRIES) {
    try {
      response = UrlFetchApp.fetch(SCG_CONFIG.API_URL, options);

      // [FIX v003] ตรวจ httpCode ใน try → throw ถ้า 5xx
      //            ทำให้ catch → retries++ → retry ได้
      const httpCode = response.getResponseCode();
      if (httpCode === 200) {
        break; // สำเร็จ
      }
      // 4xx หรือ 5xx → throw เพื่อให้ retry
      throw new Error(`HTTP ${httpCode}`);

    } catch (err) {
      retries++;
      if (retries >= APP_CONST.MAX_RETRIES) {
        throw new Error(
          `fetchOneShipment_ ล้มเหลวหลัง ${retries} ครั้ง: ${err.message}`
        );
      }
      Utilities.sleep(1500 * retries);
    }
  }

  let jsonData;
  try {
    jsonData = JSON.parse(response.getContentText());
  } catch (e) {
    throw new Error(`Parse JSON ล้มเหลว Shipment ${shipNo}`);
  }

  const items = Array.isArray(jsonData) ? jsonData
    : (jsonData.data || jsonData.items || []);

  if (items.length === 0) return [];

  return items.map(item => buildDailyJobRow_(item, shipNo));
}

// ============================================================
// SECTION 3: buildDailyJobRow_
// ============================================================

/**
 * buildDailyJobRow_
 * [FIX v003] เพิ่ม fallback latLong fields หลายรูปแบบ
 */
function buildDailyJobRow_(item, shipNo) {
  const row = new Array(SCHEMA[SHEET.DAILY_JOB].length).fill('');

  row[DATA_IDX.JOB_ID]         = generateShortId('JB');
  row[DATA_IDX.PLAN_DELIVERY]  = item.planDeliveryDate || item.deliveryDate || '';
  row[DATA_IDX.INVOICE_NO]     = item.invoiceNo        || item.invoice_no  || '';
  row[DATA_IDX.SHIPMENT_NO]    = shipNo;
  row[DATA_IDX.DRIVER_NAME]    = item.driverName       || item.driver_name || '';
  row[DATA_IDX.TRUCK_LICENSE]  = item.truckLicense     || item.truck       || '';
  row[DATA_IDX.CARRIER_CODE]   = item.carrierCode      || '';
  row[DATA_IDX.CARRIER_NAME]   = item.carrierName      || '';
  row[DATA_IDX.SOLD_TO_CODE]   = item.soldToCode       || item.sold_to     || '';
  row[DATA_IDX.SOLD_TO_NAME]   = item.soldToName       || item.customer    || '';
  row[DATA_IDX.SHIP_TO_NAME]   = item.shipToName       || item.customerName|| '';
  row[DATA_IDX.SHIP_TO_ADDR]   = item.shipToAddress    || item.address     || '';

  // [FIX v003] เพิ่ม fallback หลายรูปแบบ field name
  row[DATA_IDX.LATLNG_SCG]     = item.latLong          || item.latlng      ||
                                  item.lat_long         || item.latLongSCG  || '';

  row[DATA_IDX.MATERIAL]       = item.materialName     || item.material    || '';
  row[DATA_IDX.QTY]            = item.itemQuantity      || item.qty         || 0;
  row[DATA_IDX.QTY_UNIT]       = item.quantityUnit     || '';
  row[DATA_IDX.WEIGHT]         = item.itemWeight        || item.weight      || 0;
  row[DATA_IDX.DELIVERY_NO]    = item.deliveryNo        || '';
  row[DATA_IDX.DEST_COUNT]     = item.destCount         || '';
  row[DATA_IDX.DEST_LIST]      = item.destList          || '';
  row[DATA_IDX.SCAN_STATUS]    = item.scanStatus        || 'PENDING';
  row[DATA_IDX.DELIVERY_STATUS]= item.deliveryStatus   || '';
  row[DATA_IDX.EMAIL]          = item.email             || '';
  row[DATA_IDX.TOT_QTY]        = item.totalQty          || 0;
  row[DATA_IDX.TOT_WEIGHT]     = item.totalWeight       || 0;
  row[DATA_IDX.SCAN_INV]       = item.scanInvoice       || 0;
  row[DATA_IDX.LATLNG_ACTUAL]  = ''; // รอ Module 17 เติม
  row[DATA_IDX.OWNER_LABEL]    = item.ownerLabel        || '';
  row[DATA_IDX.SHOP_KEY]       = `${shipNo}|${row[DATA_IDX.SHIP_TO_NAME]}`;

  return row;
}

// ============================================================
// SECTION 4: applyMasterCoordinatesToDailyJob
// ============================================================

/**
 * applyMasterCoordinatesToDailyJob
 * เรียก runLookupEnrichment จาก 17_SearchService.gs
 */
function applyMasterCoordinatesToDailyJob() {
  logInfo('ServiceSCG', 'applyMasterCoordinates → เรียก Module 17');
  runLookupEnrichment();
  logInfo('ServiceSCG', 'applyMasterCoordinates เสร็จสิ้น');
}

// ============================================================
// SECTION 5: checkIsEPOD
// ============================================================

function checkIsEPOD(rowIndex, allData) {
  if (rowIndex < 0 || rowIndex >= allData.length) return false;
  const scanStatus = String(
    allData[rowIndex][DATA_IDX.SCAN_STATUS] || ''
  ).trim();
  return scanStatus === 'SCANNED' || scanStatus === 'POD';
}

// ============================================================
// SECTION 6: buildOwnerSummary
// ============================================================

/**
 * buildOwnerSummary
 * [FIX v003] SCHEMA.OWNER_SUMMARY → SCHEMA[SHEET.OWNER_SUMMARY]
 *            ป้องกัน undefined หลัง 02_Schema เปลี่ยน key เป็นชื่อชีตจริง
 */
function buildOwnerSummary() {
  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const dataSheet = ss.getSheetByName(SHEET.DAILY_JOB);
  const sumSheet  = ss.getSheetByName(SHEET.OWNER_SUMMARY);
  if (!dataSheet || !sumSheet) return;
  if (dataSheet.getLastRow() < 2) return;

  const allData  = dataSheet.getRange(
    2, 1, dataSheet.getLastRow() - 1,
    SCHEMA[SHEET.DAILY_JOB].length
  ).getValues();

  const ownerMap = {};

  allData.forEach((row, i) => {
    const ownerName = String(row[DATA_IDX.SOLD_TO_NAME] || '').trim();
    if (!ownerName) return;

    if (!ownerMap[ownerName]) {
      ownerMap[ownerName] = { invoiceSet: new Set(), epodSet: new Set() };
    }
    const invoice = String(row[DATA_IDX.INVOICE_NO] || '').trim();
    if (invoice) {
      if (checkIsEPOD(i, allData)) {
        ownerMap[ownerName].epodSet.add(invoice);
      } else {
        ownerMap[ownerName].invoiceSet.add(invoice);
      }
    }
  });

  const now     = new Date();
  // [FIX v003] ใช้ SCHEMA[SHEET.OWNER_SUMMARY] ไม่ใช่ SCHEMA.OWNER_SUMMARY
  const schemaLen = SCHEMA[SHEET.OWNER_SUMMARY].length;

  const sumRows = Object.keys(ownerMap).map(owner => {
    const row = new Array(schemaLen).fill('');
    row[0] = generateShortId('S');                   // SummaryKey
    row[1] = owner;                                  // SoldToName
    row[2] = '';                                     // PlanDelivery
    row[3] = ownerMap[owner].invoiceSet.size +
             ownerMap[owner].epodSet.size;           // จำนวน_ทั้งหมด
    row[4] = ownerMap[owner].epodSet.size;           // จำนวน_E-POD_ทั้งหมด
    row[5] = now;                                    // LastUpdated
    return row;
  });

  if (sumRows.length === 0) return;

  if (sumSheet.getLastRow() > 1) {
    sumSheet.deleteRows(2, sumSheet.getLastRow() - 1);
  }
  sumSheet.getRange(2, 1, sumRows.length, schemaLen).setValues(sumRows);

  logDebug('ServiceSCG', `buildOwnerSummary: ${sumRows.length} เจ้าของสินค้า`);
}

// ============================================================
// SECTION 7: buildShipmentSummary
// ============================================================

/**
 * buildShipmentSummary
 * [FIX v003] SCHEMA.SHIPMENT_SUMMARY → SCHEMA[SHEET.SHIPMENT_SUM]
 */
function buildShipmentSummary() {
  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const dataSheet = ss.getSheetByName(SHEET.DAILY_JOB);
  const sumSheet  = ss.getSheetByName(SHEET.SHIPMENT_SUM);
  if (!dataSheet || !sumSheet) return;
  if (dataSheet.getLastRow() < 2) return;

  const allData  = dataSheet.getRange(
    2, 1, dataSheet.getLastRow() - 1,
    SCHEMA[SHEET.DAILY_JOB].length
  ).getValues();

  const shipMap = {};

  allData.forEach((row, i) => {
    const shipNo   = String(row[DATA_IDX.SHIPMENT_NO]  || '').trim();
    const truckLic = String(row[DATA_IDX.TRUCK_LICENSE] || '').trim();
    if (!shipNo) return;

    const key = `${shipNo}_${truckLic}`;
    if (!shipMap[key]) {
      shipMap[key] = {
        shipNo, truckLic,
        invoiceSet: new Set(), epodSet: new Set(),
      };
    }
    const invoice = String(row[DATA_IDX.INVOICE_NO] || '').trim();
    if (invoice) {
      if (checkIsEPOD(i, allData)) {
        shipMap[key].epodSet.add(invoice);
      } else {
        shipMap[key].invoiceSet.add(invoice);
      }
    }
  });

  const now     = new Date();
  // [FIX v003] ใช้ SCHEMA[SHEET.SHIPMENT_SUM] ไม่ใช่ SCHEMA.SHIPMENT_SUMMARY
  const schemaLen = SCHEMA[SHEET.SHIPMENT_SUM].length;

  const sumRows = Object.keys(shipMap).map(key => {
    const s   = shipMap[key];
    const row = new Array(schemaLen).fill('');
    row[0] = key;                                    // ShipmentKey
    row[1] = s.shipNo;                               // ShipmentNo
    row[2] = s.truckLic;                             // TruckLicense
    row[3] = '';                                     // PlanDelivery
    row[4] = s.invoiceSet.size + s.epodSet.size;     // จำนวน_ทั้งหมด
    row[5] = s.epodSet.size;                         // จำนวน_E-POD_ทั้งหมด
    row[6] = now;                                    // LastUpdated
    return row;
  });

  if (sumRows.length === 0) return;

  if (sumSheet.getLastRow() > 1) {
    sumSheet.deleteRows(2, sumSheet.getLastRow() - 1);
  }
  sumSheet.getRange(2, 1, sumRows.length, schemaLen).setValues(sumRows);

  logDebug('ServiceSCG', `buildShipmentSummary: ${sumRows.length} Shipments`);
}

// ============================================================
// SECTION 8: Clear Functions
// ============================================================

function clearAllSCGSheets_UI() {
  const ui = SpreadsheetApp.getUi();

  const confirm = ui.alert(
    '🗑️ ยืนยันการล้างข้อมูล',
    'จะล้างข้อมูลในชีตต่อไปนี้:\n' +
    `  • ${SHEET.DAILY_JOB}\n` +
    `  • ${SHEET.OWNER_SUMMARY}\n` +
    `  • ${SHEET.SHIPMENT_SUM}\n\n` +
    '⚠️ Master Data จะไม่ถูกลบ\nดำเนินการต่อใช่ไหม?',
    ui.ButtonSet.YES_NO
  );

  if (confirm !== ui.Button.YES) return;

  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  let   cleared = 0;

  [SHEET.DAILY_JOB, SHEET.OWNER_SUMMARY, SHEET.SHIPMENT_SUM].forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (sheet && sheet.getLastRow() > 1) {
      sheet.deleteRows(2, sheet.getLastRow() - 1);
      cleared++;
    }
  });

  logInfo('ServiceSCG', `clearAllSCGSheets_UI: ล้าง ${cleared} ชีต`);
  ui.alert(`✅ ล้างข้อมูล ${cleared} ชีตเรียบร้อย`);
}

function clearDailyJobLatLng() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.DAILY_JOB);
  if (!sheet || sheet.getLastRow() < 2) return;

  const totalRows    = sheet.getLastRow() - 1;
  const latActualCol = DATA_IDX.LATLNG_ACTUAL + 1;

  sheet.getRange(2, latActualCol, totalRows, 1).clearContent();
  sheet.getRange(2, 1, totalRows, SCHEMA[SHEET.DAILY_JOB].length)
       .setBackground(null);

  logInfo('ServiceSCG', `clearDailyJobLatLng: ล้าง ${totalRows} แถว`);
}

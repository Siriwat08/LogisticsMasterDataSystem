/**
 * VERSION: 003
 * FILE: 03_SetupSheets.gs
 * LMDS V5.0 — Sheet Setup & Initialization
 * ===================================================
 * CHANGELOG v003 (Round 1 — Critical Fixes):
 *   - [FIX] ทุก SCHEMA.xxx → getSheetHeaders(SHEET.xxx)
 *   - [FIX] SCHEMA.SHIPMENT_SUMMARY → getSheetHeaders(SHEET.SHIPMENT_SUM)
 *   - [FIX] SCHEMA.OWNER_SUMMARY → getSheetHeaders(SHEET.OWNER_SUMMARY)
 *   - [FIX] maxRows = 1000 → sheet.getMaxRows() - 1
 *   - [FIX] clearOldLogs: deleteRow loop → batch rewrite
 *   - [ADD] LockService ใน setupAllSheets()
 *   - [ADD] SYS_TH_GEO ใน requiredSheets
 * ===================================================
 */

// ============================================================
// SECTION 1: setupAllSheets — Entry Point
// ============================================================

/**
 * setupAllSheets — สร้างชีตทั้งหมดที่จำเป็น
 * [ADD v003] LockService กัน setup ซ้ำซ้อน
 */
function setupAllSheets() {
  const ui   = SpreadsheetApp.getUi();
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(5000)) {
    ui.alert('⚠️ Setup กำลังทำงานอยู่แล้ว\nกรุณารอให้เสร็จก่อน');
    return;
  }

  try {
    const answer = ui.alert(
      '🏗️ ยืนยัน Setup',
      'จะสร้างชีตที่ยังไม่มีทั้งหมด\n(ชีตที่มีอยู่แล้วจะไม่ถูกแตะต้อง)\n\nดำเนินการต่อใช่ไหม?',
      ui.ButtonSet.YES_NO
    );
    if (answer !== ui.Button.YES) return;

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ss.toast('กำลัง Setup ชีต...', APP_NAME, -1);

    setupGroupOneSheets_(ss);
    setupGroupTwoSheets_(ss);
    setupSystemSheets_(ss);

    // ตรวจสอบ Schema หลัง Setup
    try {
      validateSchemaConsistency();
    } catch (e) {
      ui.alert(`⚠️ Schema Warning:\n${e.message}`);
    }

    ss.toast('✅ Setup เสร็จสมบูรณ์!', APP_NAME, 5);
    ui.alert(
      '✅ Setup เสร็จสมบูรณ์!\n\n' +
      'ชีตที่ถูกสร้าง/ตรวจสอบ:\n' +
      Object.values(SHEET).map(n => `  • ${n}`).join('\n')
    );

  } catch (err) {
    logError('SetupSheets', `setupAllSheets ล้มเหลว: ${err.message}`);
    ui.alert(`❌ Setup ล้มเหลว:\n${err.message}`);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// SECTION 2: Group 1 — Master Data Sheets
// ============================================================

function setupGroupOneSheets_(ss) {
  // [FIX v003] ทุก call ใช้ getSheetHeaders(SHEET.xxx) แทน SCHEMA.xxx
  createSheetIfMissing_(ss, SHEET.M_PERSON,
    getSheetHeaders(SHEET.M_PERSON));

  createSheetIfMissing_(ss, SHEET.M_PERSON_ALIAS,
    getSheetHeaders(SHEET.M_PERSON_ALIAS));

  createSheetIfMissing_(ss, SHEET.M_PLACE,
    getSheetHeaders(SHEET.M_PLACE));

  createSheetIfMissing_(ss, SHEET.M_PLACE_ALIAS,
    getSheetHeaders(SHEET.M_PLACE_ALIAS));

  createSheetIfMissing_(ss, SHEET.M_GEO_POINT,
    getSheetHeaders(SHEET.M_GEO_POINT));

  createSheetIfMissing_(ss, SHEET.M_DESTINATION,
    getSheetHeaders(SHEET.M_DESTINATION));

  createSheetIfMissing_(ss, SHEET.FACT_DELIVERY,
    getSheetHeaders(SHEET.FACT_DELIVERY));

  createSheetIfMissing_(ss, SHEET.Q_REVIEW,
    getSheetHeaders(SHEET.Q_REVIEW));

  createSheetIfMissing_(ss, SHEET.RPT_QUALITY,
    getSheetHeaders(SHEET.RPT_QUALITY));

  createSheetIfMissing_(ss, SHEET.MAPS_CACHE,
    getSheetHeaders(SHEET.MAPS_CACHE));

  logInfo('SetupSheets', 'Group 1 Sheets เสร็จสิ้น');
}

// ============================================================
// SECTION 3: Group 2 — Daily Ops Sheets
// ============================================================

function setupGroupTwoSheets_(ss) {
  createSheetIfMissing_(ss, SHEET.DAILY_JOB,
    getSheetHeaders(SHEET.DAILY_JOB));

  createSheetIfMissing_(ss, SHEET.INPUT,
    getSheetHeaders(SHEET.INPUT));

  createSheetIfMissing_(ss, SHEET.EMPLOYEE,
    getSheetHeaders(SHEET.EMPLOYEE));

  // [FIX v003] SCHEMA.OWNER_SUMMARY → getSheetHeaders(SHEET.OWNER_SUMMARY)
  createSheetIfMissing_(ss, SHEET.OWNER_SUMMARY,
    getSheetHeaders(SHEET.OWNER_SUMMARY));

  // [FIX v003] SCHEMA.SHIPMENT_SUMMARY → getSheetHeaders(SHEET.SHIPMENT_SUM)
  createSheetIfMissing_(ss, SHEET.SHIPMENT_SUM,
    getSheetHeaders(SHEET.SHIPMENT_SUM));

  logInfo('SetupSheets', 'Group 2 Sheets เสร็จสิ้น');
}

// ============================================================
// SECTION 4: System Sheets
// ============================================================

function setupSystemSheets_(ss) {
  createSheetIfMissing_(ss, SHEET.SYS_LOG,
    getSheetHeaders(SHEET.SYS_LOG));

  createSheetIfMissing_(ss, SHEET.SYS_CONFIG,
    getSheetHeaders(SHEET.SYS_CONFIG));

  // [FIX v003] SYS_TH_GEO ต้องสร้างถ้าไม่มี
  createSheetIfMissing_(ss, SHEET.SYS_TH_GEO,
    getSheetHeaders(SHEET.SYS_TH_GEO));

  // เพิ่มค่า Config เริ่มต้น
  setupDefaultConfig_(ss);

  // ตั้ง Dropdown สำหรับ Q_REVIEW
  setupReviewDropdowns_(ss);

  logInfo('SetupSheets', 'System Sheets เสร็จสิ้น');
}

// ============================================================
// SECTION 5: createSheetIfMissing_
// ============================================================

/**
 * createSheetIfMissing_ — สร้างชีตพร้อม Header ถ้ายังไม่มี
 * [RULE 4] ถ้ามีอยู่แล้วให้ตรวจสอบ Header แทนสร้างใหม่
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} sheetName
 * @param {string[]} headers - Header Array จาก getSheetHeaders()
 */
function createSheetIfMissing_(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    // สร้างชีตใหม่
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, headers.length)
         .setValues([headers])
         .setFontWeight('bold')
         .setBackground('#4a86e8')
         .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidths(1, headers.length, 150);

    logInfo('SetupSheets', `สร้างชีต: ${sheetName} (${headers.length} cols)`);
    return sheet;
  }

  // ชีตมีอยู่แล้ว → ตรวจ Header
  const validation = validateSheetHeaders(sheet, headers);

  if (!validation.isValid) {
    if (validation.missing.length > 0) {
      logWarn('SetupSheets',
        `${sheetName}: Header หายไป [${validation.missing.join(', ')}]`);
    }
    if (validation.wrongOrder) {
      logWarn('SetupSheets', `${sheetName}: Header ลำดับผิด`);
    }
  }

  return sheet;
}

// ============================================================
// SECTION 6: setupReviewDropdowns_
// ============================================================

/**
 * setupReviewDropdowns_ — ตั้ง Dropdown สำหรับคอลัมน์ใน Q_REVIEW
 * [FIX v003] maxRows = 1000 → sheet.getMaxRows() - 1
 */
function setupReviewDropdowns_(ss) {
  const sheet = ss.getSheetByName(SHEET.Q_REVIEW);
  if (!sheet) return;

  // [FIX v003] ใช้จำนวนแถวจริงจากชีต ไม่ hardcode 1000
  const maxRows = sheet.getMaxRows() - 1;
  if (maxRows <= 0) return;

  const startRow = 2;

  // Dropdown: STATUS
  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Pending', 'In_Review', 'Done', 'Escalated'], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(startRow, REVIEW_IDX.STATUS + 1, maxRows, 1)
       .setDataValidation(statusRule);

  // Dropdown: DECISION
  const decisionRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['CREATE_NEW', 'MERGE_TO_CANDIDATE', 'ESCALATE', 'IGNORE'], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(startRow, REVIEW_IDX.DECISION + 1, maxRows, 1)
       .setDataValidation(decisionRule);

  // Dropdown: PRIORITY
  const priorityRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['1', '2', '3', '4'], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(startRow, REVIEW_IDX.PRIORITY + 1, maxRows, 1)
       .setDataValidation(priorityRule);

  logDebug('SetupSheets', `setupReviewDropdowns_: Q_REVIEW ${maxRows} แถว`);
}

// ============================================================
// SECTION 7: setupDefaultConfig_
// ============================================================

function setupDefaultConfig_(ss) {
  const sheet = ss.getSheetByName(SHEET.SYS_CONFIG);
  if (!sheet) return;
  if (sheet.getLastRow() > 1) return; // มีค่าอยู่แล้ว

  const now     = new Date();
  const configs = [
    ['SCHEMA_VERSION',     SCHEMA_VERSION,
     'เวอร์ชัน Schema ของระบบ', now],
    ['GEO_RADIUS_M',       String(AI_CONFIG.GEO_RADIUS_M),
     'รัศมีค้นหา Geo Point (เมตร)', now],
    ['BATCH_SIZE',         String(AI_CONFIG.BATCH_SIZE),
     'จำนวน record ต่อ Batch', now],
    ['THRESHOLD_AUTO',     String(AI_CONFIG.THRESHOLD_AUTO),
     'Score >= นี้ → Auto Match', now],
    ['THRESHOLD_REVIEW',   String(AI_CONFIG.THRESHOLD_REVIEW),
     'Score >= นี้ → ส่ง Review', now],
    ['LAST_SETUP',         now.toISOString(),
     'เวลาที่ Setup ล่าสุด', now],
  ];

  sheet.getRange(2, 1, configs.length,
    getSheetHeaders(SHEET.SYS_CONFIG).length)
    .setValues(configs);

  logInfo('SetupSheets', `setupDefaultConfig_: ${configs.length} ค่า`);
}

// ============================================================
// SECTION 8: Logging Functions (shared scope)
// ============================================================

/**
 * logInfo / logWarn / logError / logDebug
 * เขียน Log ลง SYS_LOG + Console
 */
function logInfo(module, message) {
  writeLog_('INFO', module, message);
  console.log(`[INFO][${module}] ${message}`);
}

function logWarn(module, message) {
  writeLog_('WARN', module, message);
  console.warn(`[WARN][${module}] ${message}`);
}

function logError(module, message) {
  writeLog_('ERROR', module, message);
  console.error(`[ERROR][${module}] ${message}`);
}

function logDebug(module, message) {
  // Debug: เขียนแค่ Console ไม่เขียนลง Sheet (ลด API calls)
  console.log(`[DEBUG][${module}] ${message}`);
}

/**
 * safeUiAlert_ — แสดง Alert เมื่อมี UI context เท่านั้น
 * [ADD v003-R2] Shared function — ย้ายมาจาก 13_ReportService และ 16_GeoDictBuilder
 * ป้องกัน Error เมื่อรันจาก Trigger ที่ไม่มี UI
 *
 * @param {string} message - ข้อความที่จะแสดง
 */
function safeUiAlert_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    // รันจาก Trigger ไม่มี UI — log แทน
    logInfo('UI', `[Alert] ${String(message).substring(0, 200)}`);
  }
}

function writeLog_(level, module, message) {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET.SYS_LOG);
    if (!sheet) return;

    // Log ID
    const logId = generateShortId('L');
    sheet.appendRow([
      logId, new Date(), module, level,
      String(message).substring(0, 500), '',
    ]);

    // ล้าง Log เก่าถ้าเกิน 5000 แถว
    if (sheet.getLastRow() > 5001) {
      clearOldLogs_(sheet, 1000);
    }
  } catch (e) {
    // ถ้าเขียน Log ไม่ได้ ไม่ throw
  }
}

// ============================================================
// SECTION 9: clearOldLogs_
// ============================================================

/**
 * clearOldLogs_ — ล้าง Log เก่า
 * [FIX v003] เปลี่ยนจาก deleteRow ทีละแถว (ช้ามาก) → filter + batch rewrite
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} logSheet
 * @param {number} keepRows - จำนวนแถวที่จะเก็บไว้ (ล่าสุด)
 */
function clearOldLogs_(logSheet, keepRows) {
  const totalRows = logSheet.getLastRow() - 1; // ไม่นับ Header
  if (totalRows <= keepRows) return;

  const schemaLen = getSheetHeaders(SHEET.SYS_LOG).length;
  const allData   = logSheet.getRange(2, 1, totalRows, schemaLen).getValues();

  // เก็บเฉพาะ keepRows แถวล่าสุด
  const keepData = allData.slice(allData.length - keepRows);

  // [FIX v003] ลบทุกแถว แล้ว rewrite เฉพาะที่ต้องการ (ไม่ deleteRow loop)
  if (totalRows > 1) {
    logSheet.deleteRows(2, totalRows);
  }

  if (keepData.length > 0) {
    logSheet.getRange(2, 1, keepData.length, schemaLen)
            .setValues(keepData);
  }

  logInfo('SetupSheets', `clearOldLogs_: เก็บ ${keepRows} แถวล่าสุด`);
}

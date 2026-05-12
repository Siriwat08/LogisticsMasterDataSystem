/**
 * VERSION: 003
 * FILE: 00_App.gs
 * LMDS V5.0 — Application Entry Point
 * ===================================================
 * CHANGELOG v003 (Round 1 — Critical Fixes):
 *   - [FIX] เพิ่ม SHEET.SYS_TH_GEO ใน requiredSheets
 *   - [ADD] เรียก validateConfig() จาก onOpen()
 *   - [ADD] LockService กัน double-click runFullPipeline
 * ===================================================
 */

const APP_VERSION = '5.0.003';
const APP_NAME    = 'LMDS V5.0';

// ============================================================
// SECTION 1: onOpen Trigger
// ============================================================

function onOpen() {
  // [ADD v003] ตรวจ Config ทันทีที่เปิด Spreadsheet
  try {
    validateConfig();
  } catch (cfgErr) {
    SpreadsheetApp.getUi().alert(
      '⚠️ Config Warning:\n' + cfgErr.message +
      '\n\nระบบยังใช้งานได้ แต่กรุณาตรวจสอบก่อนรัน Pipeline'
    );
  }

  const ui = SpreadsheetApp.getUi();

  ui.createMenu(`🚚 ${APP_NAME}`)
    .addItem('🚀 Run Full Pipeline',  'runFullPipeline')
    .addItem('📍 จับคู่พิกัดวันนี้', 'applyMasterCoordinatesToDailyJob')
    .addSeparator()

    .addSubMenu(
      ui.createMenu('🟩 กลุ่ม 1: ล้างข้อมูล & Master')
        .addItem('▶️ รัน Full Pipeline (ทั้งหมด)', 'runFullPipeline')
        .addSeparator()
        .addItem('Step 1 — โหลดข้อมูลดิบจากแหล่ง', 'runLoadSource')
        .addItem('Step 2 — Normalize ชื่อ/ที่อยู่',  'runNormalize')
        .addItem('Step 3 — Match Engine',              'runMatchEngine')
        .addSeparator()
        .addItem('📋 เปิด Review Queue',       'openReviewQueue')
        .addItem('📊 รายงาน Data Quality',     'buildFullQualityReport')
    )

    .addSubMenu(
      ui.createMenu('🟦 กลุ่ม 2: งานประจำวัน (SCG)')
        .addItem('📥 ดึงข้อมูล SCG API',   'fetchDataFromSCGJWD')
        .addItem('📍 จับคู่พิกัด',          'applyMasterCoordinatesToDailyJob')
        .addSeparator()
        .addItem('🗑️ ล้างข้อมูลทั้งหมด',  'clearAllSCGSheets_UI')
    )

    .addSeparator()

    .addSubMenu(
      ui.createMenu('🔧 ระบบ & ตั้งค่า')
        .addItem('⚙️ ตั้งค่า API Key',           'setupEnvironment')
        .addItem('🏗️ สร้างชีตทั้งหมด',          'setupAllSheets')
        .addItem('✅ ตรวจสอบ System Integrity',   'checkSystemIntegrity')
        .addItem('📖 ดู Version Info',            'showVersionInfo')
    )

    .addToUi();
}

// ============================================================
// SECTION 2: safeRun — Global Error Handler
// ============================================================

function safeRun(funcName, fn) {
  try {
    fn();
  } catch (err) {
    logError(funcName, err.message);
    SpreadsheetApp.getUi().alert(
      `❌ ${funcName} ล้มเหลว:\n${err.message}`
    );
  }
}

// ============================================================
// SECTION 3: Full Pipeline
// ============================================================

function runFullPipeline() {
  const ui = SpreadsheetApp.getUi();

  // [ADD v003] LockService กัน double-click
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    ui.alert('⚠️ มี Pipeline กำลังทำงานอยู่\nกรุณารอให้เสร็จก่อน');
    return;
  }

  try {
    const answer = ui.alert(
      '▶️ ยืนยัน Full Pipeline',
      'จะรันกระบวนการทั้งหมด:\n' +
      '  1. โหลดข้อมูลดิบจากชีต SCGนครหลวงJWDภูมิภาค\n' +
      '  2. Normalize ชื่อบุคคล / ชื่อสถานที่\n' +
      '  3. Match Engine (สร้าง/อัปเดต Master Data)\n\n' +
      'ใช้เวลาประมาณ 5–15 นาที กรุณาอย่าปิดหน้าต่าง',
      ui.ButtonSet.YES_NO
    );

    if (answer !== ui.Button.YES) return;

    const ss        = SpreadsheetApp.getActiveSpreadsheet();
    const startTime = new Date();

    logInfo('App', `Full Pipeline เริ่มต้น — v${APP_VERSION}`);
    ss.toast('กำลังรัน Full Pipeline...', APP_NAME, -1);

    safeRun('runFullPipeline', () => {
      ss.toast('Step 1/3: กำลังโหลดข้อมูลดิบ...', APP_NAME, 10);
      runLoadSource();

      ss.toast('Step 2/3: กำลัง Normalize...', APP_NAME, 10);
      runNormalize();

      ss.toast('Step 3/3: กำลัง Match Engine...', APP_NAME, 10);
      runMatchEngine();

      const elapsedSec = Math.round((new Date() - startTime) / 1000);
      logInfo('App', `Full Pipeline สำเร็จ — ${elapsedSec} วินาที`);
      ui.alert(`✅ Full Pipeline สำเร็จ!\nใช้เวลา: ${elapsedSec} วินาที`);
    });

  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// SECTION 4: Navigation Helpers
// ============================================================

function openReviewQueue() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.Q_REVIEW);
  if (sheet) {
    ss.setActiveSheet(sheet);
    ss.toast('กำลังแสดง Review Queue', APP_NAME, 3);
  } else {
    SpreadsheetApp.getUi()
      .alert('❌ ไม่พบชีต Q_REVIEW\nกรุณารัน "สร้างชีตทั้งหมด" ก่อน');
  }
}

// ============================================================
// SECTION 5: System Tools
// ============================================================

function checkSystemIntegrity() {
  const ui     = SpreadsheetApp.getUi();
  const ss     = SpreadsheetApp.getActiveSpreadsheet();
  const errors = [];
  const warns  = [];

  // [FIX v003] เพิ่ม SHEET.SYS_TH_GEO ใน requiredSheets
  const requiredSheets = [
    SHEET.M_PERSON,      SHEET.M_PERSON_ALIAS,
    SHEET.M_PLACE,       SHEET.M_PLACE_ALIAS,
    SHEET.M_GEO_POINT,   SHEET.M_DESTINATION,
    SHEET.FACT_DELIVERY, SHEET.Q_REVIEW,
    SHEET.SYS_LOG,       SHEET.SYS_CONFIG,
    SHEET.SYS_TH_GEO,    // [ADD v003]
    SHEET.MAPS_CACHE,    SHEET.RPT_QUALITY,
    SHEET.DAILY_JOB,     SHEET.INPUT,
    SHEET.EMPLOYEE,      SHEET.SOURCE,
  ];

  requiredSheets.forEach(name => {
    if (!ss.getSheetByName(name)) errors.push(`ไม่พบชีต: ${name}`);
  });

  try {
    const apiKey = PropertiesService.getScriptProperties()
                                    .getProperty('GEMINI_API_KEY');
    if (!apiKey) {
      warns.push('GEMINI_API_KEY ยังไม่ได้ตั้งค่า');
    } else if (apiKey.length < 20) {
      warns.push('GEMINI_API_KEY อาจไม่ถูกต้อง');
    }
  } catch (e) {
    warns.push('ไม่สามารถอ่าน GEMINI_API_KEY: ' + e.message);
  }

  if (errors.length === 0 && warns.length === 0) {
    ui.alert(`✅ System Integrity: ปกติทุกอย่าง!\nVersion: ${APP_VERSION}`);
    return;
  }

  let msg = '';
  if (errors.length > 0) {
    msg += `❌ พบ Error ${errors.length} รายการ:\n`;
    msg += errors.map(e => '  • ' + e).join('\n');
    msg += '\n\n💡 รัน เมนู > ระบบ > สร้างชีตทั้งหมด\n\n';
  }
  if (warns.length > 0) {
    msg += `⚠️ พบ Warning ${warns.length} รายการ:\n`;
    msg += warns.map(w => '  • ' + w).join('\n');
  }

  ui.alert(msg);
}

function setupEnvironment() {
  const ui = SpreadsheetApp.getUi();

  const result = ui.prompt(
    '⚙️ ตั้งค่า Gemini API Key',
    'กรุณาใส่ Gemini API Key:\n(ได้จาก https://aistudio.google.com/app/apikey)',
    ui.ButtonSet.OK_CANCEL
  );

  if (result.getSelectedButton() !== ui.Button.OK) return;

  const inputKey = result.getResponseText().trim();
  const keyRegex = /^AIza[0-9A-Za-z\-_]{35}$/;

  if (!inputKey || !keyRegex.test(inputKey)) {
    ui.alert(
      '❌ API Key ไม่ถูกต้อง\n' +
      'ต้องขึ้นต้นด้วย "AIza" และยาว 39 ตัวอักษร'
    );
    return;
  }

  PropertiesService.getScriptProperties()
                   .setProperty('GEMINI_API_KEY', inputKey);
  logInfo('App', 'ตั้งค่า GEMINI_API_KEY สำเร็จ');
  ui.alert('✅ บันทึก API Key เรียบร้อยแล้วครับ!');
}

function showVersionInfo() {
  const ui = SpreadsheetApp.getUi();
  const msg =
    `🚚 ${APP_NAME}\n` +
    `Version: ${APP_VERSION}\n` +
    `Schema: v${SCHEMA_VERSION}\n\n` +
    `📦 Modules (19 files):\n` +
    `  00_App.gs                v003\n` +
    `  01_Config.gs             v003\n` +
    `  02_Schema.gs             v003\n` +
    `  03_SetupSheets.gs        v003\n` +
    `  04_SourceRepository.gs   v003\n` +
    `  05_NormalizeService.gs   v003\n` +
    `  06_PersonService.gs      v003\n` +
    `  07_PlaceService.gs       v003\n` +
    `  08_GeoService.gs         v003\n` +
    `  09_DestinationService.gs v003\n` +
    `  10_MatchEngine.gs        v003\n` +
    `  11_TransactionService.gs v003\n` +
    `  12_ReviewService.gs      v003\n` +
    `  13_ReportService.gs      v003\n` +
    `  14_Utils.gs              v003\n` +
    `  15_GoogleMapsAPI.gs      v003\n` +
    `  16_GeoDictBuilder.gs     v003\n` +
    `  17_SearchService.gs      v003\n` +
    `  18_ServiceSCG.gs         v003\n\n` +
    `🟩 กลุ่ม 1: Cleansing & Master DB (00–14)\n` +
    `🟦 กลุ่ม 2: Daily Ops & Search (15–18)`;

  ui.alert(msg);
}

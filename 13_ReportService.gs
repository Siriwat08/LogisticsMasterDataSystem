/**
 * VERSION: 003
 * FILE: 13_ReportService.gs
 * LMDS V5.0 — Data Quality Report Service
 * ===================================================
 * CHANGELOG v003 (Round 1 — Critical Fixes):
 *   - [FIX] buildFullQualityReport: แยก autoMatchRate vs processedRate
 *   - [FIX] buildFullQualityReport: reviewCount ← getReviewStats().pending
 *   - [FIX] buildFullQualityReport: totalFact กรอง Active rows
 *   - [FIX] buildFullQualityReport: เพิ่ม unclassifiedCount
 *   - [FIX] buildFullQualityReport: guard ui.alert() กัน Trigger Error
 * ===================================================
 */

// ============================================================
// SECTION 1: buildFullQualityReport
// ============================================================

/**
 * buildFullQualityReport — สร้างรายงาน Data Quality และเขียนลง RPT_DATA_QUALITY
 * [FIX v003] แยก autoMatchRate vs processedRate
 * [FIX v003] reviewCount จาก getReviewStats().pending (รอ Review จริง)
 * [FIX v003] totalFact กรอง Active rows เท่านั้น
 * [FIX v003] เพิ่ม unclassifiedCount
 * [FIX v003] guard ui.alert() กัน Trigger Error
 */
function buildFullQualityReport() {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const rptSheet = ss.getSheetByName(SHEET.RPT_QUALITY);

  if (!rptSheet) {
    logError('ReportService', `ไม่พบชีต ${SHEET.RPT_QUALITY}`);
    return;
  }

  // --- นับจาก FACT_DELIVERY (Active rows เท่านั้น) ---
  const factSheet = ss.getSheetByName(SHEET.FACT_DELIVERY);
  let totalFact   = 0;
  let autoCount   = 0;
  let newCount    = 0;
  let reviewCount = 0;
  let errorCount  = 0;
  let unclassifiedCount = 0; // [FIX v003]

  if (factSheet && factSheet.getLastRow() > 1) {
    const totalRows    = factSheet.getLastRow() - 1;
    const schemaLen    = SCHEMA[SHEET.FACT_DELIVERY].length;

    // [FIX v003] อ่านเฉพาะ MATCH_STATUS และ RECORD_STATUS
    const statusCol    = FACT_IDX.MATCH_STATUS  + 1;
    const recStatusCol = FACT_IDX.RECORD_STATUS + 1;
    const maxCol       = Math.max(statusCol, recStatusCol);

    const data = factSheet.getRange(2, 1, totalRows, maxCol).getValues();

    data.forEach(row => {
      const recStatus = String(row[FACT_IDX.RECORD_STATUS] || '').trim();

      // [FIX v003] กรอง Active rows เท่านั้น
      if (recStatus !== APP_CONST.STATUS_ACTIVE) return;

      totalFact++;
      const matchStatus = String(row[FACT_IDX.MATCH_STATUS] || '').trim();

      switch (matchStatus) {
        case APP_CONST.MATCH_FULL:
        case APP_CONST.MATCH_GEO:
        case APP_CONST.MATCH_FUZZY:
        case 'AUTO_MATCH':
          autoCount++; break;
        case APP_CONST.MATCH_NEW:
        case 'CREATE_NEW':
          newCount++; break;
        case APP_CONST.MATCH_REVIEW:
        case 'REVIEW':
        case 'NEEDS_REVIEW':
          reviewCount++; break;
        case APP_CONST.MATCH_ERROR:
        case 'ERROR':
          errorCount++; break;
        default:
          // [FIX v003] นับ unclassified
          if (matchStatus) unclassifiedCount++;
          break;
      }
    });
  }

  // [FIX v003] reviewCount ที่แม่นยำ = Pending ใน Q_REVIEW จริงๆ
  const reviewStats     = getReviewStats();
  const pendingInQueue  = reviewStats.pending;

  // [FIX v003] autoMatchRate = เฉพาะ AUTO_MATCH (ไม่รวม CREATE_NEW)
  const autoMatchRate = totalFact > 0
    ? Math.round((autoCount / totalFact) * 100) : 0;

  // processedRate = AUTO + CREATE_NEW (ทั้งหมดที่ผ่าน Match Engine)
  const processedRate = totalFact > 0
    ? Math.round(((autoCount + newCount) / totalFact) * 100) : 0;

  // นับ Master Data
  const personCount = countActiveRows_(ss, SHEET.M_PERSON,     PERSON_IDX.STATUS);
  const placeCount  = countActiveRows_(ss, SHEET.M_PLACE,      PLACE_IDX.STATUS);
  const geoCount    = countActiveRows_(ss, SHEET.M_GEO_POINT,  GEO_IDX.STATUS);
  const destCount   = countActiveRows_(ss, SHEET.M_DESTINATION,DEST_IDX.STATUS);

  const note = [
    `Person:${personCount}`,
    `Place:${placeCount}`,
    `Geo:${geoCount}`,
    `Dest:${destCount}`,
    `Q_Pending:${pendingInQueue}`,
    `Unclassified:${unclassifiedCount}`,
  ].join(' | ');

  // เขียนรายงาน
  rptSheet.appendRow([
    new Date(),       // report_date
    totalFact,        // total_records
    autoCount,        // auto_matched
    pendingInQueue,   // reviewed (Pending จริงใน Q_REVIEW)
    newCount,         // created_new
    errorCount,       // failed
    `Auto:${autoMatchRate}% / Processed:${processedRate}%`, // match_rate
    note,             // notes
  ]);

  logInfo('ReportService',
    `Report เสร็จ — Total:${totalFact} Auto:${autoMatchRate}% ` +
    `Processed:${processedRate}% Q_Pending:${pendingInQueue}`);

  // [FIX v003] guard ui.alert() — ถ้ารันจาก Trigger จะ Error
  safeUiAlert_(
    '📊 Data Quality Report\n\n' +
    `รวมทั้งหมด (Active):  ${totalFact} รายการ\n` +
    `Auto Match:            ${autoCount} (${autoMatchRate}%)\n` +
    `สร้างใหม่:            ${newCount}\n` +
    `รอ Review (Q):         ${pendingInQueue}\n` +
    `Error:                 ${errorCount}\n` +
    `Unclassified:          ${unclassifiedCount}\n\n` +
    `Master Data:\n` +
    `  Person:  ${personCount}\n` +
    `  Place:   ${placeCount}\n` +
    `  Geo:     ${geoCount}\n` +
    `  Dest:    ${destCount}`
  );
}

// ============================================================
// SECTION 2: Helper Functions
// ============================================================

/**
 * countActiveRows_ — นับแถว Active ใน Master Sheet
 * [FIX v003] กรอง Active เท่านั้น ไม่ใช่ นับทุกแถว
 */
function countActiveRows_(ss, sheetName, statusIdx) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return 0;

  const statusCol = statusIdx + 1;
  const totalRows = sheet.getLastRow() - 1;
  const data      = sheet.getRange(2, statusCol, totalRows, 1).getValues();

  return data.filter(r =>
    String(r[0] || '').trim() === APP_CONST.STATUS_ACTIVE
  ).length;
}

// safeUiAlert_ → ใช้ shared function จาก 03_SetupSheets.gs (GAS shared scope)

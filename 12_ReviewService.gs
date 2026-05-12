/**
 * VERSION: 003
 * FILE: 12_ReviewService.gs
 * LMDS V5.0 — Review Queue Service
 * ===================================================
 * CHANGELOG v003 (Round 1 — Critical Fixes):
 *   - [FIX] applyAllPendingDecisions: 'In_Review' → !== 'Done'
 *   - [FIX] applyReviewDecision: headers.indexOf → REVIEW_IDX.*+1
 *   - [FIX] applyReviewDecision CREATE_NEW: ขาด invoiceNo/sourceRow
 *   - [FIX] applyReviewDecision CREATE_NEW: rawAddress ถูก field
 *   - [FIX] applyReviewDecision CREATE_NEW: resolvePlace ส่ง param ถูก
 *   - [FIX] applyReviewDecision ESCALATE: setValue('Escalated') + return
 *   - [FIX] applyReviewDecision: {} block scope กัน ES6 const
 *   - [FIX] applyReviewDecision CREATE_NEW: hasGeo เช็ค lng ด้วย
 *   - [FIX] enqueueReview: CAND_PERSONS/PLACES/GEOS → JSON.stringify([id])
 * ===================================================
 */

// ============================================================
// SECTION 1: enqueueReview
// ============================================================

/**
 * enqueueReview — เพิ่ม record เข้า Q_REVIEW
 * [FIX v003] CAND_PERSONS/PLACES/GEOS เก็บเป็น JSON array
 */
function enqueueReview(srcObj, decision, personResult, placeResult, geoResult) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.Q_REVIEW);
  if (!sheet) {
    logError('ReviewService', `ไม่พบชีต ${SHEET.Q_REVIEW}`);
    return null;
  }

  const now   = new Date();
  const newId = generateShortId('R');

  // [FIX v003] เก็บเป็น JSON.stringify([id]) แทน id เดี่ยว
  const candPersonIds = personResult && personResult.personId
    ? JSON.stringify([personResult.personId]) : JSON.stringify([]);
  const candPlaceIds  = placeResult && placeResult.placeId
    ? JSON.stringify([placeResult.placeId])  : JSON.stringify([]);
  const candGeoIds    = geoResult && geoResult.geoId
    ? JSON.stringify([geoResult.geoId])      : JSON.stringify([]);

  const newRow = new Array(SCHEMA[SHEET.Q_REVIEW].length).fill('');

  newRow[REVIEW_IDX.REVIEW_ID]     = newId;
  newRow[REVIEW_IDX.ISSUE_TYPE]    = decision ? decision.reason    : 'UNKNOWN';
  newRow[REVIEW_IDX.PRIORITY]      = decision ? (decision.priority || 2) : 2;
  newRow[REVIEW_IDX.SOURCE_REC_ID] = srcObj.sourceId   || '';
  newRow[REVIEW_IDX.SOURCE_ROW]    = srcObj.sourceRow  || 0;
  newRow[REVIEW_IDX.INVOICE_NO]    = srcObj.invoiceNo  || '';
  newRow[REVIEW_IDX.RAW_PERSON]    = srcObj.rawPersonName || '';

  // [FIX v003] ใช้ rawPlaceName แยก แทน rawAddress ซ้ำ
  newRow[REVIEW_IDX.RAW_PLACE]     = srcObj.rawPlaceName || srcObj.rawAddress || '';
  newRow[REVIEW_IDX.RAW_SYS_ADDR]  = srcObj.rawAddress   || '';
  newRow[REVIEW_IDX.RAW_GEO_ADDR]  = '';
  newRow[REVIEW_IDX.RAW_LAT]       = srcObj.rawLat || 0;
  newRow[REVIEW_IDX.RAW_LNG]       = srcObj.rawLng || 0;
  newRow[REVIEW_IDX.CAND_PERSONS]  = candPersonIds;
  newRow[REVIEW_IDX.CAND_PLACES]   = candPlaceIds;
  newRow[REVIEW_IDX.CAND_GEOS]     = candGeoIds;
  newRow[REVIEW_IDX.CAND_DESTS]    = JSON.stringify([]);
  newRow[REVIEW_IDX.MATCH_SCORE]   = decision ? (decision.confidence || 0) : 0;
  newRow[REVIEW_IDX.RECOMMEND]     = 'MANUAL_REVIEW';
  newRow[REVIEW_IDX.STATUS]        = 'Pending';
  newRow[REVIEW_IDX.REVIEWER]      = '';
  newRow[REVIEW_IDX.REVIEWED_AT]   = '';
  newRow[REVIEW_IDX.DECISION]      = '';
  newRow[REVIEW_IDX.NOTE]          = decision ? (decision.reason || '') : '';

  sheet.appendRow(newRow);
  logDebug('ReviewService', `enqueueReview: ${newId} — ${srcObj.invoiceNo}`);
  return newId;
}

// ============================================================
// SECTION 2: applyAllPendingDecisions
// ============================================================

/**
 * applyAllPendingDecisions — ประมวลผลทุก decision ที่รอ
 * [FIX v003] filter 'In_Review' → !== 'Done'
 *            เดิม: เช็ค === 'In_Review' ทำให้ Pending ถูกข้าม
 */
function applyAllPendingDecisions() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.Q_REVIEW);
  if (!sheet || sheet.getLastRow() < 2) return;

  const data    = sheet.getRange(2, 1, sheet.getLastRow() - 1,
                   SCHEMA[SHEET.Q_REVIEW].length).getValues();
  let processed = 0;

  for (let i = 0; i < data.length; i++) {
    const status   = String(data[i][REVIEW_IDX.STATUS]   || '').trim();
    const decision = String(data[i][REVIEW_IDX.DECISION] || '').trim();
    const reviewId = String(data[i][REVIEW_IDX.REVIEW_ID]|| '').trim();

    // [FIX v003] ข้ามเฉพาะ Done แทน เช็ค In_Review
    if (status === 'Done' || !decision) continue;

    try {
      applyReviewDecision(reviewId, decision, data[i]);
      processed++;
    } catch (err) {
      logError('ReviewService',
        `applyAllPendingDecisions: reviewId ${reviewId} — ${err.message}`);
    }
  }

  logInfo('ReviewService', `applyAllPendingDecisions: ประมวลผล ${processed} รายการ`);
  return processed;
}

// ============================================================
// SECTION 3: applyReviewDecision
// ============================================================

/**
 * applyReviewDecision — ประมวลผล Decision จาก Admin
 * [FIX v003] ใช้ REVIEW_IDX.xxx + 1 แทน headers.indexOf (case-sensitive)
 * [FIX v003] {} block scope กัน ES6 const ใน switch
 * [FIX v003] ESCALATE: setValue('Escalated') + return
 */
function applyReviewDecision(reviewId, decisionVal, rowData) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.Q_REVIEW);
  if (!sheet) return;

  const now      = new Date();
  const reviewer = Session.getActiveUser().getEmail();

  // หาแถวใน Q_REVIEW
  let targetRow  = -1;
  let rowArr     = rowData;

  if (!rowArr) {
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1,
                  SCHEMA[SHEET.Q_REVIEW].length).getValues();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][REVIEW_IDX.REVIEW_ID]).trim() === reviewId) {
        targetRow = i + 2;
        rowArr    = data[i];
        break;
      }
    }
  } else {
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1,
                  SCHEMA[SHEET.Q_REVIEW].length).getValues();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][REVIEW_IDX.REVIEW_ID]).trim() === reviewId) {
        targetRow = i + 2;
        break;
      }
    }
  }

  if (targetRow === -1) {
    logWarn('ReviewService', `applyReviewDecision: ไม่พบ reviewId ${reviewId}`);
    return;
  }

  // [FIX v003] ใช้ REVIEW_IDX.STATUS + 1 แทน headers.indexOf
  switch (decisionVal) {

    case 'CREATE_NEW': {
      // [FIX v003] สร้าง srcObj ที่มี invoiceNo + sourceRow ครบถ้วน
      const rawPerson = String(rowArr[REVIEW_IDX.RAW_PERSON]   || '').trim();
      const rawPlace  = String(rowArr[REVIEW_IDX.RAW_PLACE]    || '').trim();
      const rawAddr   = String(rowArr[REVIEW_IDX.RAW_SYS_ADDR] || '').trim();
      const rawLat    = Number(rowArr[REVIEW_IDX.RAW_LAT]      || 0);
      const rawLng    = Number(rowArr[REVIEW_IDX.RAW_LNG]      || 0);

      const srcObj = {
        invoiceNo:     String(rowArr[REVIEW_IDX.INVOICE_NO]   || '').trim(),
        sourceRow:     Number(rowArr[REVIEW_IDX.SOURCE_ROW]   || 0),
        sourceId:      String(rowArr[REVIEW_IDX.SOURCE_REC_ID]|| '').trim(),
        rawPersonName: rawPerson,
        rawPlaceName:  rawPlace,
        // [FIX v003] rawAddress จาก RAW_SYS_ADDR ไม่ใช่ rawPlaceName
        rawAddress:    rawAddr,
        rawLat:        rawLat,
        rawLng:        rawLng,
        // [FIX v003] hasGeo เช็ค lat AND lng
        hasGeo:        !isNaN(rawLat) && !isNaN(rawLng) &&
                       rawLat !== 0   && rawLng !== 0,
        province:      '',
        warehouse:     '',
        driverName:    '',
        truckLicense:  '',
        soldToCode:    '',
        soldToName:    '',
        carrierCode:   '',
        carrierName:   '',
        shipmentNo:    '',
        deliveryDate:  '',
        deliveryTime:  '',
        sourceSheet:   SHEET.Q_REVIEW,
      };

      const personResult = resolvePerson(rawPerson);
      let personId       = personResult.personId;
      if (!personId) personId = createPerson(personResult.normResult);

      // [FIX v003] resolvePlace ส่ง rawPlace (clean) + rawAddr (dirty) แยกกัน
      const placeResult  = resolvePlace(rawPlace, rawAddr);
      let placeId        = placeResult.placeId;
      if (!placeId) placeId = createPlace(placeResult.normResult, '', '', '', '');

      let geoId = null;
      if (srcObj.hasGeo) {
        const geoResult = resolveGeo(rawLat, rawLng);
        geoId = geoResult.geoId;
        if (!geoId) geoId = createGeoPoint(rawLat, rawLng, 'manual', '', '', '');
      }

      let destId = null;
      if (geoId && (personId || placeId)) {
        destId = createDestination(personId, placeId, geoId,
                                   rawLat, rawLng, null);
      }

      upsertFactDelivery(srcObj,
        { action: 'CREATE_NEW', reason: 'REVIEW_APPROVED', confidence: 95, priority: 0 },
        personId, placeId, geoId, destId);

      // อัปเดต Q_REVIEW status
      sheet.getRange(targetRow, REVIEW_IDX.STATUS      + 1).setValue('Done');
      sheet.getRange(targetRow, REVIEW_IDX.REVIEWER    + 1).setValue(reviewer);
      sheet.getRange(targetRow, REVIEW_IDX.REVIEWED_AT + 1).setValue(now);
      sheet.getRange(targetRow, REVIEW_IDX.DECISION    + 1).setValue(decisionVal);
      break;
    }

    case 'MERGE_TO_CANDIDATE': {
      const rawPerson     = String(rowArr[REVIEW_IDX.RAW_PERSON] || '').trim();
      const candPersonStr = String(rowArr[REVIEW_IDX.CAND_PERSONS] || '[]').trim();
      let   candPersonIds = [];

      try { candPersonIds = JSON.parse(candPersonStr); } catch(e) {}

      if (candPersonIds.length > 0) {
        const personResult = resolvePerson(rawPerson);
        if (personResult.personId && personResult.personId !== candPersonIds[0]) {
          mergePersonRecords(personResult.personId, candPersonIds[0]);
        }
      }

      sheet.getRange(targetRow, REVIEW_IDX.STATUS      + 1).setValue('Done');
      sheet.getRange(targetRow, REVIEW_IDX.REVIEWER    + 1).setValue(reviewer);
      sheet.getRange(targetRow, REVIEW_IDX.REVIEWED_AT + 1).setValue(now);
      sheet.getRange(targetRow, REVIEW_IDX.DECISION    + 1).setValue(decisionVal);
      break;
    }

    case 'ESCALATE': {
      // [FIX v003] setValue('Escalated') แล้ว return ทันที
      //            เดิม: ตกไป setValue('Done') ผิด
      sheet.getRange(targetRow, REVIEW_IDX.STATUS      + 1).setValue('Escalated');
      sheet.getRange(targetRow, REVIEW_IDX.REVIEWER    + 1).setValue(reviewer);
      sheet.getRange(targetRow, REVIEW_IDX.REVIEWED_AT + 1).setValue(now);
      sheet.getRange(targetRow, REVIEW_IDX.DECISION    + 1).setValue(decisionVal);
      logInfo('ReviewService', `reviewId ${reviewId} → Escalated`);
      return; // [FIX v003] return ทันที
    }

    case 'IGNORE': {
      sheet.getRange(targetRow, REVIEW_IDX.STATUS      + 1).setValue('Done');
      sheet.getRange(targetRow, REVIEW_IDX.REVIEWER    + 1).setValue(reviewer);
      sheet.getRange(targetRow, REVIEW_IDX.REVIEWED_AT + 1).setValue(now);
      sheet.getRange(targetRow, REVIEW_IDX.DECISION    + 1).setValue(decisionVal);
      break;
    }

    default:
      logWarn('ReviewService', `applyReviewDecision: Unknown decision ${decisionVal}`);
      break;
  }

  logInfo('ReviewService',
    `applyReviewDecision: ${reviewId} → ${decisionVal} โดย ${reviewer}`);
}

// ============================================================
// SECTION 4: Stats & Report
// ============================================================

/**
 * getReviewStats — ดึงสถิติ Q_REVIEW
 */
function getReviewStats() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.Q_REVIEW);
  const stats = { pending: 0, done: 0, escalated: 0, total: 0 };

  if (!sheet || sheet.getLastRow() < 2) return stats;

  const statusCol = REVIEW_IDX.STATUS + 1;
  const totalRows = sheet.getLastRow() - 1;
  const statusData = sheet.getRange(2, statusCol, totalRows, 1).getValues();

  statusData.forEach(r => {
    const s = String(r[0] || '').trim();
    stats.total++;
    if (s === 'Done')       stats.done++;
    else if (s === 'Escalated') stats.escalated++;
    else                    stats.pending++;
  });

  return stats;
}

/**
 * highlightHighPriorityReviews — ทาสีแถว Priority สูงใน Q_REVIEW
 * [NOTE] ปรับเป็น batch collect ranges แล้ว setBackground ทีเดียว
 */
function highlightHighPriorityReviews() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.Q_REVIEW);
  if (!sheet || sheet.getLastRow() < 2) return;

  const totalRows   = sheet.getLastRow() - 1;
  const totalCols   = SCHEMA[SHEET.Q_REVIEW].length;
  const data        = sheet.getRange(2, 1, totalRows, totalCols).getValues();
  const bgColors    = [];

  data.forEach(row => {
    const priority = Number(row[REVIEW_IDX.PRIORITY] || 0);
    const status   = String(row[REVIEW_IDX.STATUS]   || '').trim();
    let color      = null;

    if (status === 'Done')      color = '#d9ead3';
    else if (priority >= 3)    color = '#f4cccc';
    else if (priority === 2)   color = '#fff2cc';
    else                       color = null;

    bgColors.push(Array(totalCols).fill(color));
  });

  // [RULE 4] Batch setBackgrounds ทีเดียว ไม่ loop setBackground
  sheet.getRange(2, 1, totalRows, totalCols).setBackgrounds(bgColors);
  logDebug('ReviewService', `highlightHighPriorityReviews: ${totalRows} แถว`);
}

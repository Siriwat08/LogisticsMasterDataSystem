/**
 * VERSION: 003
 * FILE: 10_MatchEngine.gs
 * LMDS V5.0 — Match Engine (3-Tier Decision)
 * ===================================================
 * CHANGELOG v003 (Round 1 — Critical Fixes):
 *   - [FIX] processOneRow: resolvePlace ส่ง rawPlaceName + province
 *   - [FIX] makeMatchDecision Rule 1: !hasGeo (เดิม Logic ผิด)
 *   - [FIX] makeMatchDecision Rule 3: ใช้ srcObj.province แทน
 *           placeResult.normResult.province ที่ไม่มีจริง
 *   - [FIX] makeMatchDecision Rule 5: Weight รวม 1.0 (เดิม 1.2)
 *   - [FIX] makeMatchDecision Rule 7: !isPersonOk && !isPlaceOk
 *   - [FIX] executeDecision CREATE_NEW: guard ก่อน createDestination
 *   - [FIX] getSameDayDestinations: Utilities.formatDate แทน toDateString
 *   - [FIX] getSameDayDestinations: อ่านเฉพาะคอลัมน์จำเป็น
 *   - [FIX] executeDecision: null guard ก่อน updateDestinationStats
 *   - [ADD] loadCheckpoint_: resume จาก Checkpoint
 *   - [FIX] getGeoProvince_: เรียกครั้งเดียวก่อนเข้า Rule
 * ===================================================
 */

// ============================================================
// SECTION 1: runMatchEngine
// ============================================================

function runMatchEngine() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(APP_CONST.LOCK_TIMEOUT_MS);
  } catch (e) {
    logWarn('MatchEngine', 'ไม่สามารถ Lock ได้ — อาจมีการรันซ้อน');
    return;
  }

  const startTime = new Date();
  const timeLimit = 5 * 60 * 1000;
  let processed = 0, autoMatched = 0, created = 0, queued = 0, errorCount = 0;

  try {
    logInfo('MatchEngine', 'เริ่ม Match Engine');

    // [ADD v003] โหลด Checkpoint ถ้ามี
    const startIndex = loadCheckpoint_();
    const pendingRows = getUnprocessedRows();

    if (pendingRows.length === 0) {
      logInfo('MatchEngine', 'ไม่มีแถวที่ต้องประมวลผล');
      return;
    }

    logInfo('MatchEngine',
      `ประมวลผล ${pendingRows.length} แถว (เริ่มจาก index ${startIndex})`);

    for (let i = startIndex; i < pendingRows.length; i++) {
      if (new Date() - startTime > timeLimit) {
        logWarn('MatchEngine', `Time Guard: หยุดที่แถว ${i}/${pendingRows.length}`);
        saveCheckpoint_(i, pendingRows[i].sourceRow);
        break;
      }
      try {
        const result = processOneRow(pendingRows[i]);
        processed++;
        if (result.action === 'AUTO_MATCH')  autoMatched++;
        if (result.action === 'CREATE_NEW')  created++;
        if (result.action === 'REVIEW')      queued++;
      } catch (rowErr) {
        errorCount++;
        logError('MatchEngine', `แถว ${i}: ${rowErr.message}`);
      }
    }

    // ล้าง Checkpoint เมื่อเสร็จสมบูรณ์
    if (processed + errorCount >= pendingRows.length - startIndex) {
      clearCheckpoint_();
    }

    const elapsedSec = Math.round((new Date() - startTime) / 1000);
    logInfo('MatchEngine',
      `เสร็จสิ้น — รัน:${processed} Match:${autoMatched} ` +
      `สร้างใหม่:${created} Review:${queued} Error:${errorCount} (${elapsedSec}s)`);

  } catch (err) {
    logError('MatchEngine', `runMatchEngine ล้มเหลว: ${err.message}`);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// SECTION 2: processOneRow
// ============================================================

/**
 * processOneRow — ประมวลผล 1 Source Record
 * [FIX v003] resolvePlace ส่ง rawPlaceName + province
 */
function processOneRow(srcObj) {
  const personResult = resolvePerson(srcObj.rawPersonName);

  // [FIX v003] ส่ง rawPlaceName (สะอาด) + province แทน rawAddress ซ้ำ
  const placeResult  = resolvePlace(
    srcObj.rawPlaceName || srcObj.rawAddress,
    srcObj.province || srcObj.rawAddress
  );

  const geoResult    = resolveGeo(srcObj.rawLat, srcObj.rawLng);

  const decision = makeMatchDecision(srcObj, personResult, placeResult, geoResult);
  const txId     = executeDecision(srcObj, decision, personResult, placeResult, geoResult);

  return { action: decision.action, txId };
}

// ============================================================
// SECTION 3: makeMatchDecision — 8 Rules
// ============================================================

/**
 * makeMatchDecision
 * [FIX v003] Rule 1: !hasGeo (เดิม Logic ผิด)
 * [FIX v003] Rule 3: ใช้ srcObj.province แทน placeResult.normResult.province
 * [FIX v003] Rule 5: Weight รวม = 1.0 (เดิม 1.2)
 * [FIX v003] Rule 7: !isPersonOk && !isPlaceOk (เดิม hasPerson ผิด)
 */
function makeMatchDecision(srcObj, personResult, placeResult, geoResult) {
  const hasGeo     = geoResult.status === 'FOUND';
  const isPersonOk = personResult.status === 'FOUND';
  const isPlaceOk  = placeResult.status  === 'FOUND' ||
                     placeResult.status  === 'BRANCH_MATCH';
  const hasPerson  = isPersonOk || personResult.status === 'NEEDS_REVIEW';
  const hasPlace   = isPlaceOk  || placeResult.status  === 'NEEDS_REVIEW';

  // geoId สำหรับ detectSameGeoMultiPerson
  const geoId = geoResult.geoId || null;
  const geoProvince = hasGeo ? getGeoProvince_(geoResult.geoId) : '';

  // Rule 1: ไม่มีพิกัดที่ถูกต้อง
  // [FIX v003] แค่ !hasGeo พอ ไม่ต้องเช็ค status อีก
  if (!hasGeo) {
    return {
      action: 'REVIEW', reason: 'INVALID_LATLNG',
      confidence: 0, priority: 1,
    };
  }

  // Rule 2: ชื่อคุณภาพต่ำ
  if (personResult.status === 'LOW_QUALITY') {
    return {
      action: 'REVIEW', reason: 'LOW_QUALITY_PERSON',
      confidence: 0, priority: 2,
    };
  }

  // Rule 3: Province Conflict
  // [FIX v003] ใช้ srcObj.province และ geoProvince ที่คำนวณไว้แล้ว
  if (geoProvince && srcObj.province &&
      geoProvince !== srcObj.province) {
    return {
      action: 'REVIEW', reason: 'GEO_PROVINCE_CONFLICT',
      confidence: 50, priority: 2,
    };
  }

  // Rule 4: ครบทั้ง 3 → FULL_MATCH
  if (hasGeo && isPersonOk && isPlaceOk) {
    const confidence = Math.round(
      geoResult.confidence    * 0.5 +
      personResult.confidence * 0.3 +
      placeResult.confidence  * 0.2
    );
    return {
      action: 'AUTO_MATCH', reason: APP_CONST.MATCH_FULL,
      confidence, priority: 0,
    };
  }

  // Rule 5: Geo + (Person หรือ Place)
  // [FIX v003] Weight รวม = 0.6+0.25+0.15 = 1.0
  if (hasGeo && (isPersonOk || isPlaceOk)) {
    const confidence = Math.min(95, Math.round(
      geoResult.confidence                                    * 0.60 +
      (isPersonOk ? personResult.confidence : 0)             * 0.25 +
      (isPlaceOk  ? placeResult.confidence  : 0)             * 0.15
    ));
    return {
      action: 'AUTO_MATCH', reason: APP_CONST.MATCH_GEO,
      confidence, priority: 0,
    };
  }

  // Rule 6: NEEDS_REVIEW
  if (personResult.status === 'NEEDS_REVIEW' ||
      placeResult.status  === 'NEEDS_REVIEW') {
    const confidence = Math.max(
      personResult.confidence, placeResult.confidence
    );
    return {
      action: 'REVIEW', reason: APP_CONST.MATCH_FUZZY,
      confidence, priority: 2,
    };
  }

  // Rule 7: ทุกอย่างใหม่ + มีพิกัด → CREATE_NEW
  // [FIX v003] !isPersonOk && !isPlaceOk (เดิมใช้ hasPerson ผิด)
  if (hasGeo && !isPersonOk && !isPlaceOk) {
    return {
      action: 'CREATE_NEW', reason: 'ALL_NEW_WITH_GEO',
      confidence: geoResult.confidence, priority: 0,
    };
  }

  // Rule 7b: ใหม่หมด + ไม่มีพิกัด
  if (!hasGeo && !hasPerson && !hasPlace) {
    return {
      action: 'REVIEW', reason: 'ALL_NEW_NO_GEO',
      confidence: 0, priority: 3,
    };
  }

  // Rule 8: Default — ตรวจ Geo ซ้ำคนละคน (Multi-Person Same Geo)
  // [ADD v003-R2] integrate detectSameGeoMultiPerson เข้าระบบ
  if (hasGeo && personResult.personId) {
    const isMultiPerson = detectSameGeoMultiPerson(geoId, personResult.personId);
    if (isMultiPerson) {
      return {
        action: 'REVIEW', reason: 'MULTI_PERSON_SAME_GEO',
        confidence: 60, priority: 2,
      };
    }
  }

  return {
    action: 'CREATE_NEW', reason: 'DEFAULT_NEW',
    confidence: 50, priority: 1,
  };
}

// ============================================================
// SECTION 4: executeDecision
// ============================================================

/**
 * executeDecision
 * [FIX v003] CREATE_NEW: guard ก่อน createDestination
 * [FIX v003] null guard ก่อน updateDestinationStats
 */
function executeDecision(srcObj, decision, personResult, placeResult, geoResult) {
  let personId = personResult.personId;
  let placeId  = placeResult.placeId;
  let geoId    = geoResult.geoId;  let destId   = null;

  switch (decision.action) {

    case 'AUTO_MATCH': {
      if (personId) updatePersonStats(personId);
      if (placeId)  updatePlaceStats(placeId);
      if (geoId)    updateGeoStats(geoId);

      const destResult = resolveDestination(personId, placeId, geoId);
      if (destResult.status === 'FOUND' || destResult.status === 'PARTIAL_MATCH') {
        destId = destResult.destId;
        // [FIX v003] null guard ก่อน update
        if (destId) updateDestinationStats(destId, srcObj.deliveryDate);
      } else {
        destId = createDestination(
          personId, placeId, geoId,
          srcObj.rawLat, srcObj.rawLng,
          srcObj.deliveryDate
        );
      }
      break;
    }

    case 'CREATE_NEW': {
      if (!personId && personResult.normResult) {
        personId = createPerson(personResult.normResult);
      }
      if (!placeId && placeResult.normResult) {
        placeId = createPlace(
          placeResult.normResult,
          srcObj.province || '', '', '', ''
        );
      }
      if (!geoId && srcObj.hasGeo) {
        geoId = createGeoPoint(
          srcObj.rawLat, srcObj.rawLng,
          'driver', '', srcObj.province || '', ''
        );
      }
      // [FIX v003] ต้องมีอย่างน้อย geoId และ personId หรือ placeId
      if (geoId && (personId || placeId)) {
        destId = createDestination(
          personId, placeId, geoId,
          srcObj.rawLat, srcObj.rawLng,
          srcObj.deliveryDate
        );
      }
      break;
    }

    case 'REVIEW': {
      enqueueReview(srcObj, decision, personResult, placeResult, geoResult);
      break;
    }

    default:
      logError('MatchEngine', `executeDecision: Unknown action: ${decision.action}`);
      break;
  }

  const txId = upsertFactDelivery(
    srcObj, personId, placeId, geoId, destId, decision
  );
  return txId;
}

// ============================================================
// SECTION 5: Helper Functions
// ============================================================

/**
 * getSameDayDestinations
 * [FIX v003] ใช้ Utilities.formatDate แทน toDateString (timezone safe)
 * [FIX v003] อ่านเฉพาะ DELIVERY_DATE + GEO_ID + TX_ID + PERSON_ID + PLACE_ID
 */
function getSameDayDestinations(deliveryDate, geoId) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.FACT_DELIVERY);
  if (!sheet || sheet.getLastRow() < 2) return [];

  if (!deliveryDate || !geoId) return [];

  // [FIX v003] อ่านเฉพาะคอลัมน์ที่ต้องการ
  const colsNeeded = [
    FACT_IDX.TX_ID, FACT_IDX.PERSON_ID, FACT_IDX.PLACE_ID,
    FACT_IDX.GEO_ID, FACT_IDX.DELIVERY_DATE
  ];
  const maxCol     = Math.max(...colsNeeded) + 1;
  const data       = sheet.getRange(2, 1, sheet.getLastRow() - 1, maxCol)
                          .getValues();

  // [FIX v003] ใช้ Utilities.formatDate ป้องกัน timezone ต่างกัน
  const tz         = Session.getScriptTimeZone();
  const targetDate = Utilities.formatDate(
    new Date(deliveryDate), tz, 'yyyy-MM-dd'
  );

  const results = [];
  for (let i = 0; i < data.length; i++) {
    const rowDate = data[i][FACT_IDX.DELIVERY_DATE];
    if (!rowDate) continue;

    const formattedDate = Utilities.formatDate(
      new Date(rowDate), tz, 'yyyy-MM-dd'
    );
    const rowGeoId = String(data[i][FACT_IDX.GEO_ID] || '');

    if (formattedDate === targetDate && rowGeoId === geoId) {
      results.push({
        txId:     data[i][FACT_IDX.TX_ID],
        personId: data[i][FACT_IDX.PERSON_ID],
        placeId:  data[i][FACT_IDX.PLACE_ID],
        geoId:    rowGeoId,
      });
    }
  }
  return results;
}

function detectSameGeoMultiPerson(geoId, currentPersonId) {
  const allDests = loadAllDestinations_();
  return allDests.some(d =>
    d.geoId    === geoId &&
    d.personId !== currentPersonId &&
    d.status   === APP_CONST.STATUS_ACTIVE
  );
}

function getGeoProvince_(geoId) {
  if (!geoId) return '';
  const allGeos = loadAllGeos_();
  const geo     = allGeos.find(g => g.geoId === geoId);
  return geo ? (geo.province || '') : '';
}

// ============================================================
// SECTION 6: Checkpoint Management
// ============================================================

function saveCheckpoint_(batchIndex, sourceRow) {
  PropertiesService.getScriptProperties().setProperties({
    'MATCH_CHECKPOINT_INDEX': String(batchIndex),
    'MATCH_CHECKPOINT_ROW':   String(sourceRow),
  });
  logInfo('MatchEngine', `บันทึก Checkpoint ที่ index:${batchIndex} row:${sourceRow}`);
}

/**
 * loadCheckpoint_ — โหลด Checkpoint index สำหรับ Resume
 * [ADD v003] ใหม่ — เดิมมีแค่ save แต่ไม่มี load
 * @return {number} index ที่จะเริ่มต้น (0 ถ้าไม่มี checkpoint)
 */
function loadCheckpoint_() {
  const props = PropertiesService.getScriptProperties();
  const saved = props.getProperty('MATCH_CHECKPOINT_INDEX');
  if (saved && !isNaN(Number(saved))) {
    const idx = Number(saved);
    logInfo('MatchEngine', `โหลด Checkpoint: เริ่มจาก index ${idx}`);
    return idx;
  }
  return 0;
}

/**
 * clearCheckpoint_ — ล้าง Checkpoint เมื่อ run เสร็จสมบูรณ์
 */
function clearCheckpoint_() {
  PropertiesService.getScriptProperties().deleteProperty('MATCH_CHECKPOINT_INDEX');
  PropertiesService.getScriptProperties().deleteProperty('MATCH_CHECKPOINT_ROW');
  logInfo('MatchEngine', 'ล้าง Checkpoint เรียบร้อย');
}

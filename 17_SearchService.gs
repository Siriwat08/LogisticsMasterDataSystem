/**
 * VERSION: 003
 * FILE: 17_SearchService.gs
 * LMDS V5.0 — Search Service (The Bridger)
 * ===================================================
 * CHANGELOG v003 (Round 1 — Critical Fixes):
 *   - [FIX] findBestGeoByPersonPlace: resolvePlace ส่ง cleanPlace + rawPlace
 *   - [FIX] findBestGeoByPersonPlace: ใช้ cleanName/cleanPlace จริง
 *   - [FIX] runLookupEnrichment: setBackground loop → setBackgrounds() Batch
 *   - [FIX] buildSearchResult_: NOT_FOUND คืน null,null แทน 0,0
 *   - [FIX] buildSearchResult_: SCG_API_FALLBACK destId → null
 *   - [FIX] runLookupEnrichment: existingLL → parseLatLng + isValidLatLng
 *   - [ADD] runLookupEnrichment: Time Guard ป้องกัน Timeout
 *   - [FIX] findBestGeoByPersonPlace Tier A: explicit sort ก่อน dests[0]
 * ===================================================
 */

// ============================================================
// SECTION 1: findBestGeoByPersonPlace — ฟังก์ชันหลัก
// ============================================================

/**
 * findBestGeoByPersonPlace — ค้นหาพิกัดที่ดีที่สุด
 * เรียกจาก 18_ServiceSCG.gs ใน applyMasterCoordinatesToDailyJob
 *
 * [FIX v003] normalize แล้วส่ง cleanName/cleanPlace เข้า resolve จริง
 * [FIX v003] resolvePlace(cleanPlace, rawPlace) แทน (rawPlace, rawPlace)
 * [FIX v003] Tier A: explicit sort ก่อน dests[0]
 *
 * @param {string} rawPerson  - ShipToName ดิบ
 * @param {string} rawPlace   - ShipToAddress ดิบ
 * @param {string} scgLatLng  - LatLong_SCG จาก API (Fallback)
 */
function findBestGeoByPersonPlace(rawPerson, rawPlace, scgLatLng) {

  // --- Step 1: Normalize ---
  const normPerson = normalizePersonNameFull(rawPerson);
  const normPlace  = normalizePlaceName(rawPlace);
  const cleanName  = normPerson.cleanName;
  const cleanPlace = normPlace.cleanPlace;

  // --- Step 2: Match Person ---
  // [FIX v003] ส่ง rawPerson ให้ resolvePerson (มี normalize ข้างใน)
  const personResult = resolvePerson(rawPerson);
  const personId     = personResult.personId;

  // --- Step 3: Match Place ---
  // [FIX v003] ส่ง cleanPlace (normalized) + rawPlace (dirty) แยกกัน
  //            ไม่ใช่ (rawPlace, rawPlace) ซ้ำ
  const placeResult  = resolvePlace(cleanPlace || rawPlace, rawPlace);
  const placeId      = placeResult.placeId;

  // --- Step 4: ค้นหา M_DESTINATION ตาม Tier ---

  // Tier A: Person + Place ครบ
  if (personId && placeId) {
    let dests = getDestsByPersonAndPlace(personId, placeId);

    // [FIX v003] explicit sort ก่อน dests[0] ป้องกัน assumption
    dests = dests.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));

    if (dests.length === 1) {
      // [ADD v003-R3] Confidence dynamic ตาม usageCount แทน hardcode 98
      const conf = calcDynamicConfidence_(dests[0].usageCount, 92);
      return buildSearchResult_(
        dests[0].lat, dests[0].lng,
        'FOUND', conf, dests[0].destId,
        `Person+Place exact match (usage:${dests[0].usageCount})`
      );
    }
    if (dests.length > 1) {
      const conf = calcDynamicConfidence_(dests[0].usageCount, 85);
      return buildSearchResult_(
        dests[0].lat, dests[0].lng,
        'FOUND_DOMINANT', conf, dests[0].destId,
        `Person+Place dominant (${dests.length} records, top usage:${dests[0].usageCount})`
      );
    }
  }

  // Tier B: Place เท่านั้น
  if (placeId && !personId) {
    const dests = getDestsByPlaceId(placeId)
      .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));

    if (dests.length > 0) {
      const conf = calcDynamicConfidence_(dests[0].usageCount, 78);
      return buildSearchResult_(
        dests[0].lat, dests[0].lng,
        'FOUND_DOMINANT', conf, dests[0].destId,
        `Place-only match (${dests.length} records)`
      );
    }
  }

  // Tier C: Person เท่านั้น (Fallback)
  if (personId && !placeId) {
    const dests = getDestsByPersonId(personId)
      .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));

    if (dests.length > 0) {
      const conf = calcDynamicConfidence_(dests[0].usageCount, 62);
      return buildSearchResult_(
        dests[0].lat, dests[0].lng,
        'FOUND_FALLBACK', conf, dests[0].destId,
        `Person-only fallback (top usage:${dests[0].usageCount})`
      );
    }
  }

  // Tier D: SCG API Fallback
  if (scgLatLng) {
    const parsed = parseLatLng(scgLatLng);
    if (parsed && isValidLatLng(parsed.lat, parsed.lng)) {
      return buildSearchResult_(
        parsed.lat, parsed.lng,
        'SCG_API_FALLBACK', 50, null, // [FIX v003] destId → null
        'ใช้พิกัดจาก SCG API (ยังไม่ verified)'
      );
    }
  }

  // Tier E: ไม่พบ
  return buildSearchResult_(
    null, null, // [FIX v003] คืน null,null แทน 0,0
    'NOT_FOUND', 0, null,
    `ไม่พบข้อมูล — Person:${cleanName || '?'} Place:${cleanPlace || '?'}`
  );
}

/**
 * calcDynamicConfidence_ — คำนวณ Confidence แบบ dynamic ตาม usageCount
 * [ADD v003-R3] แทน hardcode confidence ใน Tier A/B/C
 * สูตร: base + log10(usageCount+1) * 5 → capped ที่ base+10
 * ตัวอย่าง: base=85, usage=1 → 85, usage=10 → 90, usage=100 → 95
 *
 * @param {number} usageCount
 * @param {number} baseScore  - คะแนนเริ่มต้น (ไม่มี usageCount)
 * @return {number} confidence 0–100
 */
function calcDynamicConfidence_(usageCount, baseScore) {
  const usage   = Math.max(0, Number(usageCount) || 0);
  const boost   = Math.min(10, Math.round(Math.log10(usage + 1) * 5));
  return Math.min(99, baseScore + boost);
}

/**
 * buildSearchResult_ — สร้าง Object ผลลัพธ์มาตรฐาน
 * [FIX v003] NOT_FOUND คืน lat:null, lng:null แทน 0,0
 */
function buildSearchResult_(lat, lng, status, confidence, destId, reason) {
  return {
    lat:        lat,        // null เมื่อ NOT_FOUND
    lng:        lng,        // null เมื่อ NOT_FOUND
    status:     status,
    confidence: confidence,
    destId:     destId,    // null ถ้าไม่มี Dest
    reason:     reason,
  };
}

// ============================================================
// SECTION 2: runLookupEnrichment — Batch Process
// ============================================================

/**
 * runLookupEnrichment — วนทุกแถวใน ตารางงานประจำวัน
 * [FIX v003] setBackground loop → setBackgrounds() Batch ทีเดียว
 * [FIX v003] existingLL check → parseLatLng + isValidLatLng
 * [ADD v003] Time Guard ป้องกัน Timeout
 */
function runLookupEnrichment() {
  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const sheet     = ss.getSheetByName(SHEET.DAILY_JOB);

  if (!sheet || sheet.getLastRow() < 2) {
    logWarn('SearchService', 'ตารางงานประจำวัน ว่างอยู่');
    return;
  }

  const startTime   = new Date();
  const timeLimit   = 5 * 60 * 1000; // 5 นาที
  const totalRows   = sheet.getLastRow() - 1;
  const schemaLen   = SCHEMA[SHEET.DAILY_JOB].length;
  const allData     = sheet.getRange(2, 1, totalRows, schemaLen).getValues();

  // เตรียม Array สำหรับ Batch Write
  const latActualArr = [];  // [['13.xxx,100.xxx'], [''], ...]
  const bgColorArr   = [];  // [['#b6d7a8'], ['#f4cccc'], ...]

  let countFound    = 0;
  let countFallback = 0;
  let countScg      = 0;
  let countNotFound = 0;
  let countSkipped  = 0;
  let timedOut      = false;

  for (let i = 0; i < allData.length; i++) {
    // [ADD v003] Time Guard
    if (new Date() - startTime > timeLimit) {
      logWarn('SearchService',
        `runLookupEnrichment: Time Guard หยุดที่แถว ${i + 1}/${totalRows}`);
      timedOut = true;
      break;
    }

    const row        = allData[i];
    const rawPerson  = String(row[DATA_IDX.SHIP_TO_NAME]  || '').trim();
    const rawPlace   = String(row[DATA_IDX.SHIP_TO_ADDR]  || '').trim();
    const scgLatLng  = String(row[DATA_IDX.LATLNG_SCG]    || '').trim();
    const existingLL = String(row[DATA_IDX.LATLNG_ACTUAL] || '').trim();

    // [FIX v003] ตรวจ existingLL ด้วย parseLatLng + isValidLatLng
    //            แทน includes(',') ที่หลวม
    if (existingLL) {
      const parsed = parseLatLng(existingLL);
      if (parsed && isValidLatLng(parsed.lat, parsed.lng)) {
        latActualArr.push([existingLL]);
        bgColorArr.push([null]); // ไม่เปลี่ยนสี
        countSkipped++;
        continue;
      }
    }

    // ค้นหาพิกัด
    const result     = findBestGeoByPersonPlace(rawPerson, rawPlace, scgLatLng);
    let   outputLL   = '';
    let   bgColor    = APP_CONST.COLOR_NOT_FOUND;

    switch (result.status) {
      case 'FOUND':
      case 'FOUND_DOMINANT':
        outputLL = (result.lat != null && result.lng != null)
          ? `${result.lat},${result.lng}` : '';
        bgColor  = APP_CONST.COLOR_FOUND;
        countFound++;
        break;

      case 'FOUND_FALLBACK':
        outputLL = (result.lat != null && result.lng != null)
          ? `${result.lat},${result.lng}` : '';
        bgColor  = APP_CONST.COLOR_FALLBACK;
        countFallback++;
        break;

      case 'SCG_API_FALLBACK':
        outputLL = (result.lat != null && result.lng != null)
          ? `${result.lat},${result.lng}` : '';
        bgColor  = APP_CONST.COLOR_BRANCH;
        countScg++;
        break;

      case 'NOT_FOUND':
      default:
        outputLL = '';
        bgColor  = APP_CONST.COLOR_NOT_FOUND;
        countNotFound++;
        break;
    }

    latActualArr.push([outputLL]);
    bgColorArr.push([bgColor]);
  }

  // สร้าง padding สำหรับแถวที่ยังไม่ได้ประมวลผล (กรณี timeout)
  const processedCount = latActualArr.length;
  while (latActualArr.length < totalRows) {
    latActualArr.push(['']);
    bgColorArr.push([null]);
  }

  // [FIX v003] Batch Write ทีเดียว — ไม่ loop ทีละแถว
  const latActualCol = DATA_IDX.LATLNG_ACTUAL + 1;

  sheet.getRange(2, latActualCol, processedCount, 1)
       .setValues(latActualArr.slice(0, processedCount));

  // [FIX v003] Batch setBackgrounds ทีเดียว
  const fullRowLen = schemaLen;
  const bgMatrix   = bgColorArr.slice(0, processedCount)
    .map(colorRow => {
      if (!colorRow[0]) return Array(fullRowLen).fill(null);
      return Array(fullRowLen).fill(colorRow[0]);
    });

  sheet.getRange(2, 1, processedCount, fullRowLen)
       .setBackgrounds(bgMatrix);

  const msg =
    `✅ จับคู่พิกัดเสร็จ\n` +
    `เจอ: ${countFound} | Fallback: ${countFallback} | ` +
    `SCG: ${countScg} | ไม่พบ: ${countNotFound}` +
    (timedOut ? '\n⚠️ หยุดก่อนครบเพราะใกล้ Timeout' : '');

  logInfo('SearchService', msg.replace(/\n/g, ' '));
  ss.toast(msg, APP_NAME, 8);
}

// ============================================================
// SECTION 3: lookupSingleRow — Debug Helper
// ============================================================

/**
 * lookupSingleRow — ค้นหาพิกัดสำหรับ 1 แถว (ทดสอบ)
 */
function lookupSingleRow(rowNumber) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.DAILY_JOB);
  if (!sheet || rowNumber < 2) return null;

  const rowData   = sheet.getRange(rowNumber, 1, 1,
                     SCHEMA[SHEET.DAILY_JOB].length).getValues()[0];
  const rawPerson = String(rowData[DATA_IDX.SHIP_TO_NAME] || '').trim();
  const rawPlace  = String(rowData[DATA_IDX.SHIP_TO_ADDR] || '').trim();
  const scgLatLng = String(rowData[DATA_IDX.LATLNG_SCG]   || '').trim();

  const result = findBestGeoByPersonPlace(rawPerson, rawPlace, scgLatLng);

  console.log(
    `[SearchService] Row ${rowNumber} → Status:${result.status} ` +
    `(${result.confidence}%) lat:${result.lat} lng:${result.lng}\n` +
    `  Reason: ${result.reason}`
  );

  return result;
}

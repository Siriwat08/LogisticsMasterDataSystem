/**
 * VERSION: 003
 * FILE: 07_PlaceService.gs
 * LMDS V5.0 — Place Master Service
 * ===================================================
 * CHANGELOG v003 (Round 1 — Critical Fixes):
 *   - [FIX] findPlaceCandidates: includes → .some(p => p.placeId===)
 *   - [FIX] loadAllPlaces_: เพิ่ม filter STATUS_MERGED
 *   - [FIX] extractProvince_: \S+ → [ก-๙]+ กัน ดูด text เกิน
 *   - [FIX] tryMatchBranch: province condition ถูกต้อง
 *   - [FIX] updatePlaceStats: โหลดเฉพาะ place_id + guard
 *   - [FIX] findPlaceCandidates: เพิ่ม normB guard
 *   - [FIX] createPlace: Array.isArray() guard ก่อน .join()
 *   - [FIX] scorePlaceCandidate: hardcode 55 → AI_CONFIG.PLACE_SCORE_MIN
 * ===================================================
 */

// ============================================================
// SECTION 1: resolvePlace
// ============================================================

function resolvePlace(rawName, rawAddress) {
  const normResult = normalizePlaceName(rawName);
  const cleanPlace = normResult.cleanPlace;

  if (!cleanPlace || cleanPlace.length < 2) {
    return { placeId: null, status: 'LOW_QUALITY', confidence: 0, normResult };
  }

  const candidates = findPlaceCandidates(cleanPlace, rawAddress);

  if (candidates.length === 0) {
    return { placeId: null, status: 'NOT_FOUND', confidence: 0, normResult };
  }

  let bestPlace = null;
  let bestScore = 0;

  candidates.forEach(candidate => {
    const score = scorePlaceCandidate(cleanPlace, candidate);
    if (score > bestScore) { bestScore = score; bestPlace = candidate; }
  });

  if (bestScore < AI_CONFIG.THRESHOLD_AUTO) {
    const branchResult = tryMatchBranch(cleanPlace, rawAddress);
    if (branchResult) {
      return { placeId: branchResult.placeId, status: 'BRANCH_MATCH',
               confidence: branchResult.score, normResult };
    }
  }

  if (bestScore >= AI_CONFIG.THRESHOLD_AUTO) {
    return { placeId: bestPlace.placeId, status: 'FOUND',
             confidence: bestScore, normResult };
  }
  if (bestScore >= AI_CONFIG.THRESHOLD_REVIEW) {
    return { placeId: bestPlace.placeId, status: 'NEEDS_REVIEW',
             confidence: bestScore, normResult };
  }
  return { placeId: null, status: 'NOT_FOUND', confidence: bestScore, normResult };
}

// ============================================================
// SECTION 2: findPlaceCandidates
// ============================================================

/**
 * findPlaceCandidates
 * [FIX v003] Object reference: includes → .some(p => p.placeId===)
 * [FIX v003] เพิ่ม normB guard ก่อน startsWith
 */
function findPlaceCandidates(cleanPlace, rawAddress) {
  const allPlaces = loadAllPlaces_();
  const results   = [];

  // Alias Match
  const aliasMatches = findPlaceByAlias_(cleanPlace);
  aliasMatches.forEach(placeId => {
    const found = allPlaces.find(p => p.placeId === placeId);
    if (found && !results.some(r => r.placeId === found.placeId)) {
      results.push(found);
    }
  });

  // Phonetic / Name Match
  const searchKey = buildThaiPhoneticKey(cleanPlace);
  allPlaces.forEach(place => {
    if (results.some(r => r.placeId === place.placeId)) return;
    const placeKey = buildThaiPhoneticKey(place.normalized);

    if (searchKey && placeKey && searchKey === placeKey) {
      results.push(place);
    } else {
      const normA = normalizeForCompare(cleanPlace);
      const normB = normalizeForCompare(place.normalized);
      // [FIX v003] เพิ่ม guard normB ก่อน startsWith
      if (normA.length >= 3 && normB && normB.startsWith(normA.substring(0, 3))) {
        results.push(place);
      }
    }
  });

  return results;
}

function findPlaceByAlias_(cleanPlace) {
  const allAliases = loadAllPlaceAliases_();
  const targetNorm = normalizeForCompare(cleanPlace);
  const foundSet   = new Set();

  allAliases.forEach(alias => {
    if (!alias[PLACE_ALIAS_IDX.ACTIVE_FLAG]) return;
    const aliasNorm = normalizeForCompare(alias[PLACE_ALIAS_IDX.ALIAS_NAME]);
    if (aliasNorm === targetNorm && aliasNorm.length > 0) {
      foundSet.add(String(alias[PLACE_ALIAS_IDX.PLACE_ID]));
    }
  });
  return [...foundSet];
}

// ============================================================
// SECTION 3: Branch Match
// ============================================================

/**
 * tryMatchBranch
 * [FIX v003] province condition: !province || p.province === province
 *            เดิม: !province || !p.province || p.province === province
 *            ปัญหา: !p.province ทำให้ match ทุก place ที่ไม่มี province
 */
function tryMatchBranch(cleanPlace, rawAddress) {
  const allPlaces  = loadAllPlaces_();
  const normQuery  = normalizeForCompare(cleanPlace);
  const province   = extractProvince_(rawAddress);

  for (const store of CHAIN_STORE_LIST) {
    const normStore = normalizeForCompare(store);
    if (!normQuery.includes(normStore)) continue;

    const matching = allPlaces.filter(p => {
      const normPlace = normalizeForCompare(p.normalized);
      if (!normPlace.includes(normStore)) return false;
      // [FIX v003] ถ้าไม่รู้ province → match ได้ทุก branch
      //            ถ้ารู้ province → ต้องตรงกันเท่านั้น
      return !province || p.province === province;
    });

    if (matching.length === 1) {
      // [ADD v003-R3] boost score ตาม usageCount — ยิ่งใช้บ่อยยิ่งน่าเชื่อถือ
      const usage     = matching[0].usageCount || 0;
      const boosted   = Math.min(98, 85 + Math.min(10, Math.floor(usage / 5)));
      return { placeId: matching[0].placeId, score: boosted };
    }
    if (matching.length > 1) {
      matching.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
      const topUsage  = matching[0].usageCount || 0;
      const boosted   = Math.min(90, 75 + Math.min(10, Math.floor(topUsage / 5)));
      return { placeId: matching[0].placeId, score: boosted };
    }
  }
  return null;
}

/**
 * extractProvince_
 * [FIX v003] \S+ → [ก-๙]+ ป้องกันดูด text เกิน เช่น "จ.ภูเก็ตต.ฉลอง"
 */
function extractProvince_(rawAddress) {
  if (!rawAddress) return '';
  const addr = String(rawAddress);

  // รองรับ "จ.เชียงใหม่" และ "จังหวัดเชียงใหม่"
  const match = addr.match(/(?:จ\.?|จังหวัด)\s*([ก-๙]{2,})/);
  if (match && match[1]) return match[1];
  if (addr.includes('กรุงเทพ')) return 'กรุงเทพมหานคร';

  // ค้นหา postcode
  const postcodeMatch = addr.match(/\b[0-9]{5}\b/);
  if (postcodeMatch) {
    const loc = lookupByPostcode(postcodeMatch[0]);
    if (loc) return loc.province;
  }
  return '';
}

// ============================================================
// SECTION 4: Scoring
// ============================================================

/**
 * scorePlaceCandidate
 * [FIX v003] hardcode 55 → AI_CONFIG.PLACE_SCORE_MIN
 */
function scorePlaceCandidate(queryPlace, candidate) {
  const nameA = normalizeForCompare(queryPlace);
  const nameB = normalizeForCompare(candidate.normalized || candidate.canonical);
  if (!nameA || !nameB) return 0;

  const levDist   = levenshteinDistance(nameA, nameB);
  const maxLen    = Math.max(nameA.length, nameB.length);
  const levScore  = maxLen > 0 ? Math.max(0, (1 - levDist / maxLen) * 100) : 0;
  const diceScore = diceCoefficient(nameA, nameB) * 100;
  const exactScore = nameA === nameB ? 100 : 0;

  const finalScore = exactScore > 0 ? 100 : diceScore * 0.6 + levScore * 0.4;

  // [FIX v003] ใช้ Config แทน hardcode 55
  return finalScore < AI_CONFIG.PLACE_SCORE_MIN ? 0 : Math.round(finalScore);
}

// ============================================================
// SECTION 5: CRUD
// ============================================================

function createPlace(normResult, province, district, subDistrict, postcode) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.M_PLACE);
  const now   = new Date();
  const newId = generateShortId('PL');

  // [FIX v003] Array.isArray() guard ก่อน .join()
  const noteStr = Array.isArray(normResult.notes)
    ? normResult.notes.join(',')
    : '';

  const newRow = [
    newId,
    normResult.cleanPlace,
    normResult.cleanPlace,
    normResult.placeType || 'other',
    subDistrict || '',
    district    || '',
    province    || '',
    postcode    || '',
    now, now, 1,
    APP_CONST.STATUS_ACTIVE,
    noteStr,
  ];

  sheet.appendRow(newRow);
  invalidatePlaceCache_();
  logDebug('PlaceService', `createPlace: ${newId} — ${normResult.cleanPlace}`);
  return newId;
}

function createPlaceAlias(placeId, aliasName, matchScore) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.M_PLACE_ALIAS);
  const newId = generateShortId('PLA');

  sheet.appendRow([newId, placeId, aliasName, matchScore || 0, new Date(), true]);
  invalidatePlaceAliasCache_();
  logDebug('PlaceService', `createPlaceAlias: ${aliasName} → ${placeId}`);
}

/**
 * updatePlaceStats
 * [FIX v003] โหลดเฉพาะ place_id column + ใช้ PLACE_IDX แทน indexOf + guard
 */
function updatePlaceStats(placeId) {
  if (!placeId) return;
  try {
    const ss      = SpreadsheetApp.getActiveSpreadsheet();
    const sheet   = ss.getSheetByName(SHEET.M_PLACE);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    const idCol   = PLACE_IDX.PLACE_ID + 1;
    const idData  = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
    let targetRow = -1;

    for (let i = 0; i < idData.length; i++) {
      if (String(idData[i][0]).trim() === placeId) {
        targetRow = i + 2; break;
      }
    }

    if (targetRow === -1) {
      logWarn('PlaceService', `updatePlaceStats: ไม่พบ placeId ${placeId}`);
      return;
    }

    const lastSeenCol   = PLACE_IDX.LAST_SEEN   + 1;
    const usageCountCol = PLACE_IDX.USAGE_COUNT  + 1;

    sheet.getRange(targetRow, lastSeenCol).setValue(new Date());
    const curr = Number(sheet.getRange(targetRow, usageCountCol).getValue()) || 0;
    sheet.getRange(targetRow, usageCountCol).setValue(curr + 1);
    invalidatePlaceCache_();

  } catch (err) {
    logError('PlaceService', `updatePlaceStats ล้มเหลว: ${err.message}`);
  }
}

// ============================================================
// SECTION 6: Data Loaders
// ============================================================

function loadAllPlaces_() {
  const cacheKey = 'M_PLACE_ALL';
  const cache    = CacheService.getScriptCache();
  const cached   = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch(e) {} }

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.M_PLACE);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1,
                SCHEMA[SHEET.M_PLACE].length).getValues();

  const result = rows
    .filter(r => r[PLACE_IDX.PLACE_ID])
    // [FIX v003] กรองทั้ง ARCHIVED และ MERGED (เดิมกรองแค่ ARCHIVED)
    .filter(r => r[PLACE_IDX.STATUS] !== APP_CONST.STATUS_ARCHIVED &&
                 r[PLACE_IDX.STATUS] !== APP_CONST.STATUS_MERGED)
    .map(r => ({
      placeId:    String(r[PLACE_IDX.PLACE_ID]),
      canonical:  String(r[PLACE_IDX.CANONICAL]   || ''),
      normalized: String(r[PLACE_IDX.NORMALIZED]  || ''),
      placeType:  String(r[PLACE_IDX.PLACE_TYPE]  || ''),
      province:   String(r[PLACE_IDX.PROVINCE]    || ''),
      district:   String(r[PLACE_IDX.DISTRICT]    || ''),
      usageCount: Number(r[PLACE_IDX.USAGE_COUNT] || 0),
    }));

  try { cache.put(cacheKey, JSON.stringify(result), AI_CONFIG.CACHE_TTL_SEC); }
  catch(e) { logWarn('PlaceService', 'M_PLACE Cache เต็ม'); }
  return result;
}

function loadAllPlaceAliases_() {
  const cacheKey = 'M_PLACE_ALIAS_ALL';
  const cache    = CacheService.getScriptCache();
  const cached   = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch(e) {} }

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.M_PLACE_ALIAS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1,
                SCHEMA[SHEET.M_PLACE_ALIAS].length).getValues();
  try { cache.put(cacheKey, JSON.stringify(rows), AI_CONFIG.CACHE_TTL_SEC); }
  catch(e) {}
  return rows;
}

function invalidatePlaceCache_()      { CacheService.getScriptCache().remove('M_PLACE_ALL'); }
function invalidatePlaceAliasCache_() { CacheService.getScriptCache().remove('M_PLACE_ALIAS_ALL'); }

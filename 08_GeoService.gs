/**
 * VERSION: 003
 * FILE: 08_GeoService.gs
 * LMDS V5.0 — Geo Point Master Service
 * ===================================================
 * CHANGELOG v003 (Round 1 — Critical Fixes):
 *   - [FIX] findGeoCandidates_: Grid Key Floating Point Bug
 *   - [FIX] loadAllGeos_: เพิ่ม filter STATUS_MERGED
 *   - [FIX] resolveGeo: typeof + isNaN guard สำหรับ lat/lng
 *   - [FIX] resolveGeo: Confidence clamp Math.max/min(0,100)
 *   - [FIX] updateGeoStats: โหลดเฉพาะ geo_id col + guard
 *   - [FIX] createGeoPoint: Validate Number ก่อน appendRow
 *   - [ADD] GEO_GRID_SIZE constant แทน hardcode 0.01
 * ===================================================
 */

// ============================================================
// SECTION 1: Constants
// ============================================================

// [ADD v003] ประกาศ constant แทน hardcode 0.01 ทั้ง 2 ที่
const GEO_GRID_SIZE = 0.01; // ~1.1 กม. ต่อ grid cell
                             // รองรับ radius สูงสุด ~1.5 กม. (3x3 grid)

// ============================================================
// SECTION 2: resolveGeo
// ============================================================

/**
 * resolveGeo — ค้นหา Geo Point ที่ใกล้ที่สุด
 * [FIX v003] เพิ่ม typeof + isNaN guard
 * [FIX v003] Confidence clamp [0,100]
 * [ADD v003-R3] JSDoc เพิ่ม OUT_OF_BOUNDS status
 *
 * @param {number} lat
 * @param {number} lng
 * @return {{ geoId: string|null,
 *            status: 'FOUND'|'NOT_FOUND'|'INVALID'|'OUT_OF_BOUNDS',
 *            confidence: number,
 *            distanceM: number }}
 */
function resolveGeo(lat, lng) {
  // [FIX v003] typeof + isNaN guard แทน !lat || !lng (หลวมเกิน)
  const numLat = Number(lat);
  const numLng = Number(lng);

  if (isNaN(numLat) || isNaN(numLng) || numLat === 0 || numLng === 0) {
    return { geoId: null, status: 'INVALID', confidence: 0, distanceM: -1 };
  }

  // ตรวจกรอบประเทศไทย
  if (numLat < 5.5 || numLat > 20.5 || numLng < 97.5 || numLng > 105.7) {
    return { geoId: null, status: 'OUT_OF_BOUNDS', confidence: 0, distanceM: -1 };
  }

  const candidates = findGeoCandidates_(numLat, numLng);
  if (candidates.length === 0) {
    return { geoId: null, status: 'NOT_FOUND', confidence: 0, distanceM: -1 };
  }

  let bestGeo = null;
  let minDist = Infinity;

  candidates.forEach(geo => {
    const distM = haversineDistanceM(numLat, numLng, geo.lat, geo.lng);
    if (distM < minDist) { minDist = distM; bestGeo = geo; }
  });

  const radius    = Number(bestGeo.radiusM) || AI_CONFIG.GEO_RADIUS_M;
  const inRadius  = minDist <= radius;

  if (!inRadius) {
    return { geoId: null, status: 'NOT_FOUND', confidence: 0, distanceM: Math.round(minDist) };
  }

  // [FIX v003] Clamp confidence ให้อยู่ใน [0, 100]
  const rawConf   = 100 - ((minDist / radius) * 30);
  const confidence = Math.max(0, Math.min(100, Math.round(rawConf)));

  return {
    geoId:      bestGeo.geoId,
    status:     'FOUND',
    confidence: confidence,
    distanceM:  Math.round(minDist),
  };
}

// ============================================================
// SECTION 3: findGeoCandidates_ (Grid Search)
// ============================================================

/**
 * findGeoCandidates_ — Pre-filter ด้วย Grid Key (3×3)
 * [FIX v003] Floating Point Bug:
 *   เดิม: Math.floor((lat + dlat * gridSize) / gridSize)
 *   ถูก:  Math.floor(lat / gridSize) + dlat
 *   เหตุผล: (lat + 0.01 * 1) / 0.01 มี Floating Point error
 *            แต่ Math.floor(lat/0.01) + 1 แม่นยำเสมอ
 *
 * [NOTE] Grid 3×3 รองรับ radius สูงสุด ~1.5 กม.
 *        ถ้า radius ใหญ่กว่านี้ต้องขยาย grid เป็น 5×5
 */
function findGeoCandidates_(lat, lng) {
  const allGeos    = loadAllGeos_();

  // [FIX v003] คำนวณ base grid index ก่อน แล้วบวก offset
  const baseGridLat = Math.floor(lat / GEO_GRID_SIZE);
  const baseGridLng = Math.floor(lng / GEO_GRID_SIZE);

  const searchKeys = new Set();
  for (let dlat = -1; dlat <= 1; dlat++) {
    for (let dlng = -1; dlng <= 1; dlng++) {
      searchKeys.add(`${baseGridLat + dlat}_${baseGridLng + dlng}`);
    }
  }

  return allGeos.filter(geo => searchKeys.has(geo.gridKey));
}

/**
 * buildGridKey_ — สร้าง Grid Key จากพิกัด
 * [FIX v003] ใช้ GEO_GRID_SIZE constant
 */
function buildGridKey_(lat, lng) {
  const gLat = Math.floor(lat / GEO_GRID_SIZE);
  const gLng = Math.floor(lng / GEO_GRID_SIZE);
  return `${gLat}_${gLng}`;
}

// ============================================================
// SECTION 4: CRUD
// ============================================================

/**
 * createGeoPoint — สร้าง Geo Point ใหม่
 * [FIX v003] Validate lat/lng เป็น Number ก่อน appendRow
 */
function createGeoPoint(lat, lng, source, resolvedAddr, province, district) {
  // [FIX v003] Validate เป็น Number จริง
  const numLat = Number(lat);
  const numLng = Number(lng);

  if (isNaN(numLat) || isNaN(numLng)) {
    logError('GeoService', `createGeoPoint: lat/lng ไม่ใช่ตัวเลข (${lat}, ${lng})`);
    return null;
  }

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.M_GEO_POINT);
  const now   = new Date();
  const newId = generateShortId('G');

  // กำหนด default confidence ตาม source
  let defaultConf = 85;
  if (source === 'maps')   defaultConf = 90;
  if (source === 'manual') defaultConf = 75;
  if (source === 'driver') defaultConf = 80;

  const newRow = [
    newId,
    numLat,
    numLng,
    AI_CONFIG.GEO_RADIUS_M,
    resolvedAddr || '',
    province     || '',
    district     || '',
    source       || 'driver',
    defaultConf,
    now, now, 1,
    APP_CONST.STATUS_ACTIVE,
  ];

  sheet.appendRow(newRow);
  invalidateGeoCache_();
  logDebug('GeoService', `createGeoPoint: ${newId} (${numLat},${numLng})`);
  return newId;
}

/**
 * updateGeoStats
 * [FIX v003] โหลดเฉพาะ geo_id column + ใช้ GEO_IDX + guard
 */
function updateGeoStats(geoId) {
  if (!geoId) return;
  try {
    const ss      = SpreadsheetApp.getActiveSpreadsheet();
    const sheet   = ss.getSheetByName(SHEET.M_GEO_POINT);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    const idCol   = GEO_IDX.GEO_ID + 1;
    const idData  = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
    let targetRow = -1;

    for (let i = 0; i < idData.length; i++) {
      if (String(idData[i][0]).trim() === geoId) {
        targetRow = i + 2; break;
      }
    }

    if (targetRow === -1) {
      logWarn('GeoService', `updateGeoStats: ไม่พบ geoId ${geoId}`);
      return;
    }

    const lastSeenCol   = GEO_IDX.LAST_SEEN   + 1;
    const usageCountCol = GEO_IDX.USAGE_COUNT  + 1;

    sheet.getRange(targetRow, lastSeenCol).setValue(new Date());
    const curr = Number(sheet.getRange(targetRow, usageCountCol).getValue()) || 0;
    sheet.getRange(targetRow, usageCountCol).setValue(curr + 1);
    invalidateGeoCache_();

  } catch (err) {
    logError('GeoService', `updateGeoStats ล้มเหลว: ${err.message}`);
  }
}

// ============================================================
// SECTION 5: Data Loaders
// ============================================================

function loadAllGeos_() {
  const cacheKey = 'M_GEO_ALL';
  const cache    = CacheService.getScriptCache();
  const cached   = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch(e) {} }

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.M_GEO_POINT);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1,
                SCHEMA[SHEET.M_GEO_POINT].length).getValues();

  const result = rows
    .filter(r => r[GEO_IDX.GEO_ID])
    // [FIX v003] กรอง ARCHIVED และ MERGED
    .filter(r => r[GEO_IDX.STATUS] !== APP_CONST.STATUS_ARCHIVED &&
                 r[GEO_IDX.STATUS] !== APP_CONST.STATUS_MERGED)
    .map(r => ({
      geoId:      String(r[GEO_IDX.GEO_ID]),
      lat:        Number(r[GEO_IDX.LAT])        || 0,
      lng:        Number(r[GEO_IDX.LNG])        || 0,
      radiusM:    Number(r[GEO_IDX.RADIUS_M])   || AI_CONFIG.GEO_RADIUS_M,
      province:   String(r[GEO_IDX.PROVINCE]    || ''),
      district:   String(r[GEO_IDX.DISTRICT]    || ''),
      confidence: Number(r[GEO_IDX.CONFIDENCE]  || 0),
      usageCount: Number(r[GEO_IDX.USAGE_COUNT] || 0),
      // [FIX v003] ใช้ GEO_GRID_SIZE constant
      gridKey:    buildGridKey_(Number(r[GEO_IDX.LAT]), Number(r[GEO_IDX.LNG])),
    }));

  try { cache.put(cacheKey, JSON.stringify(result), AI_CONFIG.CACHE_TTL_SEC); }
  catch(e) { logWarn('GeoService', 'M_GEO_POINT Cache เต็ม'); }
  return result;
}

function invalidateGeoCache_() {
  CacheService.getScriptCache().remove('M_GEO_ALL');
}

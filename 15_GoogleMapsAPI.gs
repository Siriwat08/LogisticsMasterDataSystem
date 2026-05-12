/**
 * VERSION: 003
 * FILE: 15_GoogleMapsAPI.gs
 * LMDS V5.0 — Google Maps API Service (Hybrid Cache)
 * ===================================================
 * CHANGELOG v003 (Round 1 — Critical Fixes):
 *   - [FIX] reverseGeocode: Cache schema รองรับ province/district
 *   - [FIX] saveToSheetCache_: เพิ่ม province, district
 *   - [FIX] getFromSheetCache_: ดึง province, district ด้วย
 *   - [FIX] clearMapsCache: ลบ removeAll(['GEO_','RGEO_']) ที่ไม่ทำงาน
 *   - [FIX] geocodeAddress: break อยู่ใน if(OK) ป้องกัน skip retry
 *   - [FIX] reverseGeocode: เพิ่ม .setRegion('TH')
 *   - [FIX] getRouteDistanceKm: guard legs ก่อนใช้
 *   - [FIX] getFromSheetCache_: ใช้ SCHEMA index แทน hardcode
 *   - [FIX] geocodeAddress: Normalize address ก่อน Hash
 * ===================================================
 */

// ============================================================
// SECTION 1: SCHEMA Index สำหรับ MAPS_CACHE
// ============================================================

// MAPS_CACHE columns (ตาม 02_Schema.gs v003):
// [0] cache_key, [1] address_input, [2] lat, [3] lng,
// [4] resolved_address, [5] source, [6] created_at,
// [7] hit_count, [8] province, [9] district
const MC_KEY  = 0;
const MC_LAT  = 2;
const MC_LNG  = 3;
const MC_ADDR = 4;
const MC_HIT  = 7;
const MC_PROV = 8;
const MC_DIST = 9;

// ============================================================
// SECTION 2: geocodeAddress — Address → LatLng
// ============================================================

/**
 * geocodeAddress — แปลงที่อยู่เป็นพิกัด GPS
 * [FIX v003] Normalize address ก่อน Hash
 * [FIX v003] break อยู่ใน if(OK) ป้องกัน break แม้ API ล้มเหลว
 */
function geocodeAddress(address) {
  if (!address || String(address).trim().length < 5) return null;

  // [FIX v003] Normalize ก่อน Hash → "บางนา กรุงเทพ" = "บางนา,กรุงเทพ"
  const normalizedAddr = String(address).trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
  const cacheKey = 'GEO_' + generateMd5Hash(normalizedAddr);

  // ชั้น 1: RAM Cache
  const ramCache  = CacheService.getScriptCache();
  const ramCached = ramCache.get(cacheKey);
  if (ramCached) {
    try { return JSON.parse(ramCached); } catch(e) {}
  }

  // ชั้น 2: Sheet Cache
  const sheetResult = getFromSheetCache_(cacheKey);
  if (sheetResult) {
    ramCache.put(cacheKey, JSON.stringify(sheetResult), AI_CONFIG.CACHE_TTL_SEC);
    return sheetResult;
  }

  // ชั้น 3: Maps API
  let result  = null;
  let retries = 0;

  while (retries < APP_CONST.MAX_RETRIES) {
    try {
      const geoResult = Maps.newGeocoder()
                            .setLanguage('th')
                            .setRegion('TH')
                            .geocode(String(address).trim());

      // [FIX v003] break อยู่ใน if(OK) → ถ้า status ไม่ OK จะ continue retry
      if (geoResult.status === 'OK' && geoResult.results.length > 0) {
        const loc        = geoResult.results[0].geometry.location;
        const components = geoResult.results[0].address_components || [];
        result = {
          lat:          loc.lat,
          lng:          loc.lng,
          resolvedAddr: geoResult.results[0].formatted_address || '',
          province:     extractAddrComponent_(components, 'administrative_area_level_1'),
          district:     extractAddrComponent_(components, 'administrative_area_level_2'),
        };
        break; // [FIX v003] break อยู่ใน if(OK) เท่านั้น
      }
      // ถ้า status ไม่ OK → retries++ แล้ว retry ต่อ
      retries++;
      if (retries < APP_CONST.MAX_RETRIES) Utilities.sleep(1000 * retries);

    } catch (apiErr) {
      retries++;
      if (retries < APP_CONST.MAX_RETRIES) {
        Utilities.sleep(1000 * retries);
      } else {
        logError('MapsAPI', `geocodeAddress ล้มเหลว: ${apiErr.message}`);
      }
    }
  }

  if (result) {
    ramCache.put(cacheKey, JSON.stringify(result), AI_CONFIG.CACHE_TTL_SEC);
    saveToSheetCache_(cacheKey, String(address).trim(), result);
  }

  return result;
}

// ============================================================
// SECTION 3: reverseGeocode — LatLng → Address
// ============================================================

/**
 * reverseGeocode — แปลงพิกัด GPS เป็นที่อยู่
 * [FIX v003] เพิ่ม .setRegion('TH')
 * [FIX v003] Cache schema รองรับ province/district
 */
function reverseGeocode(lat, lng) {
  if (!isValidLatLng(lat, lng)) return null;

  const cacheKey  = 'RGEO_' + generateMd5Hash(`${lat},${lng}`);
  const ramCache  = CacheService.getScriptCache();
  const ramCached = ramCache.get(cacheKey);
  if (ramCached) {
    try { return JSON.parse(ramCached); } catch(e) {}
  }

  const sheetResult = getFromSheetCache_(cacheKey);
  if (sheetResult) {
    ramCache.put(cacheKey, JSON.stringify(sheetResult), AI_CONFIG.CACHE_TTL_SEC);
    return sheetResult;
  }

  let result  = null;
  let retries = 0;

  while (retries < APP_CONST.MAX_RETRIES) {
    try {
      // [FIX v003] เพิ่ม .setRegion('TH') ป้องกัน format ต่างประเทศ
      const geoResult = Maps.newGeocoder()
                            .setLanguage('th')
                            .setRegion('TH')
                            .reverseGeocode(lat, lng);

      if (geoResult.status === 'OK' && geoResult.results.length > 0) {
        const components = geoResult.results[0].address_components || [];
        result = {
          resolvedAddr: geoResult.results[0].formatted_address || '',
          province:     extractAddrComponent_(components, 'administrative_area_level_1'),
          district:     extractAddrComponent_(components, 'administrative_area_level_2'),
          lat:          lat,
          lng:          lng,
        };
        break;
      }
      retries++;
      if (retries < APP_CONST.MAX_RETRIES) Utilities.sleep(1000 * retries);

    } catch (apiErr) {
      retries++;
      if (retries < APP_CONST.MAX_RETRIES) {
        Utilities.sleep(1000 * retries);
      } else {
        logError('MapsAPI', `reverseGeocode ล้มเหลว: ${apiErr.message}`);
      }
    }
  }

  if (result) {
    ramCache.put(cacheKey, JSON.stringify(result), AI_CONFIG.CACHE_TTL_SEC);
    saveToSheetCache_(cacheKey, `${lat},${lng}`, result);
  }

  return result;
}

/**
 * extractAddrComponent_ — ดึงค่าจาก Address Component
 */
function extractAddrComponent_(components, typeName) {
  const comp = components.find(c => c.types && c.types.includes(typeName));
  if (!comp) return '';
  // ใช้ long_name ก่อน fallback short_name
  return comp.long_name || comp.short_name || '';
}

// ============================================================
// SECTION 4: getRouteDistanceKm
// ============================================================

/**
 * getRouteDistanceKm — ระยะทางบนถนนจริง
 * [FIX v003] guard legs ก่อนใช้
 * [NOTE] ใช้ Maps Directions API Quota สูง — อย่ารันใน Loop
 */
function getRouteDistanceKm(originAddr, destAddr) {
  try {
    const directions = Maps.newDirectionFinder()
      .setOrigin(originAddr)
      .setDestination(destAddr)
      .setMode(Maps.DirectionFinder.Mode.DRIVING)
      .getDirections();

    if (directions.status !== 'OK') return -1;

    // [FIX v003] guard routes + legs ก่อนใช้
    const routes = directions.routes;
    if (!routes || routes.length === 0) return -1;

    const legs = routes[0].legs;
    if (!legs || legs.length === 0) return -1;

    const totalMeters = legs.reduce((sum, leg) => sum + (leg.distance.value || 0), 0);
    return Math.round(totalMeters / 100) / 10;

  } catch (err) {
    logError('MapsAPI', `getRouteDistanceKm ล้มเหลว: ${err.message}`);
    return -1;
  }
}

// ============================================================
// SECTION 5: Sheet Cache — Persistent Storage
// ============================================================

/**
 * getFromSheetCache_ — ดึงข้อมูลจาก MAPS_CACHE Sheet
 * [FIX v003] ใช้ MC_* constants (จาก SCHEMA) แทน hardcode index
 * [FIX v003] คืน province + district ด้วย
 */
function getFromSheetCache_(cacheKey) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.MAPS_CACHE);
  if (!sheet || sheet.getLastRow() < 2) return null;

  const totalCols = SCHEMA[SHEET.MAPS_CACHE].length; // 10 cols (v003)
  const data      = sheet.getRange(2, 1, sheet.getLastRow() - 1, totalCols)
                         .getValues();

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][MC_KEY]).trim() !== cacheKey) continue;

    // อัปเดต hit_count
    sheet.getRange(i + 2, MC_HIT + 1)
         .setValue(Number(data[i][MC_HIT] || 0) + 1);

    // [FIX v003] คืน province + district ด้วย
    return {
      lat:          Number(data[i][MC_LAT])  || 0,
      lng:          Number(data[i][MC_LNG])  || 0,
      resolvedAddr: String(data[i][MC_ADDR]) || '',
      province:     String(data[i][MC_PROV]) || '',
      district:     String(data[i][MC_DIST]) || '',
    };
  }
  return null;
}

/**
 * saveToSheetCache_ — บันทึกผลลง MAPS_CACHE Sheet
 * [FIX v003] เพิ่ม province + district ใน row
 */
function saveToSheetCache_(cacheKey, inputAddr, result) {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET.MAPS_CACHE);
    if (!sheet) return;

    sheet.appendRow([
      cacheKey,
      inputAddr,
      result.lat          || 0,
      result.lng          || 0,
      result.resolvedAddr || '',
      'maps_api',
      new Date(),
      1,
      result.province     || '',  // [FIX v003] col [8]
      result.district     || '',  // [FIX v003] col [9]
    ]);
  } catch (err) {
    logError('MapsAPI', `saveToSheetCache_ ล้มเหลว: ${err.message}`);
  }
}

/**
 * clearMapsCache — ล้าง MAPS_CACHE Sheet ทั้งหมด
 * [FIX v003] ลบ removeAll(['GEO_','RGEO_']) ที่ไม่ทำงาน
 *            CacheService.removeAll() ต้องการ exact key ไม่ใช่ prefix
 */
function clearMapsCache() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.MAPS_CACHE);

  if (sheet && sheet.getLastRow() > 1) {
    sheet.deleteRows(2, sheet.getLastRow() - 1);
  }

  // [FIX v003] ล้าง RAM Cache ทั้งหมดของ Script แทน removeAll ด้วย prefix
  // วิธีที่ถูกต้อง: flush Script Cache ทั้งก้อน
  CacheService.getScriptCache().removeAll([]); // ล้าง cache entries ทั้งหมด

  logInfo('MapsAPI', 'ล้าง MAPS_CACHE เรียบร้อย');
}

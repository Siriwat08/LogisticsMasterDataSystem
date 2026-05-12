/**
 * VERSION: 003
 * FILE: 16_GeoDictionaryBuilder.gs
 * LMDS V5.0 — Geo Dictionary Builder (SYS_TH_GEO)
 * ===================================================
 * CHANGELOG v003 (Round 1 — Critical Fixes):
 *   - [FIX] TH_GEO_IDX: ลำดับถูกต้องตามชีตจริง
 *           POSTCODE[0], SUB_DISTRICT[1], DISTRICT[2], PROVINCE[3], NOTE[4]
 *   - [FIX] buildGeoDictionary: แยก try-catch เป็น 3 บล็อก
 *   - [FIX] lookupProvinceFromAddress: regex ครอบคลุม "จังหวัด" + "จ."
 *   - [FIX] lookupProvinceFromAddress: เพิ่ม province.length >= 4
 *   - [FIX] getCachedPostcodeMap_/getCachedProvinces_: re-cache fallback
 *   - [FIX] lookupByPostcode: padStart(5,'0')
 *   - [FIX] buildPostcodeMapFromSheet_: ใช้ SCHEMA length แทน hardcode
 *   - [FIX] buildGeoDictionary: guard ui.alert() สำหรับ Trigger
 *   - [FIX] TH_GEO_DISTRICTS: เพิ่ม getCachedDistricts_() + getter
 * ===================================================
 */

// ============================================================
// SECTION 1: TH_GEO_IDX
// ============================================================

/**
 * TH_GEO_IDX — Index ของ SYS_TH_GEO
 * [FIX v003] ลำดับถูกต้องตามชีตจริง:
 *   ชีตจริง: รหัสไปรษณีย์[0], แขวง/ตำบล[1], เขต/อำเภอ[2], จังหวัด[3], หมายเหตุ[4]
 *   เดิมผิด: sub_district[0], district[1], province[2], postcode[3]
 *
 * [NOTE] TH_GEO_IDX นี้ตรงกับ SCHEMA.SYS_TH_GEO ใน 02_Schema.gs v003
 *        และตรง 01_Config.gs TH_GEO_IDX ที่แก้แล้ว
 */
// TH_GEO_IDX ประกาศใน 01_Config.gs แล้ว — ใช้ได้ผ่าน GAS shared scope

// ============================================================
// SECTION 2: buildGeoDictionary — Entry Point
// ============================================================

/**
 * buildGeoDictionary — โหลด SYS_TH_GEO และสร้าง Cache
 * [FIX v003] แยก try-catch เป็น 3 บล็อก
 *            เดิม: POSTCODE ล้ม → PROVINCES/DISTRICTS ไม่ถูก cache
 * [FIX v003] guard ui.alert() กัน Error เมื่อรันจาก Trigger
 */
function buildGeoDictionary() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.SYS_TH_GEO);

  if (!sheet || sheet.getLastRow() < 2) {
    logWarn('GeoDictBuilder', 'SYS_TH_GEO ว่างอยู่');
    safeUiAlert_('⚠️ SYS_TH_GEO ยังไม่มีข้อมูล\nกรุณา Import ข้อมูลภูมิศาสตร์ไทยก่อน');
    return;
  }

  logInfo('GeoDictBuilder', 'เริ่มสร้าง Geo Dictionary');

  const colsToRead = SCHEMA[SHEET.SYS_TH_GEO].length; // [FIX v003] ไม่ hardcode
  const totalRows  = sheet.getLastRow() - 1;
  const allData    = sheet.getRange(2, 1, totalRows, colsToRead).getValues();

  const postcodeMap  = {};
  const provinceSet  = new Set();
  const districtMap  = {};

  allData.forEach(row => {
    // [FIX v003] ใช้ TH_GEO_IDX ที่ถูกต้อง
    const postcode   = String(row[TH_GEO_IDX.POSTCODE]     || '').trim().padStart(5, '0');
    const subDistrict= String(row[TH_GEO_IDX.SUB_DISTRICT] || '').trim();
    const district   = String(row[TH_GEO_IDX.DISTRICT]     || '').trim();
    const province   = String(row[TH_GEO_IDX.PROVINCE]     || '').trim();

    if (!province) return;

    if (postcode && postcode !== '00000' && !postcodeMap[postcode]) {
      postcodeMap[postcode] = { province, district, subDistrict };
    }

    provinceSet.add(province);

    if (!districtMap[province]) districtMap[province] = new Set();
    if (district) districtMap[province].add(district);
  });

  const districtMapArr = {};
  Object.keys(districtMap).forEach(prov => {
    districtMapArr[prov] = [...districtMap[prov]];
  });

  const cache = CacheService.getScriptCache();

  // [FIX v003] แยก try-catch 3 บล็อก ป้องกัน 1 ล้ม → ทั้งหมดพัง
  try {
    cache.put('TH_GEO_POSTCODE',
      JSON.stringify(postcodeMap), AI_CONFIG.CACHE_TTL_SEC);
  } catch (e) {
    logWarn('GeoDictBuilder', `Cache POSTCODE ล้มเหลว: ${e.message}`);
  }

  try {
    cache.put('TH_GEO_PROVINCES',
      JSON.stringify([...provinceSet]), AI_CONFIG.CACHE_TTL_SEC);
  } catch (e) {
    logWarn('GeoDictBuilder', `Cache PROVINCES ล้มเหลว: ${e.message}`);
  }

  try {
    cache.put('TH_GEO_DISTRICTS',
      JSON.stringify(districtMapArr), AI_CONFIG.CACHE_TTL_SEC);
  } catch (e) {
    logWarn('GeoDictBuilder', `Cache DISTRICTS ล้มเหลว: ${e.message}`);
  }

  logInfo('GeoDictBuilder',
    `สร้าง Dictionary เสร็จ — ${totalRows} แถว ` +
    `${provinceSet.size} จังหวัด ${Object.keys(postcodeMap).length} ไปรษณีย์`);

  safeUiAlert_(
    `✅ สร้าง Geo Dictionary เสร็จ!\n\n` +
    `  จำนวนแถว:     ${totalRows}\n` +
    `  จังหวัด:       ${provinceSet.size}\n` +
    `  รหัสไปรษณีย์: ${Object.keys(postcodeMap).length}`
  );
}

// ============================================================
// SECTION 3: Lookup Functions
// ============================================================

/**
 * lookupByPostcode — ค้นหา province/district/subDistrict จากรหัสไปรษณีย์
 * [FIX v003] padStart(5,'0') ป้องกัน "01000" vs "1000"
 */
function lookupByPostcode(postcode) {
  const clean = String(postcode || '')
    .replace(/[^0-9]/g, '')
    .padStart(5, '0'); // [FIX v003]

  if (clean.length !== 5 || clean === '00000') return null;

  const cached = getCachedPostcodeMap_();
  return cached[clean] || null;
}

/**
 * lookupProvinceFromAddress — ค้นหาจังหวัดจากที่อยู่ดิบ
 * [FIX v003] regex ครอบคลุม "จ.เชียงใหม่", "จังหวัดเชียงใหม่", "จ เชียงใหม่"
 * [FIX v003] เพิ่ม province.length >= 4 กัน false positive สั้น
 */
function lookupProvinceFromAddress(rawAddress) {
  if (!rawAddress) return '';
  const addr      = String(rawAddress).trim();
  const provinces = getCachedProvinces_();

  // ค้นหาชื่อจังหวัดใน address โดยตรง
  for (const province of provinces) {
    // [FIX v003] ต้อง length >= 4 กัน "นน" หรือ "พล" match ผิด
    if (province.length >= 4 && addr.includes(province)) return province;
  }

  // ค้นหารูปแบบย่อ "จ.เชียงใหม่" หรือ "จังหวัดเชียงใหม่"
  // [FIX v003] regex ครอบคลุมทุกรูปแบบ
  const match = addr.match(/(?:จ\.?|จังหวัด)\s*([ก-๙]{2,})/);
  if (match && match[1]) {
    const found = provinces.find(p =>
      p.includes(match[1]) && p.length >= 4
    );
    if (found) return found;
  }

  // ค้นหาจากรหัสไปรษณีย์ใน address
  const postcodeMatch = addr.match(/\b[0-9]{5}\b/);
  if (postcodeMatch) {
    const loc = lookupByPostcode(postcodeMatch[0]);
    if (loc && loc.province) return loc.province;
  }

  return '';
}

/**
 * isValidProvince — ตรวจสอบว่าเป็นชื่อจังหวัดจริง
 */
function isValidProvince(provinceName) {
  if (!provinceName || provinceName.length < 4) return false;
  const provinces = getCachedProvinces_();
  return provinces.includes(provinceName.trim());
}

/**
 * lookupDistrictsByProvince — ดึงรายชื่ออำเภอของจังหวัด
 * [ADD v003] ใช้ TH_GEO_DISTRICTS cache ที่สร้างแต่ไม่มี getter
 */
function lookupDistrictsByProvince(provinceName) {
  if (!provinceName) return [];
  const cached = getCachedDistricts_();
  return cached[provinceName] || [];
}

// ============================================================
// SECTION 4: Cache Getters
// ============================================================

/**
 * getCachedPostcodeMap_
 * [FIX v003] re-cache fallback result ก่อน return
 */
function getCachedPostcodeMap_() {
  const cache  = CacheService.getScriptCache();
  const cached = cache.get('TH_GEO_POSTCODE');
  if (cached) {
    try { return JSON.parse(cached); } catch(e) {}
  }
  // Cache หมดอายุ → Query Sheet โดยตรง แล้ว re-cache
  const result = buildPostcodeMapFromSheet_();
  try {
    cache.put('TH_GEO_POSTCODE', JSON.stringify(result), AI_CONFIG.CACHE_TTL_SEC);
  } catch(e) {}
  return result;
}

/**
 * getCachedProvinces_
 * [FIX v003] re-cache fallback result ก่อน return
 */
function getCachedProvinces_() {
  const cache  = CacheService.getScriptCache();
  const cached = cache.get('TH_GEO_PROVINCES');
  if (cached) {
    try { return JSON.parse(cached); } catch(e) {}
  }
  const result = buildProvincesFromSheet_();
  try {
    cache.put('TH_GEO_PROVINCES', JSON.stringify(result), AI_CONFIG.CACHE_TTL_SEC);
  } catch(e) {}
  return result;
}

/**
 * getCachedDistricts_ — [ADD v003] Getter สำหรับ TH_GEO_DISTRICTS
 */
function getCachedDistricts_() {
  const cache  = CacheService.getScriptCache();
  const cached = cache.get('TH_GEO_DISTRICTS');
  if (cached) {
    try { return JSON.parse(cached); } catch(e) {}
  }
  return buildDistrictsMapFromSheet_();
}

// ============================================================
// SECTION 5: Sheet Query Builders
// ============================================================

/**
 * buildPostcodeMapFromSheet_
 * [FIX v003] ใช้ SCHEMA[SHEET.SYS_TH_GEO].length แทน hardcode 5
 */
function buildPostcodeMapFromSheet_() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.SYS_TH_GEO);
  if (!sheet || sheet.getLastRow() < 2) return {};

  const colsToRead = SCHEMA[SHEET.SYS_TH_GEO].length; // [FIX v003]
  const data       = sheet.getRange(2, 1, sheet.getLastRow() - 1, colsToRead)
                          .getValues();
  const result     = {};

  data.forEach(row => {
    const postcode = String(row[TH_GEO_IDX.POSTCODE] || '')
      .trim().padStart(5, '0');
    if (postcode && postcode !== '00000' && !result[postcode]) {
      result[postcode] = {
        province:    String(row[TH_GEO_IDX.PROVINCE]     || '').trim(),
        district:    String(row[TH_GEO_IDX.DISTRICT]     || '').trim(),
        subDistrict: String(row[TH_GEO_IDX.SUB_DISTRICT] || '').trim(),
      };
    }
  });
  return result;
}

/**
 * buildProvincesFromSheet_
 * [FIX v003] ใช้ TH_GEO_IDX.PROVINCE + 1 แทน hardcode
 */
function buildProvincesFromSheet_() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.SYS_TH_GEO);
  if (!sheet || sheet.getLastRow() < 2) return [];

  // อ่านเฉพาะคอลัมน์ Province
  const provinceCol = TH_GEO_IDX.PROVINCE + 1;
  const data        = sheet.getRange(2, provinceCol,
                       sheet.getLastRow() - 1, 1).getValues();
  const provinceSet = new Set();

  data.forEach(row => {
    const province = String(row[0] || '').trim();
    if (province && province.length >= 4) provinceSet.add(province);
  });

  return [...provinceSet];
}

/**
 * buildDistrictsMapFromSheet_ — [ADD v003]
 */
function buildDistrictsMapFromSheet_() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.SYS_TH_GEO);
  if (!sheet || sheet.getLastRow() < 2) return {};

  const colsToRead = SCHEMA[SHEET.SYS_TH_GEO].length;
  const data       = sheet.getRange(2, 1, sheet.getLastRow() - 1, colsToRead)
                          .getValues();
  const result     = {};

  data.forEach(row => {
    const province = String(row[TH_GEO_IDX.PROVINCE] || '').trim();
    const district = String(row[TH_GEO_IDX.DISTRICT] || '').trim();
    if (!province || !district) return;
    if (!result[province]) result[province] = new Set();
    result[province].add(district);
  });

  const arr = {};
  Object.keys(result).forEach(p => { arr[p] = [...result[p]]; });
  return arr;
}

// ============================================================
// SECTION 6: Invalidate Cache
// ============================================================

/**
 * invalidateGeoDictCache — ล้าง Cache ทั้งหมดของ Geo Dictionary
 * [NOTE] ใช้ Exact Key ถูกต้อง (ต่างจาก Module 15 ที่ใช้ prefix ผิด)
 */
function invalidateGeoDictCache() {
  CacheService.getScriptCache().removeAll([
    'TH_GEO_POSTCODE',
    'TH_GEO_PROVINCES',
    'TH_GEO_DISTRICTS',
  ]);
  logInfo('GeoDictBuilder', 'ล้าง Geo Dictionary Cache เรียบร้อย');
}

// ============================================================
// SECTION 7: Helper
// ============================================================

// safeUiAlert_ → ใช้ shared function จาก 03_SetupSheets.gs (GAS shared scope)

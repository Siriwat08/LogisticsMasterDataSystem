/**
 * VERSION: 003
 * FILE: 14_Utils.gs
 * LMDS V5.0 — Utility Functions
 * ===================================================
 * CHANGELOG v003 (Round 1 — Critical Fixes):
 *   - [FIX] isValidLatLng: && → || (Bug: lat=0.1,lng=0 ผ่านผิด)
 *   - [FIX] haversineDistanceM: Math.min(1,aVal) ป้องกัน NaN
 *   - [FIX] toThaiDateStr: เพิ่ม Invalid Date guard
 * ===================================================
 */

// ============================================================
// SECTION 1: String Similarity
// ============================================================

/**
 * levenshteinDistance — ระยะห่างระหว่าง 2 String
 * @param {string} strA
 * @param {string} strB
 * @return {number}
 */
function levenshteinDistance(strA, strB) {
  const lenA = strA.length;
  const lenB = strB.length;
  if (lenA === 0) return lenB;
  if (lenB === 0) return lenA;
  if (strA === strB) return 0;

  const matrix = [];
  for (let i = 0; i <= lenA; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= lenB; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      const cost = strA[i - 1] === strB[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j]     + 1,
        matrix[i][j - 1]     + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[lenA][lenB];
}

/**
 * diceCoefficient — Dice Similarity ด้วย Bigram
 * @param {string} strA
 * @param {string} strB
 * @return {number} 0.0 – 1.0
 */
function diceCoefficient(strA, strB) {
  if (!strA || !strB) return 0;
  if (strA === strB) return 1;
  if (strA.length < 2 || strB.length < 2) return 0;

  const bigramsA    = buildBigramSet_(strA);
  const bigramsB    = buildBigramSet_(strB);
  let intersection  = 0;

  bigramsA.forEach(bg => {
    if (bigramsB.has(bg)) intersection++;
  });

  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

/**
 * buildBigramSet_ — สร้าง Set ของ Bigram จาก String
 * [ADD v003-R3] NFC Normalize ก่อน Bigram
 *              กัน Unicode สระซ้อน เช่น ก + า vs กา แบบ precomposed
 */
function buildBigramSet_(str) {
  // [ADD v003-R3] NFC normalize ก่อน — ป้องกัน Thai สระ decomposed
  const normalized = str.normalize('NFC');
  const set = new Set();
  for (let i = 0; i < normalized.length - 1; i++) {
    set.add(normalized.substring(i, i + 2));
  }
  return set;
}

// ============================================================
// SECTION 2: GPS Distance
// ============================================================

/**
 * haversineDistanceM — ระยะทางระหว่าง 2 พิกัด GPS (เมตร)
 * [FIX v003] เพิ่ม Math.min(1, aVal) ป้องกัน aVal>1 → sqrt(NaN)
 */
function haversineDistanceM(lat1, lng1, lat2, lng2) {
  const earthRadius = 6371000;
  const toRad       = Math.PI / 180;

  const diffLat    = (lat2 - lat1) * toRad;
  const diffLng    = (lng2 - lng1) * toRad;

  const sinHalfLat = Math.sin(diffLat / 2);
  const sinHalfLng = Math.sin(diffLng / 2);

  const aVal = sinHalfLat * sinHalfLat +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
    sinHalfLng * sinHalfLng;

  // [FIX v003] clamp aVal ให้อยู่ใน [0,1] ป้องกัน Floating Point error
  const safeAVal    = Math.min(1, Math.max(0, aVal));
  const centralAngle = 2 * Math.atan2(Math.sqrt(safeAVal),
                                       Math.sqrt(1 - safeAVal));
  return earthRadius * centralAngle;
}

/**
 * haversineDistanceKm — ระยะทาง (กิโลเมตร)
 */
function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  return haversineDistanceM(lat1, lng1, lat2, lng2) / 1000;
}

// ============================================================
// SECTION 3: UUID / Hash
// ============================================================

/**
 * generateShortId — สร้าง ID สั้น 12 ตัวอักษร
 */
function generateShortId(prefix) {
  const raw = Utilities.getUuid().replace(/-/g, '').toUpperCase();
  return (prefix || '') + raw.substring(0, 12);
}

/**
 * generateMd5Hash — สร้าง MD5 Hex สำหรับ Cache Key
 */
function generateMd5Hash(input) {
  const rawBytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    String(input)
  );
  return rawBytes.map(b => {
    const hex = (b < 0 ? b + 256 : b).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

// ============================================================
// SECTION 4: Date Utilities
// ============================================================

/**
 * toThaiDateStr — แปลง Date เป็น String รูปแบบไทย
 * [FIX v003] เพิ่ม Invalid Date guard
 */
function toThaiDateStr(date) {
  if (!date) return '';
  const d = new Date(date);

  // [FIX v003] ป้องกัน Invalid Date → คืน '' แทน 'NaN/NaN/NaN'
  if (isNaN(d.getTime())) return '';

  const day   = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year  = d.getFullYear() + 543;
  return `${day}/${month}/${year}`;
}

/**
 * isValidLatLng — ตรวจสอบว่าพิกัดอยู่ในประเทศไทย
 * [FIX v003] && → || ป้องกัน lat=0.1, lng=0 ผ่านผิด
 */
function isValidLatLng(lat, lng) {
  const numLat = Number(lat);
  const numLng = Number(lng);
  if (isNaN(numLat) || isNaN(numLng)) return false;

  // [FIX v003] เปลี่ยนเป็น || — ถ้า lat=0 หรือ lng=0 ถือว่าไม่มีพิกัด
  if (numLat === 0 || numLng === 0) return false;

  // กรอบประเทศไทย
  return numLat >= 5.5  && numLat <= 20.5 &&
         numLng >= 97.5 && numLng <= 105.7;
}

/**
 * parseLatLng — แปลง String "lat,lng" เป็น Object
 */
function parseLatLng(latLngStr) {
  if (!latLngStr) return null;
  const cleaned = String(latLngStr).trim();

  // รองรับ separator: , / | หรือ space
  const parts = cleaned.split(/[,\/|\s]+/);
  if (parts.length < 2) return null;

  const lat = parseFloat(parts[0].trim());
  const lng = parseFloat(parts[1].trim());
  if (isNaN(lat) || isNaN(lng)) return null;
  return { lat, lng };
}

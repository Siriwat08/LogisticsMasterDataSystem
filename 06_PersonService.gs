/**
 * VERSION: 003
 * FILE: 06_PersonService.gs
 * LMDS V5.0 — Person Master Service
 * ===================================================
 * CHANGELOG v003 (Round 1 — Critical Fixes):
 *   - [FIX] mergePersonRecords: aliasName ใช้ canonical ไม่ใช่ sourceId
 *   - [FIX] findPersonCandidates: includes → .some(p => p.personId===)
 *   - [FIX] findByAlias_: เพิ่ม personId uniqueness check
 *   - [FIX] updatePersonStats: โหลดเฉพาะ person_id col + guard idCol
 *   - [FIX] mergePersonRecords: เพิ่ม guard idCol === -1
 *   - [FIX] findPersonCandidates: Phonetic fallback substring(0,3)
 *   - [FIX] findPersonCandidates: Phone match > 1 → ไปต่อ scoring
 *   - [FIX] scorePersonCandidate: hardcode 60 → AI_CONFIG.SCORE_MIN_THRESHOLD
 * ===================================================
 */

// ============================================================
// SECTION 1: resolvePerson
// ============================================================

/**
 * resolvePerson — ค้นหาหรือประเมินบุคคลจากชื่อดิบ
 */
function resolvePerson(rawName) {
  const normResult = normalizePersonNameFull(rawName);
  const cleanName  = normResult.cleanName;

  if (!cleanName || cleanName.length < 2) {
    return { personId: null, status: 'LOW_QUALITY', confidence: 0, normResult };
  }

  const candidates = findPersonCandidates(cleanName, normResult.extractedPhone);

  if (candidates.length === 0) {
    return { personId: null, status: 'NOT_FOUND', confidence: 0, normResult };
  }

  let bestPerson = null;
  let bestScore  = 0;

  candidates.forEach(candidate => {
    const score = scorePersonCandidate(cleanName, candidate);
    if (score > bestScore) {
      bestScore  = score;
      bestPerson = candidate;
    }
  });

  if (bestScore >= AI_CONFIG.THRESHOLD_AUTO) {
    return { personId: bestPerson.personId, status: 'FOUND',
             confidence: bestScore, normResult };
  }
  if (bestScore >= AI_CONFIG.THRESHOLD_REVIEW) {
    return { personId: bestPerson.personId, status: 'NEEDS_REVIEW',
             confidence: bestScore, normResult };
  }
  return { personId: null, status: 'NOT_FOUND', confidence: bestScore, normResult };
}

// ============================================================
// SECTION 2: findPersonCandidates
// ============================================================

/**
 * findPersonCandidates — ค้นหา Candidate จาก M_PERSON
 * [FIX v003] Object reference bug: includes → .some(p => p.personId===)
 * [FIX v003] Phone match > 1 → ไปต่อ scoring แทน return ทันที
 * [FIX v003] Phonetic fallback substring(0,2) → (0,3)
 */
function findPersonCandidates(cleanName, phone) {
  const allPersons = loadAllPersons_();
  const results    = [];

  // --- 1. Phone Match ---
  if (phone) {
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const byPhone    = allPersons.filter(p => {
      const stored = String(p.phone || '').replace(/[^0-9]/g, '');
      return stored === cleanPhone && stored.length >= 9;
    });

    if (byPhone.length === 1) {
      // [FIX v003] เจอ 1 คน → return เลย (confident)
      return byPhone;
    }
    if (byPhone.length > 1) {
      // [FIX v003] เจอหลายคน → เพิ่มเข้า results แล้วไปต่อ scoring
      byPhone.forEach(p => {
        if (!results.some(r => r.personId === p.personId)) results.push(p);
      });
    }
  }

  // --- 2. Alias Match ---
  const aliasMatches = findByAlias_(cleanName);
  aliasMatches.forEach(personId => {
    const found = allPersons.find(p => p.personId === personId);
    // [FIX v003] ใช้ .some() แทน .includes() กัน object reference bug
    if (found && !results.some(r => r.personId === found.personId)) {
      results.push(found);
    }
  });

  // --- 3. Phonetic / Name Match ---
  const searchKey = buildThaiPhoneticKey(cleanName);
  allPersons.forEach(person => {
    if (results.some(r => r.personId === person.personId)) return;
    const personKey = buildThaiPhoneticKey(person.normalized);

    if (searchKey && personKey && searchKey === personKey) {
      results.push(person);
    } else {
      // [FIX v003] Fallback 3 ตัวอักษร แทน 2 (ลด false positive)
      const normA = normalizeForCompare(cleanName);
      const normB = normalizeForCompare(person.normalized);
      if (normA.length >= 3 && normB.length >= 3 &&
          normB.startsWith(normA.substring(0, 3))) {
        results.push(person);
      }
    }
  });

  return results;
}

/**
 * findByAlias_ — ค้นหา Person ID จาก M_PERSON_ALIAS
 * [FIX v003] ใช้ Set กัน duplicate
 */
function findByAlias_(cleanName) {
  const allAliases = loadAllAliases_();
  const targetNorm = normalizeForCompare(cleanName);
  const foundSet   = new Set();

  allAliases.forEach(alias => {
    if (!alias[PERSON_ALIAS_IDX.ACTIVE_FLAG]) return;
    const aliasNorm = normalizeForCompare(alias[PERSON_ALIAS_IDX.ALIAS_NAME]);
    if (aliasNorm === targetNorm && aliasNorm.length > 0) {
      foundSet.add(String(alias[PERSON_ALIAS_IDX.PERSON_ID]));
    }
  });

  return [...foundSet];
}

// ============================================================
// SECTION 3: Scoring
// ============================================================

/**
 * scorePersonCandidate — คำนวณคะแนน Match
 * [FIX v003] hardcode 60 → AI_CONFIG.SCORE_MIN_THRESHOLD
 */
function scorePersonCandidate(queryName, candidate) {
  const nameA = normalizeForCompare(queryName);
  const nameB = normalizeForCompare(candidate.normalized || candidate.canonical);

  if (!nameA || !nameB) return 0;

  const levDist   = levenshteinDistance(nameA, nameB);
  const maxLen    = Math.max(nameA.length, nameB.length);
  const levScore  = maxLen > 0 ? Math.max(0, (1 - levDist / maxLen) * 100) : 0;
  const diceScore = diceCoefficient(nameA, nameB) * 100;
  const ratioScore = nameA === nameB ? 100 :
    (nameA.includes(nameB) || nameB.includes(nameA)) ? 80 : 0;

  let finalScore;
  if (nameA.length < 4) {
    finalScore = levScore * 0.6 + diceScore * 0.2 + ratioScore * 0.2;
  } else {
    finalScore = diceScore * 0.5 + levScore * 0.3 + ratioScore * 0.2;
  }

  // [FIX v003] ใช้ Config แทน hardcode 60
  return finalScore < AI_CONFIG.SCORE_MIN_THRESHOLD ? 0 : Math.round(finalScore);
}

// ============================================================
// SECTION 4: CRUD
// ============================================================

/**
 * createPerson — สร้างบุคคลใหม่ใน M_PERSON
 */
function createPerson(normResult) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.M_PERSON);
  const now   = new Date();
  const newId = generateShortId('P');

  const phoneStr = normResult.extractedPhone
    ? "'" + normResult.extractedPhone : '';

  // [ADD v003-R3] normalized_name ผ่าน normalizeForCompare ก่อนเก็บ
  // ทำให้ค้นหาเปรียบเทียบได้แม่นยำกว่า (lowercase, ไม่มี space/dash)
  const normalizedName = normalizeForCompare(normResult.cleanName);

  const newRow = [
    newId,
    normResult.cleanName,
    normalizedName,
    phoneStr,
    now, now, 1,
    APP_CONST.STATUS_ACTIVE,
    (normResult.deliveryNotes || []).join(','),
  ];

  sheet.appendRow(newRow);
  invalidatePersonCache_();
  logDebug('PersonService', `createPerson: ${newId} — ${normResult.cleanName}`);
  return newId;
}

/**
 * createPersonAlias — เพิ่มชื่อสำรองให้บุคคล
 */
function createPersonAlias(personId, aliasName, matchScore) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.M_PERSON_ALIAS);
  const newId = generateShortId('PA');

  sheet.appendRow([newId, personId, aliasName, matchScore || 0, new Date(), true]);
  invalidateAliasCache_();
  logDebug('PersonService', `createPersonAlias: ${aliasName} → ${personId}`);
}

/**
 * updatePersonStats — อัปเดต last_seen และ usage_count
 * [FIX v003] โหลดเฉพาะ person_id column + guard idCol === -1
 */
function updatePersonStats(personId) {
  if (!personId) return;
  try {
    const ss      = SpreadsheetApp.getActiveSpreadsheet();
    const sheet   = ss.getSheetByName(SHEET.M_PERSON);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    // [FIX v003] โหลดเฉพาะคอลัมน์ person_id (col 1) แทนทั้งชีต
    const idCol      = PERSON_IDX.PERSON_ID + 1;
    const idData     = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
    let targetRow    = -1;

    for (let i = 0; i < idData.length; i++) {
      if (String(idData[i][0]).trim() === personId) {
        targetRow = i + 2;
        break;
      }
    }

    if (targetRow === -1) {
      logWarn('PersonService', `updatePersonStats: ไม่พบ personId ${personId}`);
      return;
    }

    const lastSeenCol   = PERSON_IDX.LAST_SEEN   + 1;
    const usageCountCol = PERSON_IDX.USAGE_COUNT  + 1;

    sheet.getRange(targetRow, lastSeenCol).setValue(new Date());
    const currCount = Number(
      sheet.getRange(targetRow, usageCountCol).getValue()
    ) || 0;
    sheet.getRange(targetRow, usageCountCol).setValue(currCount + 1);
    invalidatePersonCache_();

  } catch (err) {
    logError('PersonService', `updatePersonStats ล้มเหลว: ${err.message}`);
  }
}

/**
 * mergePersonRecords — Merge บุคคล 2 คนให้เป็น 1
 * [FIX v003] aliasName ใช้ canonical name ของ sourceId ไม่ใช่ sourceId เอง
 * [FIX v003] เพิ่ม guard idCol === -1
 * [FIX v003] comment "ห้ามลบ" แก้จาก "ห้างลบ"
 */
function mergePersonRecords(sourceId, targetId) {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET.M_PERSON);
    const data  = sheet.getRange(1, 1, sheet.getLastRow(),
                   SCHEMA[SHEET.M_PERSON].length).getValues();
    const headers = data[0];
    const idCol   = headers.indexOf('person_id');
    const statCol = headers.indexOf('record_status');
    const noteCol = headers.indexOf('note');
    const canCol  = headers.indexOf('canonical_name');

    // [FIX v003] guard idCol
    if (idCol === -1 || statCol === -1) {
      logError('PersonService', 'mergePersonRecords: ไม่พบ header person_id/record_status');
      return;
    }

    let sourceCanonical = sourceId; // fallback

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idCol]) !== sourceId) continue;

      const targetRow = i + 1;

      // [FIX v003] ดึง canonical_name ของ source ก่อน merge
      if (canCol !== -1 && data[i][canCol]) {
        sourceCanonical = String(data[i][canCol]);
      }

      // [FIX v003] ห้ามลบ — เปลี่ยน Status เป็น Merged แทน
      sheet.getRange(targetRow, statCol + 1).setValue(APP_CONST.STATUS_MERGED);
      if (noteCol !== -1) {
        sheet.getRange(targetRow, noteCol + 1).setValue(
          `Merged → ${targetId} on ${toThaiDateStr(new Date())}`
        );
      }
      break;
    }

    // [FIX v003] สร้าง Alias ด้วย canonical_name ของ source ไม่ใช่ sourceId
    createPersonAlias(targetId, sourceCanonical, 100);
    invalidatePersonCache_();
    logInfo('PersonService', `mergePersonRecords: ${sourceId} → ${targetId}`);

  } catch (err) {
    logError('PersonService', `mergePersonRecords ล้มเหลว: ${err.message}`);
    throw err;
  }
}

// ============================================================
// SECTION 5: Data Loaders (with Cache)
// ============================================================

function loadAllPersons_() {
  const cacheKey = 'M_PERSON_ALL';
  const cache    = CacheService.getScriptCache();
  const cached   = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch(e) {} }

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.M_PERSON);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1,
                SCHEMA[SHEET.M_PERSON].length).getValues();

  const result = rows
    .filter(r => r[PERSON_IDX.PERSON_ID])
    .filter(r => r[PERSON_IDX.STATUS] !== APP_CONST.STATUS_ARCHIVED &&
                 r[PERSON_IDX.STATUS] !== APP_CONST.STATUS_MERGED)
    .map(r => ({
      personId:   String(r[PERSON_IDX.PERSON_ID]),
      canonical:  String(r[PERSON_IDX.CANONICAL]  || ''),
      normalized: String(r[PERSON_IDX.NORMALIZED] || ''),
      phone:      String(r[PERSON_IDX.PHONE]       || '').replace(/^'/, ''),
      usageCount: Number(r[PERSON_IDX.USAGE_COUNT] || 0),
    }));

  try { cache.put(cacheKey, JSON.stringify(result), AI_CONFIG.CACHE_TTL_SEC); }
  catch(e) { logWarn('PersonService', 'M_PERSON Cache เต็ม'); }
  return result;
}

function loadAllAliases_() {
  const cacheKey = 'M_PERSON_ALIAS_ALL';
  const cache    = CacheService.getScriptCache();
  const cached   = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch(e) {} }

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.M_PERSON_ALIAS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1,
                SCHEMA[SHEET.M_PERSON_ALIAS].length).getValues();
  try { cache.put(cacheKey, JSON.stringify(rows), AI_CONFIG.CACHE_TTL_SEC); }
  catch(e) {}
  return rows;
}

function invalidatePersonCache_() {
  CacheService.getScriptCache().remove('M_PERSON_ALL');
}
function invalidateAliasCache_() {
  CacheService.getScriptCache().remove('M_PERSON_ALIAS_ALL');
}

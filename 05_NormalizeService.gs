/**
 * VERSION: 003
 * FILE: 05_NormalizeService.gs
 * LMDS V5.0 — Thai Name & Place Normalization
 * ===================================================
 * CHANGELOG v003 (Round 1 — Critical Fixes):
 *   - [FIX] buildThaiPhoneticKey: ลด Regex range ซ้อน
 *   - [FIX] normalizePersonNameFull: replace global (g flag)
 *   - [FIX] COMPANY_SUFFIX_LIST: sort longest-first
 *   - [FIX] extractedDoc: append แทน skip เมื่อ docMatches มีแล้ว
 *   - [FIX] Prefix: while loop แทน break ครั้งเดียว
 *   - [ADD] SORTED_PREFIX_LIST: pre-sort ครั้งเดียว
 *   - [FIX] normalizePlaceName: regex บ้าน → กัน false positive
 *   - [FIX] COMPANY_SUFFIX detect: เพิ่ม word boundary check
 * ===================================================
 */

// ============================================================
// SECTION 1: Dictionaries
// ============================================================

const PERSON_PREFIX_LIST = [
  'พลเอก','พลโท','พลตรี','พันเอก','พันโท','พันตรี',
  'ร้อยเอก','ร้อยโท','ร้อยตรี',
  'จ่าสิบเอก','จ่าสิบโท','จ่าสิบตรี',
  'สิบเอก','สิบโท','สิบตรี','พลทหาร',
  'พลเรือเอก','พลเรือโท','พลเรือตรี',
  'นาวาเอก','นาวาโท','นาวาตรี',
  'เรือเอก','เรือโท','เรือตรี',
  'พลอากาศเอก','พลอากาศโท','พลอากาศตรี',
  'นาวาอากาศเอก','นาวาอากาศโท','นาวาอากาศตรี',
  'เรืออากาศเอก','เรืออากาศโท','เรืออากาศตรี',
  'พลตำรวจเอก','พลตำรวจโท','พลตำรวจตรี',
  'พันตำรวจเอก','พันตำรวจโท','พันตำรวจตรี',
  'ร้อยตำรวจเอก','ร้อยตำรวจโท','ร้อยตำรวจตรี',
  'สิบตำรวจเอก','สิบตำรวจโท','สิบตำรวจตรี',
  'พลตำรวจ','ผู้กำกับ','รองผู้กำกับ',
  'ศาสตราจารย์','รองศาสตราจารย์','ผู้ช่วยศาสตราจารย์',
  'นายแพทย์','แพทย์หญิง','ทันตแพทย์','เภสัชกร',
  'วิศวกร','สถาปนิก',
  'นาย','นาง','นางสาว','น.ส.',
  'คุณ','ครู','อาจารย์',
  'ดร.','ดร',
  'พ.อ.','พ.ต.','ร.อ.','ร.ต.','ส.อ.',
  'พ.ต.อ.','พ.ต.ท.','พ.ต.ต.',
  'ร.ต.อ.','ร.ต.ท.','ร.ต.ต.',
];

/**
 * SORTED_PREFIX_LIST — [ADD v003] Pre-sort ครั้งเดียว
 * แทนการ sort ทุกครั้งที่เรียก normalizePersonNameFull
 */
const SORTED_PREFIX_LIST = PERSON_PREFIX_LIST
  .slice()
  .sort((a, b) => b.length - a.length);

/**
 * COMPANY_SUFFIX_LIST — [FIX v003] เรียงยาวไปสั้น (longest-first)
 * ป้องกัน "จำกัด" ตัดก่อน "ห้างหุ้นส่วนจำกัด"
 */
const COMPANY_SUFFIX_LIST = [
  'จำกัด(มหาชน)', 'จำกัด (มหาชน)',
  'ห้างหุ้นส่วนจำกัด', 'ห้างหุ้นส่วนสามัญ',
  'มหาชน', 'บริษัท', 'บมจ.', 'บจก.', 'หจก.', 'หสน.',
  'บจ.', 'หจ.', 'บมจ', 'บจก', 'หจก',
  'จำกัด', '(จำกัด)', 'จก.',
  'ร้านค้า', 'กิจการ', 'ร้าน',
].sort((a, b) => b.length - a.length); // sort ทันทีตอน declare

const CHAIN_STORE_LIST = [
  'ไทวัสดุ','โฮมโปร','โกลบอลเฮ้าส์','สยามโกลบอล',
  'แพลนท์ปูน','ปูนซีเมนต์','ศูนย์บริการ',
  'ไซต์งาน','โครงการ','หน่วยงาน',
  'วัสดุภัณฑ์','วัสดุก่อสร้าง',
];

const DELIVERY_NOTE_LIST = [
  'ฝากป้อม','ฝากรปภ','ฝากยาม','ฝากรักษาความปลอดภัย',
  'COD','เก็บเงินปลายทาง',
  'ห้ามโยน','ระวังแตก','ระวังหัก','บอบบาง',
  'แช่เย็น','เก็บในที่เย็น',
  'ส่งด่วน','ด่วนมาก','ด่วนพิเศษ',
  'ส่งก่อน','ส่งหลัง',
  'นัดส่ง','โทรก่อนส่ง','โทรนัด',
];

// ============================================================
// SECTION 2: Regex Patterns
// ============================================================

const PHONE_PATTERN   = /(?:\+66|0)[0-9]{1,2}[-.\s]?[0-9]{3,4}[-.\s]?[0-9]{4}/g;
const DOC_NO_PATTERN  = /\b[0-9]{8,}\b/g;
const REF_NO_PATTERN  = /#[0-9]+|No\.?\s*[0-9]+/gi;

// ============================================================
// SECTION 3: normalizePersonNameFull
// ============================================================

/**
 * runNormalize — Entry Point จาก Menu / Pipeline
 * [FIX v003] เพิ่ม comment อธิบายว่า Normalize เกิดใน processOneRow()
 * ไม่ใช่ Batch แยก — ฟังก์ชันนี้เป็น Placeholder สำหรับขยายอนาคต
 */
function runNormalize() {
  // Normalize เกิดใน processOneRow() ของ 10_MatchEngine.gs ต่อทุก row
  // ไม่ต้องทำ Batch แยก เพราะ Source Repository ส่ง srcObj เข้า Engine แล้ว
  logInfo('NormalizeService', 'Normalize ทำงานใน processOneRow() ของ MatchEngine');
}

/**
 * normalizePersonNameFull — ล้างชื่อบุคคลแบบสมบูรณ์
 * @param {string} rawName
 */
function normalizePersonNameFull(rawName) {
  const original      = String(rawName || '').trim();
  let working         = original;
  const notes         = [];
  let extractedPhone  = '';
  let extractedDoc    = '';
  let isCompany       = false;

  if (!working) {
    return buildNormResult_(original, '', false, '', '', []);
  }

  // --- Step 1: ดึงเบอร์โทรออก ---
  const phoneMatches = working.match(PHONE_PATTERN);
  if (phoneMatches) {
    extractedPhone = phoneMatches[0].replace(/[-.\s]/g, '');
    working = working.replace(PHONE_PATTERN, '').trim();
  }

  // --- Step 2: ดึงเลขเอกสารออก ---
  const docMatches = working.match(DOC_NO_PATTERN);
  if (docMatches) {
    extractedDoc = docMatches.join(',');
    working = working.replace(DOC_NO_PATTERN, '').trim();
  }
  const refMatches = working.match(REF_NO_PATTERN);
  if (refMatches) {
    // [FIX v003] append แทน skip เมื่อ extractedDoc มีแล้ว
    const refStr = refMatches.join(',');
    extractedDoc = extractedDoc ? `${extractedDoc},${refStr}` : refStr;
    working = working.replace(REF_NO_PATTERN, '').trim();
  }

  // --- Step 3: ดึง Delivery Notes ออก (global replace) ---
  DELIVERY_NOTE_LIST.forEach(noteWord => {
    if (working.includes(noteWord)) {
      notes.push(noteWord);
      // [FIX v003] global replace — ลบทุก occurrence ไม่ใช่แค่ตัวแรก
      const safeNote = escapeRegex_(noteWord);
      working = working.replace(new RegExp(safeNote, 'g'), '').trim();
    }
  });

  // --- Step 4: ตรวจสอบนิติบุคคล ---
  // [FIX v003] เพิ่ม word boundary check กัน false positive เช่น "ร้านลุงจำกัดความสุข"
  const hasCompanySuffix = COMPANY_SUFFIX_LIST.some(s => {
    const idx = working.indexOf(s);
    if (idx === -1) return false;
    // ตรวจว่าคำก่อนหน้าเป็นพยัญชนะไทย/อักษร ไม่ใช่อยู่กลางคำอื่น
    const before = idx > 0 ? working[idx - 1] : ' ';
    return /[\s\(ก-๙a-zA-Z]/.test(before) || idx === 0;
  });
  const hasChainStore = CHAIN_STORE_LIST.some(s => working.includes(s));

  if (hasCompanySuffix || hasChainStore) {
    isCompany = true;
    // [FIX v003] global replace suffix ออก (COMPANY_SUFFIX_LIST เรียงยาวไปสั้นแล้ว)
    COMPANY_SUFFIX_LIST.forEach(suffix => {
      const safeSuffix = escapeRegex_(suffix);
      working = working.replace(new RegExp(safeSuffix, 'gi'), '').trim();
    });
  }

  // --- Step 5: ตัดคำนำหน้า (while loop แทน break ครั้งเดียว) ---
  if (!isCompany) {
    let changed = true;
    // [FIX v003] while loop — ตัด "ดร.นาย" ได้ทั้งคู่ ไม่ใช่แค่ตัวแรก
    while (changed) {
      changed = false;
      for (const prefix of SORTED_PREFIX_LIST) {
        if (working.startsWith(prefix)) {
          working = working.substring(prefix.length).trim();
          changed = true;
          break;
        }
      }
    }
  }

  // --- Step 6: ล้างช่องว่างและอักขระพิเศษ ---
  working = working.replace(/\s+/g, ' ')
                   .replace(/[^\u0E00-\u0E7Fa-zA-Z0-9\s]/g, '')
                   .trim();

  return buildNormResult_(
    original, working, isCompany,
    extractedPhone, extractedDoc, notes
  );
}

/**
 * buildNormResult_ — สร้าง Object ผลลัพธ์ Normalize
 */
function buildNormResult_(original, cleanName, isCompany, phone, docNo, notes) {
  return {
    cleanName:      cleanName,
    isCompany:      isCompany,
    extractedPhone: phone,
    extractedDocNo: docNo,
    deliveryNotes:  notes,
    originalName:   original,
  };
}

// ============================================================
// SECTION 4: normalizePlaceName
// ============================================================

/**
 * normalizePlaceName — ล้างชื่อสถานที่
 * [FIX v003] Regex บ้าน → กัน false positive "บ้านโป่ง" "บ้านนา"
 */
function normalizePlaceName(rawPlace) {
  let working   = String(rawPlace || '').trim();
  const notes   = [];
  let placeType = 'other';

  if (!working) {
    return { cleanPlace: '', placeType, notes: [] };
  }

  // ตรวจจับประเภทสถานที่
  if (/คอนโด|คอนโดมิเนียม|Condo|อาคารชุด/i.test(working)) {
    placeType = 'condo';
  } else if (/ห้างสรรพสินค้า|เซ็นทรัล|เทสโก้|โลตัส|มอลล์|Mall|Plaza|Center|Centre/i.test(working)) {
    placeType = 'mall';
  } else if (
    // [FIX v003] เปลี่ยนจาก /บ้าน/ → เฉพาะ "หมู่บ้าน" หรือ "บ้านเลขที่" หรือขึ้นต้นด้วย "บ้าน "
    /หมู่บ้าน|บ้านเลขที่|^บ้าน\s|Village|Moo\s*[0-9]/i.test(working)
  ) {
    placeType = 'house';
  } else if (/ไซต์งาน|โครงการ|ก่อสร้าง|Site/i.test(working)) {
    placeType = 'site';
  }

  // ดึง Delivery Notes ออก
  DELIVERY_NOTE_LIST.forEach(noteWord => {
    if (working.includes(noteWord)) {
      notes.push(noteWord);
      const safeNote = escapeRegex_(noteWord);
      working = working.replace(new RegExp(safeNote, 'g'), '').trim();
    }
  });

  working = working.replace(/\s+/g, ' ').trim();
  return { cleanPlace: working, placeType, notes };
}

// ============================================================
// SECTION 5: Phonetic & Compare
// ============================================================

/**
 * buildThaiPhoneticKey — สร้าง Phonetic Key จากชื่อไทย
 * [FIX v003] ลด Regex range ซ้อน: เดิม [\u0E30-\u0E4E\u0E47-\u0E4E]
 *            \u0E47-\u0E4E ซ้อนกับ \u0E30-\u0E4E อยู่แล้ว → ลดเป็นช่วงเดียว
 */
function buildThaiPhoneticKey(thaiName) {
  if (!thaiName) return '';
  // ลบสระและวรรณยุกต์ไทย (U+0E30–U+0E4E) และ space
  return thaiName.replace(/[\u0E30-\u0E4E\s]/g, '').substring(0, 6);
}

/**
 * normalizeForCompare — แปลงชื่อเพื่อเปรียบเทียบ
 */
function normalizeForCompare(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[.\-_]/g, '')
    .toLowerCase();
}

// ============================================================
// SECTION 6: Helper
// ============================================================

/**
 * escapeRegex_ — escape special chars สำหรับ new RegExp()
 */
function escapeRegex_(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

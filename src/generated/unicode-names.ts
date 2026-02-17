import * as fs from "fs";
import * as path from "path";

export const UNICODE_VERSION = "16.0.0" as const;

interface AlgorithmicRange {
  readonly start: number;
  readonly end: number;
  readonly prefix: string;
}

const ALGORITHMIC_RANGES: readonly AlgorithmicRange[] = [
  { start: 0x3400, end: 0x4DBF, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0x4E00, end: 0x9FFF, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0x20000, end: 0x2A6DF, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0x2A700, end: 0x2B739, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0x2B740, end: 0x2B81D, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0x2B820, end: 0x2CEA1, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0x2CEB0, end: 0x2EBE0, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0x2EBF0, end: 0x2EE5D, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0x30000, end: 0x3134A, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0x31350, end: 0x323AF, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0xF900, end: 0xFA6D, prefix: "CJK COMPATIBILITY IDEOGRAPH-" },
  { start: 0xFA70, end: 0xFAD9, prefix: "CJK COMPATIBILITY IDEOGRAPH-" },
  { start: 0x2F800, end: 0x2FA1D, prefix: "CJK COMPATIBILITY IDEOGRAPH-" },
  { start: 0x17000, end: 0x187F7, prefix: "TANGUT IDEOGRAPH-" },
  { start: 0x18D00, end: 0x18D7F, prefix: "TANGUT IDEOGRAPH-" },
  { start: 0x18B00, end: 0x18CD5, prefix: "KHITAN SMALL SCRIPT CHARACTER-" },
  { start: 0x1B170, end: 0x1B2FB, prefix: "NUSHU CHARACTER-" }
];

// Hangul syllable decomposition tables (U+AC00..U+D7A3)
const HANGUL_BASE = 0xAC00;
const HANGUL_V_COUNT = 21;
const HANGUL_T_COUNT = 28;

const HANGUL_L = [
  "G","GG","N","D","DD","R","M","B","BB","S","SS","","J","JJ","C","K","T","P","H",
] as const;

const HANGUL_V = [
  "A","AE","YA","YAE","EO","E","YEO","YE","O","WA","WAE","OE","YO","U","WEO",
  "WE","WI","YU","EU","YI","I",
] as const;

const HANGUL_T = [
  "","G","GG","GS","N","NJ","NH","D","L","LG","LM","LB","LS","LT","LP","LH",
  "M","B","BS","S","SS","NG","J","C","K","T","P","H",
] as const;

function hangulName(cp: number): string {
  const index = cp - HANGUL_BASE;
  const l = Math.floor(index / (HANGUL_V_COUNT * HANGUL_T_COUNT));
  const v = Math.floor((index % (HANGUL_V_COUNT * HANGUL_T_COUNT)) / HANGUL_T_COUNT);
  const t = index % HANGUL_T_COUNT;
  return `HANGUL SYLLABLE ${HANGUL_L[l]}${HANGUL_V[v]}${HANGUL_T[t]}`;
}

/** Lookup map populated on first call. */
let _nameMap: Map<number, string> | undefined;

function getNameMap(): Map<number, string> {
  if (_nameMap) return _nameMap;
  const txt = fs.readFileSync(
    path.join(__dirname, "../../resources/unicode-names.txt"),
    "utf8"
  );
  _nameMap = new Map();
  let i = 0;
  while (i < txt.length) {
    const spaceIdx = txt.indexOf(" ", i);
    const nlIdx = txt.indexOf("\n", spaceIdx);
    const end = nlIdx === -1 ? txt.length : nlIdx;
    const cp = parseInt(txt.slice(i, spaceIdx), 16);
    const name = txt.slice(spaceIdx + 1, end);
    _nameMap.set(cp, name);
    i = end + 1;
  }
  return _nameMap;
}

/** Correction aliases override the original name. */
const NAME_CORRECTIONS: Readonly<Record<number, string>> = {
  0x01A2: "LATIN CAPITAL LETTER GHA",
  0x01A3: "LATIN SMALL LETTER GHA",
  0x0616: "ARABIC SMALL HIGH LIGATURE ALEF WITH YEH BARREE",
  0x0709: "SYRIAC SUBLINEAR COLON SKEWED LEFT",
  0x0CDE: "KANNADA LETTER LLLA",
  0x0E9D: "LAO LETTER FO FON",
  0x0E9F: "LAO LETTER FO FAY",
  0x0EA3: "LAO LETTER RO",
  0x0EA5: "LAO LETTER LO",
  0x0FD0: "TIBETAN MARK BKA- SHOG GI MGO RGYAN",
  0x11EC: "HANGUL JONGSEONG YESIEUNG-KIYEOK",
  0x11ED: "HANGUL JONGSEONG YESIEUNG-SSANGKIYEOK",
  0x11EE: "HANGUL JONGSEONG SSANGYESIEUNG",
  0x11EF: "HANGUL JONGSEONG YESIEUNG-KHIEUKH",
  0x1BBD: "SUNDANESE LETTER ARCHAIC I",
  0x2118: "WEIERSTRASS ELLIPTIC FUNCTION",
  0x2448: "MICR ON US SYMBOL",
  0x2449: "MICR DASH SYMBOL",
  0x2B7A: "LEFTWARDS TRIANGLE-HEADED ARROW WITH DOUBLE VERTICAL STROKE",
  0x2B7C: "RIGHTWARDS TRIANGLE-HEADED ARROW WITH DOUBLE VERTICAL STROKE",
  0xA015: "YI SYLLABLE ITERATION MARK",
  0xAA6E: "MYANMAR LETTER KHAMTI LLA",
  0xFE18: "PRESENTATION FORM FOR VERTICAL RIGHT WHITE LENTICULAR BRACKET",
  0x122D4: "CUNEIFORM SIGN NU11 TENU",
  0x122D5: "CUNEIFORM SIGN NU11 OVER NU11 BUR OVER BUR",
  0x12327: "CUNEIFORM SIGN KALAM",
  0x1680B: "BAMUM LETTER PHASE-A MAEMGBIEE",
  0x16E56: "MEDEFAIDRIN CAPITAL LETTER H",
  0x16E57: "MEDEFAIDRIN CAPITAL LETTER NG",
  0x16E76: "MEDEFAIDRIN SMALL LETTER H",
  0x16E77: "MEDEFAIDRIN SMALL LETTER NG",
  0x1B001: "HENTAIGANA LETTER E-1",
  0x1D0C5: "BYZANTINE MUSICAL SYMBOL FTHORA SKLIRON CHROMA VASIS",
  0x1E899: "MENDE KIKAKUI SYLLABLE M172 MBO",
  0x1E89A: "MENDE KIKAKUI SYLLABLE M174 MBOO",
};

/** Control character descriptive names. */
const CONTROL_NAMES: Readonly<Record<number, string>> = {
  0x0082: "BREAK PERMITTED HERE",
  0x0083: "NO BREAK HERE",
  0x0084: "INDEX",
  0x0085: "NEXT LINE",
  0x0086: "START OF SELECTED AREA",
  0x0087: "END OF SELECTED AREA",
  0x0088: "CHARACTER TABULATION SET",
  0x0089: "CHARACTER TABULATION WITH JUSTIFICATION",
  0x008A: "LINE TABULATION SET",
  0x008B: "PARTIAL LINE FORWARD",
  0x008C: "PARTIAL LINE BACKWARD",
  0x008D: "REVERSE LINE FEED",
  0x008E: "SINGLE SHIFT TWO",
  0x008F: "SINGLE SHIFT THREE",
  0x0090: "DEVICE CONTROL STRING",
  0x0091: "PRIVATE USE ONE",
  0x0092: "PRIVATE USE TWO",
  0x0093: "SET TRANSMIT STATE",
  0x0094: "CANCEL CHARACTER",
  0x0095: "MESSAGE WAITING",
  0x0096: "START OF GUARDED AREA",
  0x0097: "END OF GUARDED AREA",
  0x0098: "START OF STRING",
  0x009A: "SINGLE CHARACTER INTRODUCER",
  0x009B: "CONTROL SEQUENCE INTRODUCER",
  0x009C: "STRING TERMINATOR",
  0x009D: "OPERATING SYSTEM COMMAND",
  0x009E: "PRIVACY MESSAGE",
  0x009F: "APPLICATION PROGRAM COMMAND",
};

/**
 * Public API
 *
 * Return the Unicode character name for a given code point, or undefined
 * if the code point is unassigned / below U+0080.
 *
 * Resolution order:
 *  1. Correction alias (NameAliases.txt type=correction)
 *  2. Control alias    (NameAliases.txt type=control)
 *  3. Hangul syllable  (algorithmic decomposition)
 *  4. Algorithmic range (CJK / Tangut / Khitan / Nushu)
 *  5. Individual name  (data file)
 */
export function getCharacterName(codePoint: number): string | undefined {
  if (codePoint <= 0x7F) return undefined;

  // 1. Correction alias
  const correction = NAME_CORRECTIONS[codePoint];
  if (correction) return correction;

  // 2. Control alias
  const control = CONTROL_NAMES[codePoint];
  if (control) return control;

  // 3. Hangul syllable
  if (codePoint >= HANGUL_BASE && codePoint <= 0xD7A3) {
    return hangulName(codePoint);
  }

  // 4. Algorithmic range
  for (const range of ALGORITHMIC_RANGES) {
    if (codePoint >= range.start && codePoint <= range.end) {
      return `${range.prefix}${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
    }
  }

  // 5. Individual name
  return getNameMap().get(codePoint);
}

import * as fs from "fs";
import * as path from "path";

export const UNICODE_VERSION = "16.0.0" as const;

interface AlgorithmicRange {
  readonly start: number;
  readonly end: number;
  readonly prefix: string;
}

const ALGORITHMIC_RANGES: readonly AlgorithmicRange[] = [
  { start: 0x3400, end: 0x4dbf, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0x4e00, end: 0x9fff, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0x20000, end: 0x2a6df, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0x2a700, end: 0x2b739, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0x2b740, end: 0x2b81d, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0x2b820, end: 0x2cea1, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0x2ceb0, end: 0x2ebe0, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0x2ebf0, end: 0x2ee5d, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0x30000, end: 0x3134a, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0x31350, end: 0x323af, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0xf900, end: 0xfa6d, prefix: "CJK COMPATIBILITY IDEOGRAPH-" },
  { start: 0xfa70, end: 0xfad9, prefix: "CJK COMPATIBILITY IDEOGRAPH-" },
  { start: 0x2f800, end: 0x2fa1d, prefix: "CJK COMPATIBILITY IDEOGRAPH-" },
  { start: 0x17000, end: 0x187f7, prefix: "TANGUT IDEOGRAPH-" },
  { start: 0x18d00, end: 0x18d7f, prefix: "TANGUT IDEOGRAPH-" },
  { start: 0x18b00, end: 0x18cd5, prefix: "KHITAN SMALL SCRIPT CHARACTER-" },
  { start: 0x1b170, end: 0x1b2fb, prefix: "NUSHU CHARACTER-" },
];


/** Lookup map populated on first call. */
let _nameMap: Map<number, string> | undefined;

function getNameMap(): Map<number, string> {
  if (_nameMap) return _nameMap;
  const txt = fs.readFileSync(
    path.join(__dirname, "../../resources/unicode-names.txt"),
    "utf8",
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
  0x01a2: "LATIN CAPITAL LETTER GHA",
  0x01a3: "LATIN SMALL LETTER GHA",
  0x0616: "ARABIC SMALL HIGH LIGATURE ALEF WITH YEH BARREE",
  0x0709: "SYRIAC SUBLINEAR COLON SKEWED LEFT",
  0x0cde: "KANNADA LETTER LLLA",
  0x0e9d: "LAO LETTER FO FON",
  0x0e9f: "LAO LETTER FO FAY",
  0x0ea3: "LAO LETTER RO",
  0x0ea5: "LAO LETTER LO",
  0x0fd0: "TIBETAN MARK BKA- SHOG GI MGO RGYAN",
  0x11ec: "HANGUL JONGSEONG YESIEUNG-KIYEOK",
  0x11ed: "HANGUL JONGSEONG YESIEUNG-SSANGKIYEOK",
  0x11ee: "HANGUL JONGSEONG SSANGYESIEUNG",
  0x11ef: "HANGUL JONGSEONG YESIEUNG-KHIEUKH",
  0x1bbd: "SUNDANESE LETTER ARCHAIC I",
  0x2118: "WEIERSTRASS ELLIPTIC FUNCTION",
  0x2448: "MICR ON US SYMBOL",
  0x2449: "MICR DASH SYMBOL",
  0x2b7a: "LEFTWARDS TRIANGLE-HEADED ARROW WITH DOUBLE VERTICAL STROKE",
  0x2b7c: "RIGHTWARDS TRIANGLE-HEADED ARROW WITH DOUBLE VERTICAL STROKE",
  0xa015: "YI SYLLABLE ITERATION MARK",
  0xaa6e: "MYANMAR LETTER KHAMTI LLA",
  0xfe18: "PRESENTATION FORM FOR VERTICAL RIGHT WHITE LENTICULAR BRACKET",
  0x122d4: "CUNEIFORM SIGN NU11 TENU",
  0x122d5: "CUNEIFORM SIGN NU11 OVER NU11 BUR OVER BUR",
  0x12327: "CUNEIFORM SIGN KALAM",
  0x1680b: "BAMUM LETTER PHASE-A MAEMGBIEE",
  0x16e56: "MEDEFAIDRIN CAPITAL LETTER H",
  0x16e57: "MEDEFAIDRIN CAPITAL LETTER NG",
  0x16e76: "MEDEFAIDRIN SMALL LETTER H",
  0x16e77: "MEDEFAIDRIN SMALL LETTER NG",
  0x1b001: "HENTAIGANA LETTER E-1",
  0x1d0c5: "BYZANTINE MUSICAL SYMBOL FTHORA SKLIRON CHROMA VASIS",
  0x1e899: "MENDE KIKAKUI SYLLABLE M172 MBO",
  0x1e89a: "MENDE KIKAKUI SYLLABLE M174 MBOO",
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
  0x008a: "LINE TABULATION SET",
  0x008b: "PARTIAL LINE FORWARD",
  0x008c: "PARTIAL LINE BACKWARD",
  0x008d: "REVERSE LINE FEED",
  0x008e: "SINGLE SHIFT TWO",
  0x008f: "SINGLE SHIFT THREE",
  0x0090: "DEVICE CONTROL STRING",
  0x0091: "PRIVATE USE ONE",
  0x0092: "PRIVATE USE TWO",
  0x0093: "SET TRANSMIT STATE",
  0x0094: "CANCEL CHARACTER",
  0x0095: "MESSAGE WAITING",
  0x0096: "START OF GUARDED AREA",
  0x0097: "END OF GUARDED AREA",
  0x0098: "START OF STRING",
  0x009a: "SINGLE CHARACTER INTRODUCER",
  0x009b: "CONTROL SEQUENCE INTRODUCER",
  0x009c: "STRING TERMINATOR",
  0x009d: "OPERATING SYSTEM COMMAND",
  0x009e: "PRIVACY MESSAGE",
  0x009f: "APPLICATION PROGRAM COMMAND",
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
 *  3. Algorithmic range (CJK / Tangut / Khitan / Nushu)
 *  4. Individual name  (data file)
 */
export function getCharacterName(codePoint: number): string | undefined {
  if (codePoint <= 0x7f) return undefined;

  // 1. Correction alias
  const correction = NAME_CORRECTIONS[codePoint];
  if (correction) return correction;

  // 2. Control alias
  const control = CONTROL_NAMES[codePoint];
  if (control) return control;

  // 3. Algorithmic range
  for (const range of ALGORITHMIC_RANGES) {
    if (codePoint >= range.start && codePoint <= range.end) {
      return `${range.prefix}${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
    }
  }

  // 4. Individual name
  return getNameMap().get(codePoint);
}

import { log } from "./logger";

/**
 * Normalize a settings-supplied character string into its literal character.
 *
 * Accepts multiple hex notations (all case-insensitive):
 *   u+HHHH  Unicode U+ notation
 *   \uHHHH  JS escape (exactly 4 hex digits)
 *   \u{HHHH} JS ES6 brace notation
 *   0xHHHH  C-style hex
 *
 * Returns the single character (possibly a surrogate pair), or undefined if
 * the input is not recognizable.
 */
// Guard against String.fromCodePoint throwing RangeError on values that
// exceed the Unicode maximum (U+10FFFF). Returns undefined for out-of-range
// inputs so callers can skip them gracefully, matching the pattern used
// elsewhere in the codebase (e.g. parseNameTable).
function fromCodePointSafe(cp: number): string | undefined {
  if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff) return undefined;
  return String.fromCodePoint(cp);
}

export function parseCharacterEntry(raw: string): string | undefined {
  // u+HHHH or U+HHHH
  const uPlus = raw.match(/^[Uu]\+([0-9a-fA-F]{4,6})$/);
  if (uPlus) {
    return fromCodePointSafe(parseInt(uPlus[1], 16));
  }
  // \uHHHH (exactly 4 hex digits)
  const backslashU = raw.match(/^\\u([0-9a-fA-F]{4})$/);
  if (backslashU) {
    return fromCodePointSafe(parseInt(backslashU[1], 16));
  }
  // \u{HHHH}
  const backslashUBrace = raw.match(/^\\u\{([0-9a-fA-F]{1,6})\}$/);
  if (backslashUBrace) {
    return fromCodePointSafe(parseInt(backslashUBrace[1], 16));
  }
  // 0xHHHH (0x or 0X prefix)
  const hex0x = raw.match(/^0[xX]([0-9a-fA-F]{4,6})$/);
  if (hex0x) {
    return fromCodePointSafe(parseInt(hex0x[1], 16));
  }
  return undefined;
}

const MAX_RANGE_SPAN = 0x4000;

/**
 * Parse a settings entry that may be a single character entry or a range.
 * Range syntax: "u+2500 - u+2502" (any supported notation on either side).
 * Returns an array of characters (empty on invalid input).
 */
export function parseCharacterEntries(entry: string): string[] {
  const dashIdx = entry.indexOf(" - ");
  if (dashIdx !== -1) {
    const startChar = parseCharacterEntry(entry.slice(0, dashIdx).trim());
    const endChar = parseCharacterEntry(entry.slice(dashIdx + 3).trim());
    if (startChar === undefined || endChar === undefined) return [];
    const startCode = startChar.codePointAt(0)!;
    const endCode = endChar.codePointAt(0)!;
    if (startCode > endCode) return [];
    if (endCode - startCode > MAX_RANGE_SPAN) {
      log(
        `character range "${entry.trim()}" exceeds maximum span of ${MAX_RANGE_SPAN}; ignoring`,
      );
      return [];
    }
    const result: string[] = [];
    for (let cp = startCode; cp <= endCode; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue; // lone surrogates can never match real text
      result.push(String.fromCodePoint(cp));
    }
    return result;
  }
  const char = parseCharacterEntry(entry.trim());
  return char !== undefined ? [char] : [];
}

/**
 * Parse a replacement-map key that may contain comma-separated tokens, each
 * of which is a single character entry or a range. Returns the union of all
 * matched characters (empty array on fully invalid input).
 */
export function parseCharacterGroup(key: string): string[] {
  const result: string[] = [];
  for (const token of key.split(",")) {
    for (const ch of parseCharacterEntries(token.trim())) {
      result.push(ch);
    }
  }
  return result;
}

/**
 * Return a title-cased version of a Unicode name.
 * "EM DASH" -> "Em Dash"
 */
export function titleCase(name: string): string {
  return name.toLowerCase().replace(/(?:^|\s)\S/g, ch => ch.toUpperCase());
}

/**
 * Format a hex code point as a u+hhhh string.
 */
export function formatUPlus(hex: string): string {
  return "u+" + hex.toLowerCase();
}

/**
 * Convert a Unicode code point number to a lowercase hex string,
 * zero-padded to at least 4 digits.
 */
export function toHex(codePoint: number): string {
  return codePoint.toString(16).padStart(4, "0");
}

/**
 * Format a hex string according to the given notation and case.
 *
 * @param hex       Lowercase hex digits (e.g. "00e9", "1f600")
 * @param format    One of "u+", "\\u", "\\u{}", "0x"
 * @param caseType  "upper" or "lower"
 */
export function formatCodePoint(
  hex: string,
  format: string,
  caseType: string,
): string {
  const h = caseType === "upper" ? hex.toUpperCase() : hex.toLowerCase();
  switch (format) {
    case "\\u": {
      const cp = parseInt(hex, 16);
      if (cp > 0xffff) {
        // Astral code points must be encoded as a UTF-16 surrogate pair because
        // the \uHHHH form only accepts exactly 4 hex digits.
        const hi = Math.floor((cp - 0x10000) / 0x400) + 0xd800;
        const lo = ((cp - 0x10000) % 0x400) + 0xdc00;
        const hiH =
          caseType === "upper"
            ? hi.toString(16).toUpperCase()
            : hi.toString(16).toLowerCase();
        const loH =
          caseType === "upper"
            ? lo.toString(16).toUpperCase()
            : lo.toString(16).toLowerCase();
        return "\\u" + hiH + "\\u" + loH;
      }
      return "\\u" + h;
    }
    case "\\u{}":
      return "\\u{" + h + "}";
    case "0x":
      return "0x" + h;
    case "u+":
    default:
      return (caseType === "upper" ? "U+" : "u+") + h;
  }
}

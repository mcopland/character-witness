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
export function parseCharacterEntry(raw: string): string | undefined {
  // u+HHHH or U+HHHH
  const uPlus = raw.match(/^[Uu]\+([0-9a-fA-F]{4,6})$/);
  if (uPlus) {
    return String.fromCodePoint(parseInt(uPlus[1], 16));
  }
  // \uHHHH (exactly 4 hex digits)
  const backslashU = raw.match(/^\\u([0-9a-fA-F]{4})$/);
  if (backslashU) {
    return String.fromCodePoint(parseInt(backslashU[1], 16));
  }
  // \u{HHHH}
  const backslashUBrace = raw.match(/^\\u\{([0-9a-fA-F]{1,6})\}$/);
  if (backslashUBrace) {
    return String.fromCodePoint(parseInt(backslashUBrace[1], 16));
  }
  // 0xHHHH (0x or 0X prefix)
  const hex0x = raw.match(/^0[xX]([0-9a-fA-F]{4,6})$/);
  if (hex0x) {
    return String.fromCodePoint(parseInt(hex0x[1], 16));
  }
  return undefined;
}

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
    const result: string[] = [];
    for (let cp = startCode; cp <= endCode; cp++) {
      result.push(String.fromCodePoint(cp));
    }
    return result;
  }
  const char = parseCharacterEntry(entry.trim());
  return char !== undefined ? [char] : [];
}

/**
 * Return a title-cased version of a Unicode name.
 * "EM DASH" → "Em Dash"
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
    case "\\u":
      return "\\u" + h;
    case "\\u{}":
      return "\\u{" + h + "}";
    case "0x":
      return "0x" + h;
    case "u+":
    default:
      return (caseType === "upper" ? "U+" : "u+") + h;
  }
}

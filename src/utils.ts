

/**
 * Normalize a settings-supplied character string into its literal character.
 *
 * Accepts only the `u+HHHH` notation (case-insensitive), e.g. "u+00a3".
 *
 * Returns the single character (possibly a surrogate pair), or undefined if
 * the input is not recognizable.
 */
export function parseCharacterEntry(raw: string): string | undefined {
  const uPlus = raw.match(/^[Uu]\+([0-9a-fA-F]{4,6})$/);
  if (uPlus) {
    return String.fromCodePoint(parseInt(uPlus[1], 16));
  }
  return undefined;
}

/**
 * Return a title-cased version of a Unicode name.
 * "EM DASH" → "Em Dash"
 */
export function titleCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/(?:^|\s)\S/g, (ch) => ch.toUpperCase());
}

/**
 * Format a hex code point as a u+hhhh string.
 */
export function formatUPlus(hex: string): string {
  return "u+" + hex.toLowerCase();
}

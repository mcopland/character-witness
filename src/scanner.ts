import * as vscode from "vscode";
import { getCharacterName } from "./generated/unicode-names";
import { getTextRegions, TextRegion } from "./regions";
import { formatCodePoint, titleCase, toHex } from "./utils";

// ---------------------------------------------------------------------------
// Codepoints that default to Error-level severity
// (invisible/control chars and confusable fullwidth forms)
// Note: surrogate code units (0xD800-0xDBFF, 0xDC00-0xDFFF) are handled
// transparently by the string iterator below. They never appear as lone values.
// ---------------------------------------------------------------------------

export const ERROR_LEVEL_CODEPOINTS: Set<number> = new Set([
  0x00a0, // Non-Breaking Space
  0x00ad, // Soft Hyphen
  0x00b4, // Acute Accent
  0x02bc, // Modifier Letter Apostrophe
  0x200b, // Zero Width Space
  0x200c, // Zero Width Non-Joiner
  0x200d, // Zero Width Joiner
  0x200e, // Left-to-Right Mark
  0x200f, // Right-to-Left Mark
  0x2013, // En Dash
  0x2014, // Em Dash
  0x2018, // Left Single Quotation Mark
  0x2019, // Right Single Quotation Mark
  0x201c, // Left Double Quotation Mark
  0x201d, // Right Double Quotation Mark
  0x2028, // Line Separator
  0x2029, // Paragraph Separator
  0x202a, // Left-to-Right Embedding
  0x202b, // Right-to-Left Embedding
  0x202c, // Pop Directional Formatting
  0x202d, // Left-to-Right Override
  0x202e, // Right-to-Left Override
  0x2060, // Word Joiner
  0x2061, // Function Application
  0x2062, // Invisible Times
  0x2063, // Invisible Separator
  0x2064, // Invisible Plus
  0x2066, // Left-to-Right Isolate
  0x2067, // Right-to-Left Isolate
  0x2068, // First Strong Isolate
  0x2069, // Pop Directional Isolate
  0xfeff, // BOM / Zero Width No-Break Space
  0xff01, // Fullwidth Exclamation Mark
  0xff02, // Fullwidth Quotation Mark
  0xff03, // Fullwidth Number Sign
  0xff04, // Fullwidth Dollar Sign
  0xff05, // Fullwidth Percent Sign
  0xff06, // Fullwidth Ampersand
  0xff07, // Fullwidth Apostrophe
  0xff08, // Fullwidth Left Parenthesis
  0xff09, // Fullwidth Right Parenthesis
  0xff0a, // Fullwidth Asterisk
  0xff0b, // Fullwidth Plus Sign
  0xff0c, // Fullwidth Comma
  0xff0d, // Fullwidth Hyphen-Minus
  0xff0e, // Fullwidth Full Stop
  0xff0f, // Fullwidth Solidus
  0xff10, // Fullwidth Digit Zero
  0xff11, // Fullwidth Digit One
  0xff12, // Fullwidth Digit Two
  0xff13, // Fullwidth Digit Three
  0xff14, // Fullwidth Digit Four
  0xff15, // Fullwidth Digit Five
  0xff16, // Fullwidth Digit Six
  0xff17, // Fullwidth Digit Seven
  0xff18, // Fullwidth Digit Eight
  0xff19, // Fullwidth Digit Nine
  0xff1a, // Fullwidth Colon
  0xff1b, // Fullwidth Semicolon
  0xff1c, // Fullwidth Less-Than Sign
  0xff1d, // Fullwidth Equals Sign
  0xff1e, // Fullwidth Greater-Than Sign
  0xff1f, // Fullwidth Question Mark
  0xff20, // Fullwidth Commercial At
  0xff21, // Fullwidth Latin Capital Letter A
  0xff22, // Fullwidth Latin Capital Letter B
  0xff23, // Fullwidth Latin Capital Letter C
  0xff24, // Fullwidth Latin Capital Letter D
  0xff25, // Fullwidth Latin Capital Letter E
  0xff26, // Fullwidth Latin Capital Letter F
  0xff27, // Fullwidth Latin Capital Letter G
  0xff28, // Fullwidth Latin Capital Letter H
  0xff29, // Fullwidth Latin Capital Letter I
  0xff2a, // Fullwidth Latin Capital Letter J
  0xff2b, // Fullwidth Latin Capital Letter K
  0xff2c, // Fullwidth Latin Capital Letter L
  0xff2d, // Fullwidth Latin Capital Letter M
  0xff2e, // Fullwidth Latin Capital Letter N
  0xff2f, // Fullwidth Latin Capital Letter O
  0xff30, // Fullwidth Latin Capital Letter P
  0xff31, // Fullwidth Latin Capital Letter Q
  0xff32, // Fullwidth Latin Capital Letter R
  0xff33, // Fullwidth Latin Capital Letter S
  0xff34, // Fullwidth Latin Capital Letter T
  0xff35, // Fullwidth Latin Capital Letter U
  0xff36, // Fullwidth Latin Capital Letter V
  0xff37, // Fullwidth Latin Capital Letter W
  0xff38, // Fullwidth Latin Capital Letter X
  0xff39, // Fullwidth Latin Capital Letter Y
  0xff3a, // Fullwidth Latin Capital Letter Z
  0xff3b, // Fullwidth Left Square Bracket
  0xff3c, // Fullwidth Reverse Solidus
  0xff3d, // Fullwidth Right Square Bracket
  0xff3e, // Fullwidth Circumflex Accent
  0xff3f, // Fullwidth Low Line
  0xff40, // Fullwidth Grave Accent
  0xff41, // Fullwidth Latin Small Letter A
  0xff42, // Fullwidth Latin Small Letter B
  0xff43, // Fullwidth Latin Small Letter C
  0xff44, // Fullwidth Latin Small Letter D
  0xff45, // Fullwidth Latin Small Letter E
  0xff46, // Fullwidth Latin Small Letter F
  0xff47, // Fullwidth Latin Small Letter G
  0xff48, // Fullwidth Latin Small Letter H
  0xff49, // Fullwidth Latin Small Letter I
  0xff4a, // Fullwidth Latin Small Letter J
  0xff4b, // Fullwidth Latin Small Letter K
  0xff4c, // Fullwidth Latin Small Letter L
  0xff4d, // Fullwidth Latin Small Letter M
  0xff4e, // Fullwidth Latin Small Letter N
  0xff4f, // Fullwidth Latin Small Letter O
  0xff50, // Fullwidth Latin Small Letter P
  0xff51, // Fullwidth Latin Small Letter Q
  0xff52, // Fullwidth Latin Small Letter R
  0xff53, // Fullwidth Latin Small Letter S
  0xff54, // Fullwidth Latin Small Letter T
  0xff55, // Fullwidth Latin Small Letter U
  0xff56, // Fullwidth Latin Small Letter V
  0xff57, // Fullwidth Latin Small Letter W
  0xff58, // Fullwidth Latin Small Letter X
  0xff59, // Fullwidth Latin Small Letter Y
  0xff5a, // Fullwidth Latin Small Letter Z
  0xff5b, // Fullwidth Left Curly Bracket
  0xff5c, // Fullwidth Vertical Line
  0xff5d, // Fullwidth Right Curly Bracket
  0xff5e, // Fullwidth Tilde
  0xfffd, // Replacement Character
]);

/** A single detected non-ASCII character and its location. */
export interface NonAsciiMatch {
  /** The character itself (may be a surrogate pair). */
  char: string;
  /** Unicode code point. */
  codePoint: number;
  /** Code point as a lowercase hex string, zero-padded to at least 4 digits. */
  hex: string;
  /** Official Unicode character name (e.g. "EM DASH"), or undefined. */
  unicodeName: string | undefined;
  /** Range covering this single character in the document. */
  range: vscode.Range;
}

/**
 * Build the display label for a match, e.g.:
 *   <Name> '<Character>' U+HHHH
 */
function formatDiagnosticMessage(
  match: NonAsciiMatch,
  format: string = "u+",
  caseType: string = "upper",
): string {
  const code = formatCodePoint(match.hex, format, caseType);
  if (match.unicodeName) {
    return titleCase(match.unicodeName) + " '" + match.char + "' " + code;
  }
  return "Character '" + match.char + "' " + code;
}

/**
 * Build a single diagnostic message for a group of matches on the same line.
 * Single match: same as formatDiagnosticMessage.
 * Multiple matches: e.g. "3 non-ASCII characters: ['x', 'y', 'z']"
 */
export function formatGroupedDiagnosticMessage(
  matches: NonAsciiMatch[],
  format: string = "u+",
  caseType: string = "upper",
): string {
  if (matches.length === 1)
    return formatDiagnosticMessage(matches[0], format, caseType);
  const parts = matches.map(m => `'${m.char}'`);
  return `${matches.length} non-ASCII characters: [${parts.join(", ")}]`;
}

export function formatHoverMarkdown(
  match: NonAsciiMatch,
  format: string = "u+",
  caseType: string = "upper",
): vscode.MarkdownString {
  const code = formatCodePoint(match.hex, format, caseType);
  const parts: string[] = [];
  if (match.unicodeName) {
    parts.push("**" + titleCase(match.unicodeName) + "**");
  }
  parts.push("`" + match.char + " " + code + "`");
  return new vscode.MarkdownString(parts.join("  \n"));
}

export function findNonAsciiCharacters(
  document: vscode.TextDocument,
  allowedCharacters: Set<string>,
  includeStrings: boolean = true,
  includeComments: boolean = true,
  languageId: string = "plaintext",
  maxFileSizeBytes: number = Number.POSITIVE_INFINITY,
): NonAsciiMatch[] {
  const text = document.getText();

  if (text.length > maxFileSizeBytes) {
    return [];
  }

  let regions: TextRegion[] | undefined;
  if (!includeStrings || !includeComments) {
    regions = getTextRegions(text, languageId);
  }

  return scanText(
    text,
    allowedCharacters,
    regions,
    includeStrings,
    includeComments,
    0,
  );
}

/**
 * Scan a contiguous line range of a document. Used by the incremental
 * rescan path. Regions (string/comment filtering) are not supported here,
 * so the caller must guarantee `includeStrings && includeComments` upstream.
 */
export function findNonAsciiCharactersInLineRange(
  document: vscode.TextDocument,
  startLine: number,
  endLine: number,
  allowedCharacters: Set<string>,
): NonAsciiMatch[] {
  const lastLine = Math.min(endLine, document.lineCount - 1);
  if (startLine > lastLine) return [];

  const startPos = new vscode.Position(startLine, 0);
  const endPos = document.lineAt(lastLine).range.end;
  const text = document.getText(new vscode.Range(startPos, endPos));

  return scanText(text, allowedCharacters, undefined, true, true, startLine);
}

/**
 * Manual UTF-16 walk with ASCII fast path. Avoids the per-character string
 * allocation that the for...of iterator would cause; allocates only when
 * pushing a match. Shared by full-document and sub-range scanning.
 */
function scanText(
  text: string,
  allowedCharacters: Set<string>,
  regions: TextRegion[] | undefined,
  includeStrings: boolean,
  includeComments: boolean,
  startLine: number,
): NonAsciiMatch[] {
  const matches: NonAsciiMatch[] = [];
  const len = text.length;
  let i = 0;
  let line = startLine;
  let charInLine = 0;
  let prevWasCR = false;

  while (i < len) {
    const code = text.charCodeAt(i);

    if (code === 0x0d) {
      line++;
      charInLine = 0;
      prevWasCR = true;
      i++;
      continue;
    }
    if (code === 0x0a) {
      if (!prevWasCR) {
        line++;
        charInLine = 0;
      }
      prevWasCR = false;
      i++;
      continue;
    }
    prevWasCR = false;

    if (code < 0x80) {
      charInLine++;
      i++;
      continue;
    }

    let codePoint: number;
    let charLength: number;
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < len) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        charLength = 2;
      } else {
        codePoint = code;
        charLength = 1;
      }
    } else {
      codePoint = code;
      charLength = 1;
    }

    if (regions) {
      const regionType = getRegionTypeAtOffset(regions, i);
      if (regionType === "string" && !includeStrings) {
        charInLine += charLength;
        i += charLength;
        continue;
      }
      if (regionType === "comment" && !includeComments) {
        charInLine += charLength;
        i += charLength;
        continue;
      }
    }

    const char = charLength === 1 ? text[i] : text.substring(i, i + 2);
    if (!allowedCharacters.has(char)) {
      const startPos = new vscode.Position(line, charInLine);
      const endPos = new vscode.Position(line, charInLine + charLength);
      matches.push({
        char,
        codePoint,
        hex: toHex(codePoint),
        unicodeName: getCharacterName(codePoint),
        range: new vscode.Range(startPos, endPos),
      });
    }

    charInLine += charLength;
    i += charLength;
  }

  return matches;
}

/**
 * Count the number of line breaks introduced by `text`, using the same
 * CR/LF/CRLF semantics as the scanner. The number of lines the text
 * spans is `countLineBreaks(text) + 1`.
 */
export function countLineBreaks(text: string): number {
  let count = 0;
  let prevWasCR = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x0d) {
      count++;
      prevWasCR = true;
    } else if (c === 0x0a) {
      if (!prevWasCR) count++;
      prevWasCR = false;
    } else {
      prevWasCR = false;
    }
  }
  return count;
}

export interface IncrementalChange {
  range: {
    start: { line: number };
    end: { line: number };
  };
  text: string;
}

/**
 * Apply a single content change to a sorted match list, returning a new
 * sorted match list reflecting the change. Re-scans only the affected
 * line range in the new document, shifting matches below by the line
 * delta. Region filters are not supported; callers must guarantee
 * `includeStrings && includeComments` upstream.
 */
export function applyIncrementalChange(
  prevMatches: NonAsciiMatch[],
  newDocument: vscode.TextDocument,
  change: IncrementalChange,
  allowedCharacters: Set<string>,
): NonAsciiMatch[] {
  const oldStartLine = change.range.start.line;
  const oldEndLine = change.range.end.line;
  const lineBreaks = countLineBreaks(change.text);
  const newEndLine = oldStartLine + lineBreaks;
  const lineDelta = newEndLine - oldEndLine;

  // Locate the boundary indices in the previous (sorted) match list.
  // firstAffectedIdx is the first match whose line >= oldStartLine.
  // firstAfterIdx is the first match whose line > oldEndLine.
  let firstAffectedIdx = 0;
  while (
    firstAffectedIdx < prevMatches.length &&
    prevMatches[firstAffectedIdx].range.start.line < oldStartLine
  ) {
    firstAffectedIdx++;
  }
  let firstAfterIdx = firstAffectedIdx;
  while (
    firstAfterIdx < prevMatches.length &&
    prevMatches[firstAfterIdx].range.start.line <= oldEndLine
  ) {
    firstAfterIdx++;
  }

  const newMatches = findNonAsciiCharactersInLineRange(
    newDocument,
    oldStartLine,
    newEndLine,
    allowedCharacters,
  );

  const above = prevMatches.slice(0, firstAffectedIdx);
  const belowSrc = prevMatches.slice(firstAfterIdx);
  const below =
    lineDelta === 0 ? belowSrc : belowSrc.map(m => shiftMatchLine(m, lineDelta));

  return [...above, ...newMatches, ...below];
}

function shiftMatchLine(m: NonAsciiMatch, lineDelta: number): NonAsciiMatch {
  return {
    ...m,
    range: new vscode.Range(
      new vscode.Position(
        m.range.start.line + lineDelta,
        m.range.start.character,
      ),
      new vscode.Position(
        m.range.end.line + lineDelta,
        m.range.end.character,
      ),
    ),
  };
}

function getRegionTypeAtOffset(
  regions: TextRegion[],
  offset: number,
): "string" | "comment" | undefined {
  let lo = 0;
  let hi = regions.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = regions[mid];
    if (offset < r.start) {
      hi = mid - 1;
    } else if (offset >= r.end) {
      lo = mid + 1;
    } else {
      return r.type;
    }
  }
  return undefined;
}

/**
 * Binary-search a sorted match list for the entry covering `position`.
 * Matches are produced left-to-right by findNonAsciiCharacters, so their
 * ranges are sorted and non-overlapping. Returns undefined when no match
 * contains the position.
 */
export function findMatchAtPosition(
  matches: NonAsciiMatch[],
  position: vscode.Position,
): NonAsciiMatch | undefined {
  let lo = 0;
  let hi = matches.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = matches[mid];
    if (position.isBefore(m.range.start)) {
      hi = mid - 1;
    } else if (position.isAfter(m.range.end)) {
      lo = mid + 1;
    } else {
      return m;
    }
  }
  return undefined;
}

/**
 * Binary-search for the first match whose start position is strictly after
 * `cursor`. Returns undefined when no such match exists.
 */
export function findNextMatchAfter(
  matches: NonAsciiMatch[],
  cursor: vscode.Position,
): NonAsciiMatch | undefined {
  let lo = 0;
  let hi = matches.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (matches[mid].range.start.isAfter(cursor)) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return lo < matches.length ? matches[lo] : undefined;
}

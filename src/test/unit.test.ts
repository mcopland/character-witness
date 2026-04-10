import * as assert from "assert";
import * as vscode from "vscode";

vi.mock("vscode", () => ({
  Range: class {
    constructor(
      public start: { line: number; character: number },
      public end: { line: number; character: number },
    ) {}
  },
  Position: class {
    constructor(
      public line: number,
      public character: number,
    ) {}
    isAfter(other: { line: number; character: number }): boolean {
      if (this.line !== other.line) return this.line > other.line;
      return this.character > other.character;
    }
  },
  Selection: class {
    constructor(
      public anchor: { line: number; character: number },
      public active: { line: number; character: number },
    ) {}
  },
  TextEditorRevealType: {
    InCenterIfOutsideViewport: 2,
  },
  DiagnosticSeverity: {
    Error: 0,
    Warning: 1,
    Information: 2,
    Hint: 3,
  },
  MarkdownString: class {
    constructor(public value: string) {}
  },
  workspace: {
    getWorkspaceFolder: () => undefined,
  },
  window: {
    activeTextEditor: undefined as unknown,
    showInformationMessage: vi.fn().mockResolvedValue(undefined),
  },
}));

// ---------------------------------------------------------------------------
// These tests exercise pure functions that don't require the VS Code API.
// Run with:  npx vitest run
// ---------------------------------------------------------------------------

import { goToNextNonAsciiCharacter } from "../commands";
import {
  compileIgnoredPaths,
  ExtensionConfig,
  getCharacterSeverity,
} from "../config";
import * as configModule from "../config";
import { isIgnoredDocument } from "../extension";
import { getCharacterName, UNICODE_VERSION } from "../generated/unicode-names";
import { getTextRegions } from "../regions";
import {
  findNonAsciiCharacters,
  formatGroupedDiagnosticMessage,
  formatHoverMarkdown,
  NonAsciiMatch,
} from "../scanner";
import {
  formatCodePoint,
  formatUPlus,
  parseCharacterEntries,
  parseCharacterEntry,
  parseCharacterGroup,
  titleCase,
  toHex,
} from "../utils";

describe("parseCharacterEntry", () => {
  test("u+HHHH notation", () => {
    assert.strictEqual(parseCharacterEntry("U+00A3"), "£");
    assert.strictEqual(parseCharacterEntry("u+2014"), "—");
    assert.strictEqual(parseCharacterEntry("U+1F600"), "\u{1f600}");
  });

  test("empty string returns undefined", () => {
    assert.strictEqual(parseCharacterEntry(""), undefined);
  });

  test("literal characters are rejected", () => {
    assert.strictEqual(parseCharacterEntry("£"), undefined);
    assert.strictEqual(parseCharacterEntry("©"), undefined);
    assert.strictEqual(parseCharacterEntry("A"), undefined);
  });

  test("accepts \\uHHHH format", () =>
    assert.strictEqual(parseCharacterEntry("\\u00a3"), "\u00a3"));
  test("accepts \\u{HHHH} format", () =>
    assert.strictEqual(parseCharacterEntry("\\u{00a3}"), "\u00a3"));
  test("accepts 0xHHHH format", () =>
    assert.strictEqual(parseCharacterEntry("0x00a3"), "\u00a3"));
  test("accepts 0XHHHH format", () =>
    assert.strictEqual(parseCharacterEntry("0X00a3"), "\u00a3"));
  test("\\uHHHH requires exactly 4 digits", () =>
    assert.strictEqual(parseCharacterEntry("\\u219"), undefined));

  test("unrecognized input returns undefined", () => {
    assert.strictEqual(parseCharacterEntry("hello"), undefined);
    assert.strictEqual(parseCharacterEntry("\\xA3"), undefined);
  });
});

describe("parseCharacterEntries", () => {
  test("single u+HHHH entry returns one-element array", () => {
    assert.deepStrictEqual(parseCharacterEntries("u+2014"), ["—"]);
  });

  test("range returns all characters inclusive", () => {
    const result = parseCharacterEntries("u+2500 - u+2502");
    assert.deepStrictEqual(result, ["\u2500", "\u2501", "\u2502"]);
  });

  test("range with spaces around dash", () => {
    assert.strictEqual(parseCharacterEntries("u+2500 - u+2500").length, 1);
  });

  test("single-element range (start equals end)", () => {
    assert.deepStrictEqual(parseCharacterEntries("u+2500 - u+2500"), [
      "\u2500",
    ]);
  });

  test("inverted range (start > end) returns empty array", () => {
    assert.deepStrictEqual(parseCharacterEntries("u+2505 - u+2500"), []);
  });

  test("unrecognized input returns empty array", () => {
    assert.deepStrictEqual(parseCharacterEntries("hello"), []);
    assert.deepStrictEqual(parseCharacterEntries(""), []);
  });

  test("range with \\u format", () =>
    assert.strictEqual(parseCharacterEntries("\\u2018 - \\u2020").length, 9));
  test("range with 0x format", () =>
    assert.strictEqual(parseCharacterEntries("0x2018 - 0x2020").length, 9));
  test("range with mixed formats", () =>
    assert.strictEqual(parseCharacterEntries("u+2018 - 0x2020").length, 9));
});

describe("parseCharacterGroup", () => {
  test("single entry returns one-element array", () => {
    assert.deepStrictEqual(parseCharacterGroup("u+00a0"), ["\u00a0"]);
  });

  test("range returns all characters inclusive", () => {
    assert.deepStrictEqual(parseCharacterGroup("u+25aa - u+25ab"), [
      "\u25aa",
      "\u25ab",
    ]);
  });

  test("comma-separated list returns all listed characters", () => {
    assert.deepStrictEqual(parseCharacterGroup("u+25aa, u+25ab, u+25e6"), [
      "\u25aa",
      "\u25ab",
      "\u25e6",
    ]);
  });

  test("combined range and single entry", () => {
    assert.deepStrictEqual(parseCharacterGroup("u+25aa - u+25ab, u+25e6"), [
      "\u25aa",
      "\u25ab",
      "\u25e6",
    ]);
  });

  test("extra whitespace around tokens is ignored", () => {
    assert.deepStrictEqual(parseCharacterGroup("  u+25aa ,  u+25ab  "), [
      "\u25aa",
      "\u25ab",
    ]);
  });

  test("fully invalid input returns empty array", () => {
    assert.deepStrictEqual(parseCharacterGroup("garbage"), []);
  });

  test("range with start > end returns empty array", () => {
    assert.deepStrictEqual(parseCharacterGroup("u+25ab - u+25aa"), []);
  });
});

describe("titleCase", () => {
  test("converts uppercase Unicode names", () => {
    assert.strictEqual(titleCase("EM DASH"), "Em Dash");
    assert.strictEqual(
      titleCase("LEFT SINGLE QUOTATION MARK"),
      "Left Single Quotation Mark",
    );
    assert.strictEqual(titleCase("COPYRIGHT SIGN"), "Copyright Sign");
  });
});

describe("toHex", () => {
  test("BMP code point is padded to 4 hex digits", () => {
    assert.strictEqual(toHex(0x00e9), "00e9");
    assert.strictEqual(toHex(0x2014), "2014");
  });

  test("supplementary code point produces 5+ digit hex", () => {
    assert.strictEqual(toHex(0x1f600), "1f600");
  });

  test("returns lowercase hex", () => {
    assert.strictEqual(toHex(0xfffd), "fffd");
    assert.strictEqual(toHex(0xff21), "ff21");
  });
});

describe("formatCodePoint", () => {
  test("u+ format lower case", () =>
    assert.strictEqual(formatCodePoint("00e9", "u+", "lower"), "u+00e9"));
  test("u+ format upper case", () =>
    assert.strictEqual(formatCodePoint("00e9", "u+", "upper"), "U+00E9"));
  test("\\u format lower case", () =>
    assert.strictEqual(formatCodePoint("00e9", "\\u", "lower"), "\\u00e9"));
  test("\\u format upper case", () =>
    assert.strictEqual(formatCodePoint("00e9", "\\u", "upper"), "\\u00E9"));
  test("\\u{} format lower case", () =>
    assert.strictEqual(
      formatCodePoint("1f600", "\\u{}", "lower"),
      "\\u{1f600}",
    ));
  test("\\u{} format upper case", () =>
    assert.strictEqual(
      formatCodePoint("1f600", "\\u{}", "upper"),
      "\\u{1F600}",
    ));
  test("0x format lower case", () =>
    assert.strictEqual(formatCodePoint("00e9", "0x", "lower"), "0x00e9"));
  test("0x format upper case", () =>
    assert.strictEqual(formatCodePoint("00e9", "0x", "upper"), "0x00E9"));
  test("supplementary code point (5 hex digits)", () => {
    assert.strictEqual(formatCodePoint("1f600", "u+", "upper"), "U+1F600");
    assert.strictEqual(formatCodePoint("1f600", "u+", "lower"), "u+1f600");
  });
});

describe("Unicode name lookups", () => {
  test("UNICODE_VERSION is pinned", () => {
    assert.strictEqual(UNICODE_VERSION, "16.0.0");
  });

  test("common symbols", () => {
    assert.strictEqual(getCharacterName(0x2014), "EM DASH");
    assert.strictEqual(getCharacterName(0x2018), "LEFT SINGLE QUOTATION MARK");
    assert.strictEqual(getCharacterName(0x00a9), "COPYRIGHT SIGN");
    assert.strictEqual(getCharacterName(0x00f7), "DIVISION SIGN");
    assert.strictEqual(getCharacterName(0x00a3), "POUND SIGN");
    assert.strictEqual(
      getCharacterName(0x00e9),
      "LATIN SMALL LETTER E WITH ACUTE",
    );
  });

  test("CJK unified ideographs (algorithmic)", () => {
    assert.strictEqual(getCharacterName(0x4e00), "CJK UNIFIED IDEOGRAPH-4E00");
    assert.strictEqual(getCharacterName(0x9fff), "CJK UNIFIED IDEOGRAPH-9FFF");
  });

  test("Hangul syllables", () => {
    assert.strictEqual(getCharacterName(0xac00), "HANGUL SYLLABLE GA");
    assert.strictEqual(getCharacterName(0xd7a3), "HANGUL SYLLABLE HIH");
  });

  test("control character aliases", () => {
    assert.strictEqual(getCharacterName(0x0085), "NEXT LINE");
    assert.strictEqual(getCharacterName(0x008a), "LINE TABULATION SET");
  });

  test("correction aliases override original name", () => {
    // U+01A2 was corrected from LATIN CAPITAL LETTER OI to LATIN CAPITAL LETTER GHA
    assert.strictEqual(getCharacterName(0x01a2), "LATIN CAPITAL LETTER GHA");
  });

  test("ASCII code points return undefined", () => {
    assert.strictEqual(getCharacterName(0x41), undefined);
    assert.strictEqual(getCharacterName(0x7f), undefined);
  });
});

function makeMatch(char: string): NonAsciiMatch {
  return {
    char,
    codePoint: char.codePointAt(0)!,
    hex: "00b7",
    unicodeName: undefined,
    range: new vscode.Range(
      new vscode.Position(0, 0),
      new vscode.Position(0, 1),
    ),
  };
}

function makeMatchAt(line: number, character: number): NonAsciiMatch {
  return {
    char: "\u00b7",
    codePoint: 0x00b7,
    hex: "00b7",
    unicodeName: undefined,
    range: new vscode.Range(
      new vscode.Position(line, character),
      new vscode.Position(line, character + 1),
    ),
  };
}

describe("formatGroupedDiagnosticMessage", () => {
  test("single match delegates to single-char format", () => {
    const m = { ...makeMatch("·"), unicodeName: "MIDDLE DOT" };
    assert.strictEqual(
      formatGroupedDiagnosticMessage([m]),
      "Middle Dot '·' U+00B7",
    );
  });

  test("two matches produces compact array format", () => {
    assert.strictEqual(
      formatGroupedDiagnosticMessage([makeMatch("·"), makeMatch("—")]),
      "2 non-ASCII characters: ['·', '—']",
    );
  });

  test("count reflects number of matches", () => {
    const matches = ["·", "·", "©", "®", "™", "°"].map(makeMatch);
    assert.ok(
      formatGroupedDiagnosticMessage(matches).startsWith(
        "6 non-ASCII characters: ",
      ),
    );
  });

  test("array contains each char in order", () => {
    const result = formatGroupedDiagnosticMessage([
      makeMatch("·"),
      makeMatch("©"),
      makeMatch("®"),
    ]);
    assert.strictEqual(result, "3 non-ASCII characters: ['·', '©', '®']");
  });

  test("single match with non-default format and case", () => {
    const m = { ...makeMatch("·"), unicodeName: "MIDDLE DOT" };
    assert.strictEqual(
      formatGroupedDiagnosticMessage([m], "0x", "upper"),
      "Middle Dot '·' 0x00B7",
    );
  });
});

describe("compileIgnoredPaths", () => {
  test("glob with extension wildcard matches filename", () => {
    const result = compileIgnoredPaths(["unicode-names.*"]);
    assert.strictEqual(result.length, 1);
    assert.ok(result[0].test("unicode-names.ts"));
  });

  test("double-star glob matches path containing segment", () => {
    const result = compileIgnoredPaths(["**/node_modules/**"]);
    assert.ok(result[0].test("/home/user/project/node_modules/pkg/index.js"));
  });

  test("returns empty array for empty input", () => {
    assert.deepStrictEqual(compileIgnoredPaths([]), []);
  });
});

describe("isIgnoredDocument", () => {
  function makeDoc(fsPath: string) {
    return { uri: { fsPath } as unknown as vscode.Uri };
  }

  test("returns false when ignoredPaths is empty", () => {
    assert.strictEqual(isIgnoredDocument(makeDoc("/foo/bar.ts"), []), false);
  });

  test("returns true when a pattern matches the normalized path", () => {
    assert.strictEqual(
      isIgnoredDocument(makeDoc("/foo/bar.ts"), [/bar\.ts$/]),
      true,
    );
  });

  test("returns false when no pattern matches", () => {
    assert.strictEqual(
      isIgnoredDocument(makeDoc("/foo/bar.ts"), [/baz\.ts$/]),
      false,
    );
  });

  test("normalizes backslashes to forward slashes before matching", () => {
    assert.strictEqual(
      isIgnoredDocument(makeDoc("C:\\foo\\bar.ts"), [/foo\/bar\.ts$/]),
      true,
    );
  });
});

describe("goToNextNonAsciiCharacter", () => {
  let mockEditor: {
    document: object;
    selection:
      | { active: InstanceType<typeof vscode.Position> }
      | InstanceType<typeof vscode.Selection>;
    revealRange: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockEditor = {
      document: {},
      selection: { active: new vscode.Position(0, 0) },
      revealRange: vi.fn(),
    };
    (vscode.window as { activeTextEditor: unknown }).activeTextEditor =
      mockEditor;
    vi.spyOn(configModule, "getConfig").mockReturnValue({
      enable: true,
      allowedCharacters: new Set<string>(),
      includeStrings: true,
      includeComments: true,
    } as ExtensionConfig);
    (
      vscode.window.showInformationMessage as ReturnType<typeof vi.fn>
    ).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (vscode.window as { activeTextEditor: unknown }).activeTextEditor =
      undefined;
  });

  test("shows info message when no matches exist", async () => {
    const getCachedMatches = vi.fn().mockReturnValue([]);
    const originalSelection = mockEditor.selection;
    await goToNextNonAsciiCharacter(getCachedMatches);
    const calls = (
      vscode.window.showInformationMessage as ReturnType<typeof vi.fn>
    ).mock.calls;
    assert.ok(calls.length > 0);
    assert.ok((calls[0][0] as string).includes("No non-ASCII characters"));
    assert.strictEqual(mockEditor.selection, originalSelection);
  });

  test("selects first match when cursor is before all matches", async () => {
    const matches = [makeMatchAt(1, 0), makeMatchAt(2, 0)];
    const getCachedMatches = vi.fn().mockReturnValue(matches);
    mockEditor.selection = { active: new vscode.Position(0, 5) };
    await goToNextNonAsciiCharacter(getCachedMatches);
    assert.ok(mockEditor.selection instanceof vscode.Selection);
    const sel1 = mockEditor.selection as InstanceType<typeof vscode.Selection>;
    assert.strictEqual(sel1.anchor.line, 1);
    assert.strictEqual(sel1.anchor.character, 0);
  });

  test("selects the next match after the cursor", async () => {
    const matches = [makeMatchAt(1, 0), makeMatchAt(3, 0), makeMatchAt(5, 0)];
    const getCachedMatches = vi.fn().mockReturnValue(matches);
    mockEditor.selection = { active: new vscode.Position(2, 0) };
    await goToNextNonAsciiCharacter(getCachedMatches);
    assert.ok(mockEditor.selection instanceof vscode.Selection);
    const sel2 = mockEditor.selection as InstanceType<typeof vscode.Selection>;
    assert.strictEqual(sel2.anchor.line, 3);
  });

  test("wraps to first match when cursor is at or after the last match", async () => {
    const matches = [makeMatchAt(1, 0), makeMatchAt(3, 0)];
    const getCachedMatches = vi.fn().mockReturnValue(matches);
    mockEditor.selection = { active: new vscode.Position(5, 0) };
    await goToNextNonAsciiCharacter(getCachedMatches);
    assert.ok(mockEditor.selection instanceof vscode.Selection);
    const sel3 = mockEditor.selection as InstanceType<typeof vscode.Selection>;
    assert.strictEqual(sel3.anchor.line, 1);
    assert.strictEqual(sel3.anchor.character, 0);
  });
});

// ---------------------------------------------------------------------------
// getTextRegions
// ---------------------------------------------------------------------------

describe("getTextRegions", () => {
  test("JS/TS: detects line comments", () => {
    const regions = getTextRegions("// hello", "javascript");
    assert.strictEqual(regions.length, 1);
    assert.strictEqual(regions[0].type, "comment");
    assert.strictEqual(regions[0].start, 0);
    assert.strictEqual(regions[0].end, 8);
  });

  test("JS/TS: detects block comments", () => {
    const regions = getTextRegions("/* block */", "typescript");
    assert.strictEqual(regions.length, 1);
    assert.strictEqual(regions[0].type, "comment");
    assert.strictEqual(regions[0].start, 0);
    assert.strictEqual(regions[0].end, 11);
  });

  test("JS/TS: detects double-quoted strings", () => {
    const regions = getTextRegions('x = "hello"', "javascript");
    assert.strictEqual(regions.length, 1);
    assert.strictEqual(regions[0].type, "string");
    assert.strictEqual(regions[0].start, 4);
    assert.strictEqual(regions[0].end, 11);
  });

  test("JS/TS: detects single-quoted strings", () => {
    const regions = getTextRegions("x = 'hello'", "typescript");
    assert.strictEqual(regions.length, 1);
    assert.strictEqual(regions[0].type, "string");
  });

  test("JS/TS: detects template literals", () => {
    const regions = getTextRegions("x = `hello`", "javascriptreact");
    assert.strictEqual(regions.length, 1);
    assert.strictEqual(regions[0].type, "string");
  });

  test("JS/TS: handles escaped quotes inside strings", () => {
    const regions = getTextRegions('x = "he\\"llo"', "javascript");
    assert.strictEqual(regions.length, 1);
    assert.strictEqual(regions[0].type, "string");
    assert.strictEqual(regions[0].end, 13);
  });

  test("JS/TS: detects multiple regions", () => {
    const code = '// comment\nconst x = "str";';
    const regions = getTextRegions(code, "javascript");
    assert.strictEqual(regions.length, 2);
    assert.strictEqual(regions[0].type, "comment");
    assert.strictEqual(regions[1].type, "string");
  });

  test("Python: detects hash comments", () => {
    const regions = getTextRegions("# comment", "python");
    assert.strictEqual(regions.length, 1);
    assert.strictEqual(regions[0].type, "comment");
  });

  test("Python: detects triple-double-quoted strings", () => {
    const regions = getTextRegions('x = """hello"""', "python");
    assert.strictEqual(regions.length, 1);
    assert.strictEqual(regions[0].type, "string");
  });

  test("Python: detects triple-single-quoted strings", () => {
    const regions = getTextRegions("x = '''hello'''", "python");
    assert.strictEqual(regions.length, 1);
    assert.strictEqual(regions[0].type, "string");
  });

  test("Ruby/shell: detects hash comments and strings", () => {
    const code = '# comment\nx = "str"';
    const regions = getTextRegions(code, "ruby");
    assert.strictEqual(regions.length, 2);
    assert.strictEqual(regions[0].type, "comment");
    assert.strictEqual(regions[1].type, "string");
  });

  test("HTML: detects HTML comments", () => {
    const regions = getTextRegions("<!-- comment -->", "html");
    assert.strictEqual(regions.length, 1);
    assert.strictEqual(regions[0].type, "comment");
  });

  test("HTML: detects attribute strings", () => {
    const regions = getTextRegions('<a href="url">', "html");
    assert.strictEqual(regions.length, 1);
    assert.strictEqual(regions[0].type, "string");
  });

  test("SQL: detects line comments and single-quoted strings", () => {
    const code = "-- comment\nSELECT 'value'";
    const regions = getTextRegions(code, "sql");
    assert.strictEqual(regions.length, 2);
    assert.strictEqual(regions[0].type, "comment");
    assert.strictEqual(regions[1].type, "string");
  });

  test("SQL: detects block comments", () => {
    const regions = getTextRegions("/* block */", "sql");
    assert.strictEqual(regions.length, 1);
    assert.strictEqual(regions[0].type, "comment");
  });

  test("Lua: detects block comments", () => {
    const regions = getTextRegions("--[[ block ]]", "lua");
    assert.strictEqual(regions.length, 1);
    assert.strictEqual(regions[0].type, "comment");
  });

  test("Lua: detects line comments", () => {
    const regions = getTextRegions("-- line comment", "lua");
    assert.strictEqual(regions.length, 1);
    assert.strictEqual(regions[0].type, "comment");
  });

  test("default language: detects only strings", () => {
    const code = '// not a comment\n"a string"';
    const regions = getTextRegions(code, "unknownlang");
    assert.strictEqual(regions.length, 1);
    assert.strictEqual(regions[0].type, "string");
  });

  test("empty input returns empty array", () => {
    const regions = getTextRegions("", "javascript");
    assert.strictEqual(regions.length, 0);
  });

  test("applies to css/scss/less language family", () => {
    const regions = getTextRegions("/* comment */", "css");
    assert.strictEqual(regions.length, 1);
    assert.strictEqual(regions[0].type, "comment");
  });
});

// ---------------------------------------------------------------------------
// getCharacterSeverity
// ---------------------------------------------------------------------------

describe("getCharacterSeverity", () => {
  const baseConfig = {
    enable: true,
    decoration: {},
    allowedCharacters: new Set<string>(),
    autoReplaceOnSave: false,
    replacements: [],
    severityOverrides: new Map<string, number>(),
    includeStrings: true,
    includeComments: true,
    codePointFormat: "u+",
    codePointCase: "upper",
    ignoredPaths: [],
    diagnosticSeverities: new Set([0, 1, 2]),
  } as ExtensionConfig;

  test("returns Error for error-level codepoints", () => {
    const severity = getCharacterSeverity("\u00a0", baseConfig);
    assert.strictEqual(severity, vscode.DiagnosticSeverity.Error);
  });

  test("returns Information for ordinary non-ASCII", () => {
    const severity = getCharacterSeverity("\u00e9", baseConfig);
    assert.strictEqual(severity, vscode.DiagnosticSeverity.Information);
  });

  test("user override takes precedence over error-level", () => {
    const config = {
      ...baseConfig,
      severityOverrides: new Map([
        ["\u00a0", vscode.DiagnosticSeverity.Warning],
      ]),
    } as ExtensionConfig;
    const severity = getCharacterSeverity("\u00a0", config);
    assert.strictEqual(severity, vscode.DiagnosticSeverity.Warning);
  });

  test("user override for non-error-level character", () => {
    const config = {
      ...baseConfig,
      severityOverrides: new Map([["\u00e9", vscode.DiagnosticSeverity.Error]]),
    } as ExtensionConfig;
    const severity = getCharacterSeverity("\u00e9", config);
    assert.strictEqual(severity, vscode.DiagnosticSeverity.Error);
  });
});

// ---------------------------------------------------------------------------
// formatUPlus
// ---------------------------------------------------------------------------

describe("formatUPlus", () => {
  test("lowercases and prepends u+", () => {
    assert.strictEqual(formatUPlus("00A3"), "u+00a3");
  });

  test("already lowercase input", () => {
    assert.strictEqual(formatUPlus("2014"), "u+2014");
  });
});

// ---------------------------------------------------------------------------
// formatHoverMarkdown
// ---------------------------------------------------------------------------

describe("formatHoverMarkdown", () => {
  function makeHoverMatch(unicodeName: string | undefined): NonAsciiMatch {
    return {
      char: "\u2014",
      codePoint: 0x2014,
      hex: "2014",
      unicodeName,
      range: new vscode.Range(
        new vscode.Position(0, 0),
        new vscode.Position(0, 1),
      ),
    };
  }

  test("match with unicode name includes bold name and code", () => {
    const md = formatHoverMarkdown(makeHoverMatch("EM DASH"));
    assert.ok(md.value.includes("**Em Dash**"));
    assert.ok(md.value.includes("2014"));
  });

  test("match without unicode name includes only code", () => {
    const md = formatHoverMarkdown(makeHoverMatch(undefined));
    assert.ok(!md.value.includes("**"));
    assert.ok(md.value.includes("2014"));
  });

  test("respects format and case options", () => {
    const md = formatHoverMarkdown(makeHoverMatch("EM DASH"), "0x", "lower");
    assert.ok(md.value.includes("0x2014"));
  });
});

// ---------------------------------------------------------------------------
// findNonAsciiCharacters
// ---------------------------------------------------------------------------

describe("findNonAsciiCharacters", () => {
  function mockDocument(text: string, languageId = "plaintext") {
    return {
      getText: () => text,
      languageId,
    } as unknown as vscode.TextDocument;
  }

  test("finds non-ASCII characters with correct fields", () => {
    const doc = mockDocument("a\u00e9b");
    const matches = findNonAsciiCharacters(doc, new Set());
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0].char, "\u00e9");
    assert.strictEqual(matches[0].codePoint, 0x00e9);
    assert.strictEqual(matches[0].hex, "00e9");
    assert.strictEqual(matches[0].range.start.line, 0);
    assert.strictEqual(matches[0].range.start.character, 1);
    assert.strictEqual(matches[0].range.end.character, 2);
  });

  test("returns empty for ASCII-only text", () => {
    const doc = mockDocument("hello world 123");
    const matches = findNonAsciiCharacters(doc, new Set());
    assert.strictEqual(matches.length, 0);
  });

  test("respects allowedCharacters", () => {
    const doc = mockDocument("\u00e9\u00f1");
    const allowed = new Set(["\u00e9"]);
    const matches = findNonAsciiCharacters(doc, allowed);
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0].char, "\u00f1");
  });

  test("handles surrogate pairs", () => {
    const doc = mockDocument("a\u{1F600}b");
    const matches = findNonAsciiCharacters(doc, new Set());
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0].codePoint, 0x1f600);
    assert.strictEqual(matches[0].hex, "1f600");
    assert.strictEqual(matches[0].range.start.character, 1);
    assert.strictEqual(matches[0].range.end.character, 3);
  });

  test("tracks line and column across multiple lines", () => {
    const doc = mockDocument("abc\ndef\u00e9g\nhij\u00f1");
    const matches = findNonAsciiCharacters(doc, new Set());
    assert.strictEqual(matches.length, 2);
    assert.strictEqual(matches[0].range.start.line, 1);
    assert.strictEqual(matches[0].range.start.character, 3);
    assert.strictEqual(matches[1].range.start.line, 2);
    assert.strictEqual(matches[1].range.start.character, 3);
  });

  test("handles CRLF line endings", () => {
    const doc = mockDocument("abc\r\ndef\u00e9");
    const matches = findNonAsciiCharacters(doc, new Set());
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0].range.start.line, 1);
    assert.strictEqual(matches[0].range.start.character, 3);
  });

  test("handles bare CR line endings", () => {
    const doc = mockDocument("abc\rdef\u00e9");
    const matches = findNonAsciiCharacters(doc, new Set());
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0].range.start.line, 1);
    assert.strictEqual(matches[0].range.start.character, 3);
  });

  test("includeStrings=false skips characters in strings", () => {
    const doc = mockDocument('const x = "\u00e9";', "javascript");
    const matches = findNonAsciiCharacters(
      doc,
      new Set(),
      false,
      true,
      "javascript",
    );
    assert.strictEqual(matches.length, 0);
  });

  test("includeComments=false skips characters in comments", () => {
    const doc = mockDocument("// \u00e9", "javascript");
    const matches = findNonAsciiCharacters(
      doc,
      new Set(),
      true,
      false,
      "javascript",
    );
    assert.strictEqual(matches.length, 0);
  });

  test("characters outside strings/comments found even when filters active", () => {
    const doc = mockDocument('const \u00e9 = "\u00f1";', "javascript");
    const matches = findNonAsciiCharacters(
      doc,
      new Set(),
      false,
      false,
      "javascript",
    );
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0].char, "\u00e9");
  });

  test("returns empty for empty document", () => {
    const doc = mockDocument("");
    const matches = findNonAsciiCharacters(doc, new Set());
    assert.strictEqual(matches.length, 0);
  });
});

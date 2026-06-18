import * as assert from "assert";
import * as vscode from "vscode";

vi.mock("vscode", () => ({
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3,
  },
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
    isBefore(other: { line: number; character: number }): boolean {
      if (this.line !== other.line) return this.line < other.line;
      return this.character < other.character;
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
  Diagnostic: class {
    source?: string;
    constructor(
      public range: unknown,
      public message: string,
      public severity: number,
    ) {}
  },
  MarkdownString: class {
    constructor(public value: string) {}
  },
  workspace: {
    getWorkspaceFolder: () => undefined,
    isTrusted: true,
    onDidGrantWorkspaceTrust: () => ({ dispose: () => {} }),
    workspaceFolders: undefined,
  },
  window: {
    activeTextEditor: undefined as unknown,
    showInformationMessage: vi.fn().mockResolvedValue(undefined),
    showErrorMessage: vi.fn().mockResolvedValue(undefined),
  },
}));

// ---------------------------------------------------------------------------
// These tests exercise pure functions that don't require the VS Code API.
// Run with:  npx vitest run
// ---------------------------------------------------------------------------

import { addToAllowedCharacters, goToNextNonAsciiCharacter } from "../commands";
import * as configModule from "../config";
import {
  compileIgnoredPaths,
  ExtensionConfig,
  getCharacterSeverity,
} from "../config";
import { buildLineDiagnostics } from "../diagnostics";
import { handleError } from "../logger";
import { isIgnoredDocument } from "../extension";
import {
  getCharacterName,
  parseNameTable,
  UNICODE_VERSION,
} from "../generated/unicode-names";
import { getTextRegions } from "../regions";
import {
  applyIncrementalChange,
  countLineBreaks,
  findMatchAtPosition,
  findNextMatchAfter,
  findNonAsciiCharacters,
  findNonAsciiCharactersInLineRange,
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
  test("oversized range returns empty array", { timeout: 500 }, () =>
    assert.deepStrictEqual(parseCharacterEntries("u+0000 - u+10ffff"), []),
  );
  test("range spanning surrogates excludes 0xD800-0xDFFF", () => {
    const result = parseCharacterEntries("u+d7ff - u+e000");
    for (const ch of result) {
      const cp = ch.codePointAt(0)!;
      assert.ok(
        cp < 0xd800 || cp > 0xdfff,
        `surrogate U+${cp.toString(16)} must not appear in result`,
      );
    }
    assert.ok(
      result.some(ch => ch.codePointAt(0) === 0xd7ff),
      "U+D7FF should be included",
    );
    assert.ok(
      result.some(ch => ch.codePointAt(0) === 0xe000),
      "U+E000 should be included",
    );
  });
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
  test("\\u format emits surrogate pair for astral code points (upper)", () =>
    assert.strictEqual(
      formatCodePoint("1f600", "\\u", "upper"),
      "\\uD83D\\uDE00",
    ));
  test("\\u format emits surrogate pair for astral code points (lower)", () =>
    assert.strictEqual(
      formatCodePoint("1f600", "\\u", "lower"),
      "\\ud83d\\ude00",
    ));
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

describe("formatGroupedDiagnosticMessage", () => {
  test("single match delegates to single-char format", () => {
    const m = { ...buildMatch(0, 0, 1, "·"), unicodeName: "MIDDLE DOT" };
    assert.strictEqual(
      formatGroupedDiagnosticMessage([m]),
      "Middle Dot '·' U+00B7",
    );
  });

  test("two matches produces compact array format", () => {
    assert.strictEqual(
      formatGroupedDiagnosticMessage([
        buildMatch(0, 0, 1, "·"),
        buildMatch(0, 0, 1, "—"),
      ]),
      "2 non-ASCII characters: ['·', '—']",
    );
  });

  test("count reflects number of matches", () => {
    const matches = ["·", "·", "©", "®", "™", "°"].map(c =>
      buildMatch(0, 0, 1, c),
    );
    assert.ok(
      formatGroupedDiagnosticMessage(matches).startsWith(
        "6 non-ASCII characters: ",
      ),
    );
  });

  test("array contains each char in order", () => {
    const result = formatGroupedDiagnosticMessage([
      buildMatch(0, 0, 1, "·"),
      buildMatch(0, 0, 1, "©"),
      buildMatch(0, 0, 1, "®"),
    ]);
    assert.strictEqual(result, "3 non-ASCII characters: ['·', '©', '®']");
  });

  test("single match with non-default format and case", () => {
    const m = { ...buildMatch(0, 0, 1, "·"), unicodeName: "MIDDLE DOT" };
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
    assert.ok(result[0].match("unicode-names.ts"));
  });

  test("double-star glob matches path containing segment", () => {
    const result = compileIgnoredPaths(["**/node_modules/**"]);
    assert.ok(result[0].match("/home/user/project/node_modules/pkg/index.js"));
  });

  test("returns empty array for empty input", () => {
    assert.deepStrictEqual(compileIgnoredPaths([]), []);
  });

  test("anchors to end of path (regression for trailing-suffix bug)", () => {
    const result = compileIgnoredPaths(["**/*.min.js"]);
    assert.ok(result[0].match("dist/foo.min.js"));
    assert.ok(!result[0].match("dist/foo.min.js.bak"));
  });

  test("supports brace expansion", () => {
    const result = compileIgnoredPaths(["{dist,build}/**"]);
    assert.ok(result[0].match("dist/foo.js"));
    assert.ok(result[0].match("build/bar.js"));
    assert.ok(!result[0].match("src/baz.js"));
  });

  test("matches paths inside dot-prefixed directories", () => {
    const result = compileIgnoredPaths(["**/*.log"]);
    assert.ok(result[0].match(".cache/foo.log"));
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
      isIgnoredDocument(
        makeDoc("/foo/bar.ts"),
        compileIgnoredPaths(["**/bar.ts"]),
      ),
      true,
    );
  });

  test("returns false when no pattern matches", () => {
    assert.strictEqual(
      isIgnoredDocument(
        makeDoc("/foo/bar.ts"),
        compileIgnoredPaths(["**/baz.ts"]),
      ),
      false,
    );
  });

  test("normalizes backslashes to forward slashes before matching", () => {
    assert.strictEqual(
      isIgnoredDocument(
        makeDoc("C:\\foo\\bar.ts"),
        compileIgnoredPaths(["**/foo/bar.ts"]),
      ),
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
    const matches = [buildMatch(1, 0), buildMatch(2, 0)];
    const getCachedMatches = vi.fn().mockReturnValue(matches);
    mockEditor.selection = { active: new vscode.Position(0, 5) };
    await goToNextNonAsciiCharacter(getCachedMatches);
    assert.ok(mockEditor.selection instanceof vscode.Selection);
    const sel1 = mockEditor.selection as InstanceType<typeof vscode.Selection>;
    assert.strictEqual(sel1.anchor.line, 1);
    assert.strictEqual(sel1.anchor.character, 0);
  });

  test("selects the next match after the cursor", async () => {
    const matches = [buildMatch(1, 0), buildMatch(3, 0), buildMatch(5, 0)];
    const getCachedMatches = vi.fn().mockReturnValue(matches);
    mockEditor.selection = { active: new vscode.Position(2, 0) };
    await goToNextNonAsciiCharacter(getCachedMatches);
    assert.ok(mockEditor.selection instanceof vscode.Selection);
    const sel2 = mockEditor.selection as InstanceType<typeof vscode.Selection>;
    assert.strictEqual(sel2.anchor.line, 3);
  });

  test("wraps to first match when cursor is at or after the last match", async () => {
    const matches = [buildMatch(1, 0), buildMatch(3, 0)];
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

  test("returns empty when text exceeds maxFileSizeBytes", () => {
    const doc = mockDocument("hello \u2019 world");
    const matches = findNonAsciiCharacters(
      doc,
      new Set(),
      true,
      true,
      "plaintext",
      5,
    );
    assert.strictEqual(matches.length, 0);
  });

  test("scans normally when text is within maxFileSizeBytes", () => {
    const doc = mockDocument("hello \u2019 world");
    const matches = findNonAsciiCharacters(
      doc,
      new Set(),
      true,
      true,
      "plaintext",
      1024,
    );
    assert.strictEqual(matches.length, 1);
  });

  test("treats POSITIVE_INFINITY maxFileSizeBytes as unlimited", () => {
    const doc = mockDocument("hello \u2019 world");
    const matches = findNonAsciiCharacters(
      doc,
      new Set(),
      true,
      true,
      "plaintext",
      Number.POSITIVE_INFINITY,
    );
    assert.strictEqual(matches.length, 1);
  });
});

// ---------------------------------------------------------------------------
// findMatchAtPosition
// ---------------------------------------------------------------------------

function buildMatch(
  line: number,
  col: number,
  length = 1,
  char = "·",
): NonAsciiMatch {
  const codePoint = char.codePointAt(0)!;
  return {
    char,
    codePoint,
    hex: codePoint.toString(16).padStart(4, "0"),
    unicodeName: undefined,
    range: new vscode.Range(
      new vscode.Position(line, col),
      new vscode.Position(line, col + length),
    ),
  } as unknown as NonAsciiMatch;
}

describe("findMatchAtPosition", () => {
  const matches = [
    buildMatch(0, 5),
    buildMatch(1, 2),
    buildMatch(1, 8),
    buildMatch(3, 0),
  ];

  test("returns undefined for empty matches", () => {
    assert.strictEqual(
      findMatchAtPosition([], new vscode.Position(0, 0)),
      undefined,
    );
  });

  test("returns the match when position is at its start", () => {
    const m = findMatchAtPosition(matches, new vscode.Position(1, 2));
    assert.strictEqual(m, matches[1]);
  });

  test("returns the match when position is at its end (inclusive)", () => {
    const m = findMatchAtPosition(matches, new vscode.Position(1, 3));
    assert.strictEqual(m, matches[1]);
  });

  test("returns undefined when position is between matches on same line", () => {
    const m = findMatchAtPosition(matches, new vscode.Position(1, 5));
    assert.strictEqual(m, undefined);
  });

  test("returns undefined when position is on an unrelated line", () => {
    const m = findMatchAtPosition(matches, new vscode.Position(2, 0));
    assert.strictEqual(m, undefined);
  });

  test("returns undefined when position is before all matches", () => {
    const m = findMatchAtPosition(matches, new vscode.Position(0, 0));
    assert.strictEqual(m, undefined);
  });

  test("returns undefined when position is after all matches", () => {
    const m = findMatchAtPosition(matches, new vscode.Position(99, 0));
    assert.strictEqual(m, undefined);
  });
});

// ---------------------------------------------------------------------------
// findNextMatchAfter
// ---------------------------------------------------------------------------

describe("findNextMatchAfter", () => {
  const matches = [
    buildMatch(0, 5),
    buildMatch(1, 2),
    buildMatch(1, 8),
    buildMatch(3, 0),
  ];

  test("returns undefined for empty matches", () => {
    assert.strictEqual(
      findNextMatchAfter([], new vscode.Position(0, 0)),
      undefined,
    );
  });

  test("returns first match when cursor is before all", () => {
    const m = findNextMatchAfter(matches, new vscode.Position(0, 0));
    assert.strictEqual(m, matches[0]);
  });

  test("returns next match when cursor is on a match start", () => {
    const m = findNextMatchAfter(matches, new vscode.Position(1, 2));
    assert.strictEqual(m, matches[2]);
  });

  test("returns next match when cursor is mid-line between matches", () => {
    const m = findNextMatchAfter(matches, new vscode.Position(1, 5));
    assert.strictEqual(m, matches[2]);
  });

  test("returns undefined when cursor is past every match", () => {
    const m = findNextMatchAfter(matches, new vscode.Position(99, 0));
    assert.strictEqual(m, undefined);
  });
});

// ---------------------------------------------------------------------------
// countLineBreaks
// ---------------------------------------------------------------------------

describe("countLineBreaks", () => {
  test("returns 0 for empty string", () => {
    assert.strictEqual(countLineBreaks(""), 0);
  });

  test("returns 0 for text with no line break", () => {
    assert.strictEqual(countLineBreaks("hello world"), 0);
  });

  test("counts a single LF", () => {
    assert.strictEqual(countLineBreaks("foo\nbar"), 1);
  });

  test("counts multiple LFs", () => {
    assert.strictEqual(countLineBreaks("a\nb\nc\n"), 3);
  });

  test("treats CRLF as a single line break", () => {
    assert.strictEqual(countLineBreaks("foo\r\nbar"), 1);
  });

  test("counts lone CR as a line break", () => {
    assert.strictEqual(countLineBreaks("foo\rbar"), 1);
  });

  test("counts a mix of CR, LF, and CRLF correctly", () => {
    assert.strictEqual(countLineBreaks("a\nb\r\nc\rd"), 3);
  });
});

// ---------------------------------------------------------------------------
// Incremental rescan: shared harness
// ---------------------------------------------------------------------------

function offsetOf(lines: string[], line: number, char: number): number {
  let off = 0;
  for (let l = 0; l < line; l++) off += lines[l].length + 1;
  return off + char;
}

function richMockDocument(text: string): vscode.TextDocument {
  const lines = text.split("\n");
  return {
    getText: (range?: vscode.Range) => {
      if (!range) return text;
      const s = offsetOf(lines, range.start.line, range.start.character);
      const e = offsetOf(lines, range.end.line, range.end.character);
      return text.slice(s, e);
    },
    lineCount: lines.length,
    lineAt: (n: number) => ({
      range: new vscode.Range(
        new vscode.Position(n, 0),
        new vscode.Position(n, lines[n]?.length ?? 0),
      ),
    }),
    languageId: "plaintext",
  } as unknown as vscode.TextDocument;
}

function applyChangeToText(
  text: string,
  change: {
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    text: string;
  },
): string {
  const lines = text.split("\n");
  const s = offsetOf(
    lines,
    change.range.start.line,
    change.range.start.character,
  );
  const e = offsetOf(lines, change.range.end.line, change.range.end.character);
  return text.slice(0, s) + change.text + text.slice(e);
}

function matchesEqual(a: NonAsciiMatch[], b: NonAsciiMatch[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.char !== y.char ||
      x.codePoint !== y.codePoint ||
      x.range.start.line !== y.range.start.line ||
      x.range.start.character !== y.range.start.character ||
      x.range.end.line !== y.range.end.line ||
      x.range.end.character !== y.range.end.character
    ) {
      return false;
    }
  }
  return true;
}

function describeMatch(m: NonAsciiMatch): string {
  return `${m.char}@(${m.range.start.line},${m.range.start.character})`;
}

// ---------------------------------------------------------------------------
// findNonAsciiCharactersInLineRange
// ---------------------------------------------------------------------------

describe("findNonAsciiCharactersInLineRange", () => {
  test("returns matches with correct line numbers from sub-range", () => {
    const doc = richMockDocument("a\nb\u00e9c\nd\u00f1e\nf");
    const matches = findNonAsciiCharactersInLineRange(doc, 1, 2, new Set());
    assert.strictEqual(matches.length, 2);
    assert.strictEqual(matches[0].char, "\u00e9");
    assert.strictEqual(matches[0].range.start.line, 1);
    assert.strictEqual(matches[1].char, "\u00f1");
    assert.strictEqual(matches[1].range.start.line, 2);
  });

  test("returns empty for range with no non-ASCII", () => {
    const doc = richMockDocument("a\nb\u00e9c\nd\u00f1e\nf");
    const matches = findNonAsciiCharactersInLineRange(doc, 0, 0, new Set());
    assert.strictEqual(matches.length, 0);
  });

  test("clamps endLine to document bounds", () => {
    const doc = richMockDocument("\u00e9");
    const matches = findNonAsciiCharactersInLineRange(doc, 0, 99, new Set());
    assert.strictEqual(matches.length, 1);
  });

  test("returns empty when startLine is past document end", () => {
    const doc = richMockDocument("hello");
    const matches = findNonAsciiCharactersInLineRange(doc, 5, 5, new Set());
    assert.strictEqual(matches.length, 0);
  });
});

// ---------------------------------------------------------------------------
// applyIncrementalChange: targeted cases
// ---------------------------------------------------------------------------

describe("applyIncrementalChange", () => {
  function fullScan(text: string): NonAsciiMatch[] {
    return findNonAsciiCharacters(richMockDocument(text), new Set());
  }

  const cases: Array<{
    name: string;
    initial: string;
    change: {
      range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
      };
      text: string;
    };
  }> = [
    {
      name: "insert ASCII in middle of single line",
      initial: "hello \u00e9 world",
      change: {
        range: {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 6 },
        },
        text: "X",
      },
    },
    {
      name: "insert non-ASCII in middle of single line",
      initial: "hello world",
      change: {
        range: {
          start: { line: 0, character: 5 },
          end: { line: 0, character: 5 },
        },
        text: "\u00e9",
      },
    },
    {
      name: "delete non-ASCII character",
      initial: "a\u00e9b",
      change: {
        range: {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 2 },
        },
        text: "",
      },
    },
    {
      name: "insert newline splitting a line",
      initial: "abc\u00e9def\u00f1",
      change: {
        range: {
          start: { line: 0, character: 4 },
          end: { line: 0, character: 4 },
        },
        text: "\n",
      },
    },
    {
      name: "delete newline joining two lines",
      initial: "abc\u00e9\ndef\u00f1",
      change: {
        range: {
          start: { line: 0, character: 4 },
          end: { line: 1, character: 0 },
        },
        text: "",
      },
    },
    {
      name: "insert multi-line text",
      initial: "before\nafter",
      change: {
        range: {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 6 },
        },
        text: "\n\u00e9\n\u00f1\n",
      },
    },
    {
      name: "replace block across multiple lines",
      initial: "a\u00e9\nb\u00f1\nc\u00fc\nd",
      change: {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 2, character: 1 },
        },
        text: "X\u00ffY",
      },
    },
    {
      name: "insert non-ASCII at start of document",
      initial: "rest of doc\n\u00e9here",
      change: {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        text: "\u00f1\n",
      },
    },
    {
      name: "append at end of last line",
      initial: "a\nb\u00e9",
      change: {
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 2 },
        },
        text: "\u00f1",
      },
    },
    {
      name: "delete entire last line",
      initial: "a\u00e9\nb\u00f1",
      change: {
        range: {
          start: { line: 0, character: 2 },
          end: { line: 1, character: 2 },
        },
        text: "",
      },
    },
    {
      name: "insert emoji (surrogate pair)",
      initial: "hello",
      change: {
        range: {
          start: { line: 0, character: 5 },
          end: { line: 0, character: 5 },
        },
        text: "\u{1F600}",
      },
    },
  ];

  for (const c of cases) {
    test(c.name, () => {
      const newText = applyChangeToText(c.initial, c.change);
      const initialMatches = fullScan(c.initial);
      const expected = fullScan(newText);
      const incremental = applyIncrementalChange(
        initialMatches,
        richMockDocument(newText),
        c.change,
        new Set(),
      );
      assert.ok(
        matchesEqual(incremental, expected),
        `incremental != full\n  expected: ${expected.map(describeMatch).join(", ")}\n  got:      ${incremental.map(describeMatch).join(", ")}`,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Property test: random edit sequences match full rescan
// ---------------------------------------------------------------------------

function makeRng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    // xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function randomChange(
  rng: () => number,
  text: string,
): {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  text: string;
} {
  const lines = text.split("\n");
  const pickPos = (): { line: number; character: number } => {
    const line = Math.floor(rng() * lines.length);
    const len = lines[line]?.length ?? 0;
    const character = Math.floor(rng() * (len + 1));
    return { line, character };
  };
  const start = pickPos();
  // End position must not be before start
  let end = pickPos();
  if (
    end.line < start.line ||
    (end.line === start.line && end.character < start.character)
  ) {
    end = { line: start.line, character: start.character };
  }
  // Random replacement text drawn from a small palette
  const palette = [
    "",
    "a",
    "x",
    "\n",
    "ab",
    "\u00e9",
    "\u00f1",
    "abc\n\u00e9",
    "\u{1F600}",
    "\u00e9\u00f1\u00fc\u00ff",
    "line1\nline2\n",
  ];
  const replacement = palette[Math.floor(rng() * palette.length)];
  return { range: { start, end }, text: replacement };
}

describe("incremental rescan property test", () => {
  test("incremental result equals full rescan over 200 random edits (seed 1)", () => {
    runPropertyTest(1, 200);
  });

  test("incremental result equals full rescan over 200 random edits (seed 42)", () => {
    runPropertyTest(42, 200);
  });

  test("incremental result equals full rescan over 200 random edits (seed 9999)", () => {
    runPropertyTest(9999, 200);
  });

  function runPropertyTest(seed: number, iterations: number): void {
    const rng = makeRng(seed);
    let text =
      "Initial document.\n" +
      "It has a few non-ASCII chars: \u00e9 \u00f1 \u00fc.\n" +
      "And one surrogate pair: \u{1F600}.\n" +
      "Plus an em-dash: \u2014.\n" +
      "Last line.";
    let matches = findNonAsciiCharacters(richMockDocument(text), new Set());

    for (let step = 0; step < iterations; step++) {
      const change = randomChange(rng, text);
      const newText = applyChangeToText(text, change);
      const incremental = applyIncrementalChange(
        matches,
        richMockDocument(newText),
        change,
        new Set(),
      );
      const expected = findNonAsciiCharacters(
        richMockDocument(newText),
        new Set(),
      );
      assert.ok(
        matchesEqual(incremental, expected),
        `step ${step} (seed ${seed}): incremental != full\n  text: ${JSON.stringify(text)}\n  change: ${JSON.stringify(change)}\n  newText: ${JSON.stringify(newText)}\n  expected: ${expected.map(describeMatch).join(", ")}\n  got:      ${incremental.map(describeMatch).join(", ")}`,
      );
      text = newText;
      matches = incremental;
    }
  }
});

// ---------------------------------------------------------------------------
// addToAllowedCharacters -- written entry must respect codePointFormat/Case
// ---------------------------------------------------------------------------

describe("addToAllowedCharacters", () => {
  // U+00A9 COPYRIGHT SIGN constructed at runtime to avoid triggering the
  // extension's scan on this source file.
  const COPYRIGHT = String.fromCodePoint(0xa9);
  let mockUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockUpdate = vi.fn().mockResolvedValue(undefined);
    const mockCfg = {
      get: vi.fn((_key: string, defaultValue: unknown) => defaultValue),
      inspect: vi.fn(() => ({ workspaceValue: undefined, globalValue: [] })),
      update: mockUpdate,
    };
    Object.assign(vscode.workspace, {
      getConfiguration: vi.fn().mockReturnValue(mockCfg),
    });
    const mockEditor = {
      document: {
        uri: { toString: () => "file:///test.ts", fsPath: "/test.ts" },
        getText: (_range?: unknown) => COPYRIGHT,
      },
      selections: [
        {
          isEmpty: false,
          anchor: new vscode.Position(0, 0),
          active: new vscode.Position(0, 1),
        },
      ],
    };
    (vscode.window as { activeTextEditor: unknown }).activeTextEditor =
      mockEditor;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (vscode.window as { activeTextEditor: unknown }).activeTextEditor =
      undefined;
  });

  test("writes entry using codePointFormat=0x and codePointCase=upper", async () => {
    vi.spyOn(configModule, "getConfig").mockReturnValue({
      enable: true,
      allowedCharacters: new Set<string>(),
      codePointFormat: "0x",
      codePointCase: "upper",
    } as unknown as ExtensionConfig);
    await addToAllowedCharacters();
    const writtenEntries = mockUpdate.mock.calls[0]?.[1] as
      | string[]
      | undefined;
    assert.ok(
      writtenEntries !== undefined,
      "cfg.update should have been called",
    );
    assert.ok(
      writtenEntries.includes("0x00A9"),
      `expected "0x00A9" in ${JSON.stringify(writtenEntries)}`,
    );
  });

  test("writes entry using codePointFormat=u+ and codePointCase=upper", async () => {
    vi.spyOn(configModule, "getConfig").mockReturnValue({
      enable: true,
      allowedCharacters: new Set<string>(),
      codePointFormat: "u+",
      codePointCase: "upper",
    } as unknown as ExtensionConfig);
    await addToAllowedCharacters();
    const writtenEntries = mockUpdate.mock.calls[0]?.[1] as
      | string[]
      | undefined;
    assert.ok(
      writtenEntries !== undefined,
      "cfg.update should have been called",
    );
    assert.ok(
      writtenEntries.includes("U+00A9"),
      `expected "U+00A9" in ${JSON.stringify(writtenEntries)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// invalidateConfig -- per-URI eviction
// ---------------------------------------------------------------------------

describe("invalidateConfig", () => {
  beforeEach(() => {
    const mockCfgObj = {
      get: vi.fn((_key: string, defaultValue: unknown) => defaultValue),
      inspect: vi.fn(() => undefined),
    };
    Object.assign(vscode.workspace, {
      getConfiguration: vi.fn().mockReturnValue(mockCfgObj),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    configModule.invalidateConfigCache();
  });

  test("evicts URI-specific entry so next getConfig re-reads", () => {
    const fakeUri = {
      toString: () => "file:///unique-test-uri.ts",
    } as vscode.Uri;
    const getConfigurationSpy = (
      vscode.workspace as unknown as {
        getConfiguration: ReturnType<typeof vi.fn>;
      }
    ).getConfiguration;

    configModule.getConfig(fakeUri);
    assert.strictEqual(
      getConfigurationSpy.mock.calls.length,
      1,
      "first call should read config",
    );
    configModule.getConfig(fakeUri);
    assert.strictEqual(
      getConfigurationSpy.mock.calls.length,
      1,
      "second call should be a cache hit",
    );
    configModule.invalidateConfig(fakeUri);
    configModule.getConfig(fakeUri);
    assert.strictEqual(
      getConfigurationSpy.mock.calls.length,
      2,
      "after invalidation, getConfig should re-read",
    );
  });
});

// ---------------------------------------------------------------------------
// handleError -- duplicate notification throttling
// ---------------------------------------------------------------------------

describe("handleError", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (vscode.window.showErrorMessage as ReturnType<typeof vi.fn>).mockClear();
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  test("shows error message on first call", () => {
    handleError("ctx", new Error("something broke"));
    assert.strictEqual(
      (vscode.window.showErrorMessage as ReturnType<typeof vi.fn>).mock.calls
        .length,
      1,
    );
  });

  test("suppresses duplicate message within throttle window", () => {
    handleError("ctx", new Error("same error"));
    handleError("ctx", new Error("same error"));
    assert.strictEqual(
      (vscode.window.showErrorMessage as ReturnType<typeof vi.fn>).mock.calls
        .length,
      1,
    );
  });

  test("shows again after throttle window expires", () => {
    handleError("ctx", new Error("same error"));
    vi.advanceTimersByTime(11_000);
    handleError("ctx", new Error("same error"));
    assert.strictEqual(
      (vscode.window.showErrorMessage as ReturnType<typeof vi.fn>).mock.calls
        .length,
      2,
    );
  });

  test("shows different message immediately even within throttle window", () => {
    handleError("ctx", new Error("error A"));
    handleError("ctx", new Error("error B"));
    assert.strictEqual(
      (vscode.window.showErrorMessage as ReturnType<typeof vi.fn>).mock.calls
        .length,
      2,
    );
  });
});

// ---------------------------------------------------------------------------
// buildLineDiagnostics
// ---------------------------------------------------------------------------

function makeMatch(
  char: string,
  line: number,
  character: number,
): NonAsciiMatch {
  const pos = new vscode.Position(line, character);
  return {
    char,
    codePoint: char.codePointAt(0)!,
    hex: char.codePointAt(0)!.toString(16).padStart(4, "0"),
    unicodeName: undefined,
    range: new vscode.Range(pos, new vscode.Position(line, character + 1)),
  };
}

function makeConfig(
  severities: Set<number>,
  overrides: [string, number][] = [],
): ExtensionConfig {
  return {
    enable: true,
    decoration: {},
    allowedCharacters: new Set(),
    allowedCharactersKey: "",
    autoReplaceOnSave: false,
    replacements: [],
    severityOverrides: new Map(overrides),
    includeStrings: true,
    includeComments: true,
    codePointFormat: "u+",
    codePointCase: "upper",
    ignoredPaths: [],
    diagnosticSeverities: severities,
    maxFileSizeBytes: Infinity,
    isLimited: false,
  };
}

describe("buildLineDiagnostics", () => {
  // U+2014 EM DASH is in ERROR_LEVEL_CODEPOINTS -> Error severity
  // U+00E9 e-with-acute is NOT -> Information severity
  const emDash = String.fromCodePoint(0x2014);
  const eAcute = String.fromCodePoint(0x00e9);

  test("keeps enabled Info diagnostic when Error is disabled (regression for grouping bug)", () => {
    // Old bug: both chars on same line, worst=Error, diagnosticSeverities={Info} -> drops everything.
    // New behaviour: filter first, group survivors -> one Info diagnostic for eAcute remains.
    const matches = [makeMatch(emDash, 0, 0), makeMatch(eAcute, 0, 2)];
    const config = makeConfig(new Set([vscode.DiagnosticSeverity.Information]));
    const diags = buildLineDiagnostics(matches, config);
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(
      diags[0].severity,
      vscode.DiagnosticSeverity.Information,
    );
  });

  test("keeps Error diagnostic when only Error is enabled", () => {
    const matches = [makeMatch(emDash, 0, 0), makeMatch(eAcute, 0, 2)];
    const config = makeConfig(new Set([vscode.DiagnosticSeverity.Error]));
    const diags = buildLineDiagnostics(matches, config);
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(diags[0].severity, vscode.DiagnosticSeverity.Error);
  });

  test("produces no diagnostic when the only char's severity is disabled", () => {
    const matches = [makeMatch(emDash, 0, 0)];
    const config = makeConfig(new Set([vscode.DiagnosticSeverity.Information]));
    const diags = buildLineDiagnostics(matches, config);
    assert.strictEqual(diags.length, 0);
  });

  test("two enabled matches on the same line -> single grouped diagnostic with worst severity", () => {
    const matches = [makeMatch(eAcute, 0, 0), makeMatch(eAcute, 0, 3)];
    const config = makeConfig(
      new Set([
        vscode.DiagnosticSeverity.Information,
        vscode.DiagnosticSeverity.Error,
      ]),
    );
    const diags = buildLineDiagnostics(matches, config);
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(
      diags[0].severity,
      vscode.DiagnosticSeverity.Information,
    );
    assert.ok(diags[0].message.includes("2 non-ASCII"), diags[0].message);
  });

  test("matches on different lines -> one diagnostic per line", () => {
    const matches = [makeMatch(emDash, 0, 0), makeMatch(eAcute, 1, 0)];
    const config = makeConfig(
      new Set([
        vscode.DiagnosticSeverity.Error,
        vscode.DiagnosticSeverity.Information,
      ]),
    );
    const diags = buildLineDiagnostics(matches, config);
    assert.strictEqual(diags.length, 2);
  });

  test("diagnostic source is 'Character Witness'", () => {
    const matches = [makeMatch(eAcute, 0, 0)];
    const config = makeConfig(new Set([vscode.DiagnosticSeverity.Information]));
    const diags = buildLineDiagnostics(matches, config);
    assert.strictEqual(diags[0].source, "Character Witness");
  });

  test("empty matches -> no diagnostics", () => {
    const config = makeConfig(
      new Set([
        vscode.DiagnosticSeverity.Error,
        vscode.DiagnosticSeverity.Information,
      ]),
    );
    const diags = buildLineDiagnostics([], config);
    assert.strictEqual(diags.length, 0);
  });
});

// ---------------------------------------------------------------------------
// parseNameTable
// ---------------------------------------------------------------------------

describe("parseNameTable", () => {
  test("parses well-formed multi-line input", () => {
    const txt = "00E9 LATIN SMALL LETTER E WITH ACUTE\n2014 EM DASH\n";
    const map = parseNameTable(txt);
    assert.strictEqual(map.get(0x00e9), "LATIN SMALL LETTER E WITH ACUTE");
    assert.strictEqual(map.get(0x2014), "EM DASH");
    assert.strictEqual(map.size, 2);
  });

  test("parses a trailing line without a trailing newline", () => {
    const txt = "00E9 LATIN SMALL LETTER E WITH ACUTE";
    const map = parseNameTable(txt);
    assert.strictEqual(map.get(0x00e9), "LATIN SMALL LETTER E WITH ACUTE");
  });

  test("stops cleanly on a malformed line with no space -- no NaN key", () => {
    const txt = "00E9 LATIN SMALL LETTER E WITH ACUTE\nBADLINE\n";
    const map = parseNameTable(txt);
    assert.strictEqual(map.get(0x00e9), "LATIN SMALL LETTER E WITH ACUTE");
    for (const key of map.keys()) {
      assert.ok(!Number.isNaN(key), `NaN key found in map`);
    }
  });

  test("hex parsing is case-insensitive for the code point field", () => {
    const txt = "2014 EM DASH\n";
    const map = parseNameTable(txt);
    assert.strictEqual(map.get(0x2014), "EM DASH");
  });
});

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
import { compileIgnoredPaths, ExtensionConfig } from "../config";
import * as configModule from "../config";
import { isIgnoredDocument } from "../extension";
import { getCharacterName, UNICODE_VERSION } from "../generated/unicode-names";
import { formatGroupedDiagnosticMessage, NonAsciiMatch } from "../scanner";
import {
  formatCodePoint,
  parseCharacterEntries,
  parseCharacterEntry,
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

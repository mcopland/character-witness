# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**Character Witness** is a VS Code extension that detects, highlights, and optionally auto-replaces non-ASCII characters (code point > 127) in editor documents. It identifies each character by its official Unicode name (Unicode 16.0.0).

## Commands

```bash
npm install          # Install dependencies
npm run compile      # Compile TypeScript (src/ -> out/)
npm run watch        # Watch mode compilation
npm run generate     # Regenerate resources/unicode-names.txt from @unicode/unicode-16.0.0
npm run test:unit    # Run unit tests (no VS Code required)
npm run package      # Build .vsix (runs generate + compile via vscode:prepublish)
```

**Integration and performance tests** require VS Code: press F5 with the "Extension Tests" or "Performance Tests" launch configuration selected in `.vscode/launch.json`.

To run a single unit test suite, compile first then: `npx mocha out/test/unit.test.js --ui tdd --grep "suite name"`

## Architecture

The extension activates on `onStartupFinished` and wires up VS Code events in `extension.ts`. The scan pipeline is:

1. **`extension.ts`**: Entry point. Manages module-level state: a `scanCache` (keyed by document URI + version + config fingerprint) and a 250ms debounce timer. Wires: `onDidChangeActiveTextEditor`, `onDidChangeTextDocument` (debounced), `onDidChangeConfiguration` (invalidates config + scan caches), `onWillSaveTextDocument` (triggers auto-replace), `onDidCloseTextDocument` (cleanup).

2. **`scanner.ts`**: Core scanning. `findNonAsciiCharacters` walks the document text using the string iterator (handles surrogate pairs for supplementary code points). When `includeStrings`/`includeComments` filters are active, it delegates to `regions.ts` and does a binary search to skip offsets in filtered regions. Exports `NonAsciiMatch` (the core data type: char, codePoint, hex, unicodeName, range).

3. **`regions.ts`**: Regex-based string/comment region detection, language-aware. Supports ~15 language families. Returns sorted `TextRegion[]` (start/end offsets + type) that the scanner binary-searches against.

4. **`config.ts`**: Reads and caches `vscode.workspace.getConfiguration("characterWitness")`. Exposes `getConfig()` (cached), `invalidateConfigCache()`, and `getCharacterSeverity()`. Severity resolution: user `severityOverrides` -> `ERROR_LEVEL_CODEPOINTS` (hardcoded set in `scanner.ts`) -> `Information`.

5. **`decoration.ts`**: Manages a single `vscode.TextEditorDecorationType`. Fingerprints the current style config; recreates the decoration type only when the style changes.

6. **`autoreplace.ts`**: Called from `onWillSaveTextDocument`. Reads cached matches, filters to those in `config.replacements`, builds `vscode.TextEdit[]`.

7. **`commands.ts`**: Implements `characterWitness.addToAllowedCharacters`. Reads cursor position or selection to find non-ASCII chars, then writes to workspace settings.

8. **`generated/unicode-names.ts`**: **Hand-written** (not generated). Exports `getCharacterName(codePoint)`. Lookup order: correction aliases -> control aliases -> Hangul algorithmic decomposition -> algorithmic ranges (CJK, Tangut, etc.) -> packed name table (lazy-loaded from `resources/unicode-names.txt` via `fs.readFileSync`).

## Build Pipeline Details

- `npm run generate` writes `resources/unicode-names.txt` (~38k `HHHH NAME` entries) from `@unicode/unicode-16.0.0`. This file is committed and packaged in the VSIX.
- `src/generated/unicode-names.ts` is **hand-written** and must be updated manually when bumping the Unicode version (it contains the algorithmic ranges, Hangul tables, aliases, and the lazy-load logic for `unicode-names.txt`).
- TypeScript compiles to `out/` (ES2022, CommonJS, strict mode). The VSIX entry point is `./out/extension.js`.

## Key Conventions

- All character settings (allowed list, replacement map, severity overrides) use `u+hhhh` notation (parsed by `parseCharacterEntry` in `utils.ts`). Literal characters are rejected to prevent the settings file from being flagged by the extension itself.
- Diagnostics are grouped per-line: one `vscode.Diagnostic` per line, spanning the first-to-last match on that line, with worst severity in the group.
- The scan cache entry is invalidated when document version or config fingerprint changes (fingerprint = sorted allowed chars + includeStrings + includeComments + languageId).

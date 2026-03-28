# Character Witness

A Visual Studio Code extension that detects, highlights, and optionally auto-replaces non-ASCII characters (code point > 127) in your files. Every detected character is identified by its official Unicode name using a build-time-generated Unicode Character Database (version 16.0.0).

## Why

Non-ASCII characters silently break builds, cause encoding issues, and create hard-to-spot bugs. A stray em dash pasted from a word processor or a curly quote from a chat message can waste hours of debugging. Character Witness makes these invisible problems visible at a glance.

## Features

### Visual Highlighting

Non-ASCII characters are highlighted with a fully customizable decoration style. The default is a semi-transparent red background with a red border and crosshair cursor, but every visual property (colors, borders, font, cursor, opacity, and more) is configurable. Color properties show VS Code's native color picker in Settings.

### Problems Panel Diagnostics

Every detected character is published as a diagnostic with its official Unicode name. The severity level (Error, Warning, or Info) is configurable per character. Diagnostics update live as you type (debounced at 250ms) and are cleaned up automatically when documents close.

### Hover Tooltips

Hovering over a highlighted character shows a tooltip with its Unicode name and code point.

### Context Menu: Add to Allowed Characters

Right-click on any highlighted character and select **Character Witness: Add to Allowed Characters** to add it to your allowed list. Works with both cursor position and text selection (all non-ASCII characters in the selection are offered). The character is added as a `U+HHHH` entry to your settings.

### Auto-Replace on Save

When enabled, characters found in the replacement map are automatically substituted with ASCII equivalents before the file is written to disk. Characters not in the map are left untouched.

### Overview Ruler Markers

Detected characters are marked in the editor's minimap scrollbar, making it easy to spot occurrences in long files.

### Pure-ASCII Settings

All character settings use `U+HHHH` notation. This prevents the settings file itself from being flagged or corrupted when auto-replace is enabled.

## Settings

All settings are under the `characterWitness.*` namespace.

### `characterWitness.enable`

**Type:** `boolean` | **Default:** `true`

Master toggle. Set to `false` to disable all highlighting, diagnostics, and auto-replace behavior.

### `characterWitness.decoration`

**Type:** `object`

Fully customizable visual style for highlighted characters. Color properties (`backgroundColor`, `color`, `borderColor`, `overviewRulerColor`) show VS Code's native color picker in the Settings UI.

| Property             | Type   | Default               | Description                                                      |
| -------------------- | ------ | --------------------- | ---------------------------------------------------------------- |
| `backgroundColor`    | color  | `rgba(255,0,0,0.3)`   | Background fill (hex or rgba)                                    |
| `color`              | color  | `rgba(255,255,255,1)` | Foreground text color                                            |
| `borderWidth`        | string | `1px`                 | Border width                                                     |
| `borderStyle`        | enum   | `solid`               | `solid`, `dashed`, `dotted`, `double`, `none`                    |
| `borderColor`        | color  | `#ff0000`             | Border color                                                     |
| `borderRadius`       | string | `2px`                 | Corner rounding                                                  |
| `cursor`             | enum   | `crosshair`           | `default`, `pointer`, `crosshair`, `help`, `not-allowed`, `text` |
| `fontWeight`         | string | _(empty)_             | e.g. `bold`, `700`                                               |
| `fontStyle`          | enum   | _(empty)_             | `italic`, `normal`                                               |
| `outline`            | string | _(empty)_             | CSS outline shorthand (e.g. `2px dashed blue`)                   |
| `textDecoration`     | string | _(empty)_             | CSS text-decoration (e.g. `underline wavy red`)                  |
| `letterSpacing`      | string | _(empty)_             | e.g. `1px`, `0.5em`                                              |
| `opacity`            | string | _(empty)_             | `0` to `1`                                                       |
| `overviewRulerColor` | color  | `rgba(255,0,0,0.6)`   | Minimap scrollbar indicator color                                |
| `overviewRulerLane`  | enum   | `Center`              | `Left`, `Center`, `Right`, `Full`                                |

### `characterWitness.allowedCharacters`

**Type:** `string[]` | **Default:** `[]`

Characters to exclude from detection. Each entry uses `u+hhhh` notation (4-6 hex digits). Also accepted: `\uHHHH`, `\u{HHHH}`, and `0xHHHH`. Ranges are supported with `u+HHHH - u+HHHH` syntax. All notations are case-insensitive.

```jsonc
"characterWitness.allowedCharacters": [
  "u+00a3",
  "u+00a9",
  "u+2500 - u+257f"
]
```

### `characterWitness.autoReplaceOnSave`

**Type:** `boolean` | **Default:** `false`

When enabled, characters found in the replacement map are automatically substituted before the file is saved. Characters not in the map are left untouched.

### `characterWitness.replacementMap`

**Type:** `object` | **Default:** `{}`

Map of non-ASCII characters to their ASCII replacements. Keys use `u+hhhh` notation. Only characters present in this map are replaced on save; all others are left as-is.

```jsonc
"characterWitness.replacementMap": {
  "u+2013": "-",   // en dash -> hyphen
  "u+2018": "'",   // left single quote -> apostrophe
  "u+2019": "'",   // right single quote -> apostrophe
  "u+201c": "\"",  // left double quote -> straight double quote
  "u+201d": "\""   // right double quote -> straight double quote
}
```

### `characterWitness.severityOverrides`

**Type:** `object` | **Default:** `{}`

Override the diagnostic severity for specific characters. Keys use `u+hhhh` notation, values are `"error"`, `"warning"`, or `"info"`. Characters not listed here use the built-in severity (Error for invisible/control characters, Information for all others).

```jsonc
"characterWitness.severityOverrides": {
  "u+00a0": "info",
  "u+200b": "warning"
}
```

### `characterWitness.includeStrings`

**Type:** `boolean` | **Default:** `true`

Whether to flag non-ASCII characters inside string literals. When `false`, characters within strings are ignored.

### `characterWitness.includeComments`

**Type:** `boolean` | **Default:** `true`

Whether to flag non-ASCII characters inside comments. When `false`, characters within comments are ignored.

### `characterWitness.diagnosticSeverities`

**Type:** `string[]` | **Default:** `["error", "warning", "info"]`

Which severity levels are published to the Problems panel. Remove a level to suppress those diagnostics while keeping decorations. Set to `[]` to disable all diagnostics entirely.

### `characterWitness.codePointFormat`

**Type:** `enum` | **Default:** `"u+"`

Controls how code points are displayed in hover text, diagnostics, and notifications. Also controls the format written to settings when using **Add to Allowed Characters**.

| Value  | Example    | Description                           |
| ------ | ---------- | ------------------------------------- |
| `u+`   | `u+2019`   | Unicode U+ notation (default)         |
| `\u`   | `\u2019`   | JavaScript escape notation (4 digits) |
| `\u{}` | `\u{2019}` | JavaScript ES6 brace notation         |
| `0x`   | `0x2019`   | C-style hex notation                  |

### `characterWitness.codePointCase`

**Type:** `enum` | **Default:** `"upper"`

Whether hex digits (and the `u+` prefix) are displayed in lower or uppercase.

| Value   | Example  |
| ------- | -------- |
| `upper` | `U+25AB` |
| `lower` | `u+25ab` |

### `characterWitness.ignoredPaths`

**Type:** `string[]` | **Default:** `[]`

Glob patterns matched against each file's full path (forward slashes, cross-platform). Files with a matching path are excluded from scanning, decorations, diagnostics, and auto-replace.

```jsonc
"characterWitness.ignoredPaths": [
  "**/node_modules/**",
  "**/*.min.js",
  "{dist,build}/**"
]
```

## Commands

| Command                                      | Title                                             | Available In                         |
| -------------------------------------------- | ------------------------------------------------- | ------------------------------------ |
| `characterWitness.addToAllowedCharacters`    | Character Witness: Add to Allowed Characters      | Editor context menu, Command Palette |
| `characterWitness.applyReplacements`         | Character Witness: Apply Replacements             | Editor context menu, Command Palette |
| `characterWitness.goToNextNonAsciiCharacter` | Character Witness: Go to Next Non-ASCII Character | Editor context menu, Command Palette |

## Building

### Prerequisites

- [Node.js](https://nodejs.org/) 14+
- npm (included with Node.js)

### Install dependencies

```bash
npm install
```

### Generate Unicode data

The extension uses a build-time code generation step that reads the `@unicode/unicode-16.0.0` npm package (derived from `UnicodeData.txt` and `NameAliases.txt`) and produces `resources/unicode-names.txt`: a plain-text file of `HHHH NAME` pairs (~38k entries) that is loaded lazily at runtime.

`src/generated/unicode-names.ts` is hand-written and updated manually when bumping the Unicode version.

```bash
npm run generate
```

### Compile TypeScript

```bash
npm run compile
```

Compiles all TypeScript source in `src/` to JavaScript in `out/` (ES2022 target, CommonJS modules, strict mode).

### Watch mode

```bash
npm run watch
```

## Running Tests

### Unit tests

Unit tests cover the utility functions and Unicode name lookups. They do not require VS Code.

```bash
npm run test:unit
```

### Integration tests

Integration tests exercise the full extension (diagnostics, decorations, configuration) inside the VS Code Extension Development Host. Press **F5** in VS Code with the **"Extension Tests"** launch configuration selected.

### Performance tests

Performance benchmarks run in the Extension Development Host. Press **F5** in VS Code with the **"Performance Tests"** launch configuration selected.

The suite measures scan latency for 10k-line documents (sparse and dense) and verifies cache behavior. No assertions are made automatically. Results are logged to the Debug Console.

## Packaging and Installation

### 1. Install `vsce`

```bash
npm install -g @vscode/vsce
```

### 2. Package the extension

```bash
vsce package
```

This runs the `vscode:prepublish` script (generate + compile), then produces a file like `character-witness-1.0.0.vsix`.

### 3. Install the `.vsix`

**From the command line:**

```bash
code --install-extension character-witness-1.0.0.vsix
```

**From the VS Code UI:**

1. Open the Extensions sidebar (`Ctrl+Shift+X`).
2. Click the `...` menu at the top of the sidebar.
3. Select **Install from VSIX...** and choose the `.vsix` file.

### 4. Reload

Reload the window (`Ctrl+Shift+P` > **Developer: Reload Window**) and the extension will be active.

### Updating

Repeat steps 2 and 3. VS Code will replace the previous version.

### Uninstalling

```bash
code --uninstall-extension character-witness.character-witness
```

Or right-click the extension in the Extensions sidebar and select **Uninstall**.

## Architecture

```
src/
  extension.ts          Activation, event wiring, scan cache, debounced updates
  config.ts             Configuration parsing, decoration render options, defaults
  scanner.ts            Document scanning, surrogate pair handling, diagnostic formatting
  regions.ts            Regex-based string/comment region detection (~15 language families)
  decoration.ts         Decoration type lifecycle (create, fingerprint, dispose)
  autoreplace.ts        Auto-replace on save: builds TextEdit[] from cached matches
  commands.ts           Command implementations (Add to Allowed Characters)
  logger.ts             OutputChannel wrapper with timestamped logging
  utils.ts              Pure utilities: u+hhhh parsing, title-casing, formatting
  generated/
    unicode-names.ts    Unicode name lookup: algorithmic ranges, name aliases, data file
  test/
    unit.test.ts        Unit tests for pure functions (no VS Code API required)
    extension.test.ts   Integration tests (run in Extension Development Host)
    perf.test.ts        Performance benchmarks

scripts/
  generate-unicode-data.ts   Build-time generator for unicode-names.ts
```

### Name resolution order

When looking up a character name, the generated module checks (in order):

1. **Correction aliases** (fixes for officially corrected Unicode names)
2. **Control aliases** (descriptive names for control characters like U+0085 NEXT LINE)
3. **Algorithmic ranges** (prefix + hex for CJK, Tangut, Khitan, Nushu)
4. **Packed name table** (all remaining individually named characters, including Hangul syllables)

## License

MIT

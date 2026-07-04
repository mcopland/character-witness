# Changelog

## [Unreleased]

### Fixed

- Incremental scanning falls back to a full rescan for edit events with multiple content changes (multi-cursor edits on large documents could corrupt match positions until the next full scan)
- Duplicate error notifications are now throttled per message; alternating errors can no longer bypass the 10-second suppression window

### Changed

- Formatting check and a non-blocking `npm audit` added to CI; performance tests are runnable via `npm run test:perf`

## [1.6.0]

### Added

- `maxFileSizeKb` setting — skip scanning and auto-replace for oversized files (default 10240 KB, 0 disables)
- Incremental scanning for documents with 5,000+ lines — only the changed line range is rescanned while typing
- LRU scan-result cache (up to 50 documents)
- Workspace Trust support (limited mode) — auto-replace, the replacement map, and ignored-paths globs are disabled in untrusted workspaces

## [1.5.0]

### Added

- `replacementMap` keys accept ranges (`"u+201c - u+201d"`) and comma-separated lists (`"u+2018, u+2019"`)
- Most settings are language-overridable via `"[languageId]"` configuration blocks

## [1.4.0]

### Added

- `characterWitness.goToNextNonAsciiCharacter` command — navigate to the next non-ASCII character in the active document, wrapping around at end of file

## [1.3.0]

### Added

- `characterWitness.applyReplacements` command — apply configured replacements on demand
- Hover provider for non-ASCII characters — shows Unicode name and code point on hover
- `ignoredPaths` setting — exclude files by glob pattern
- `codePointFormat` and `codePointCase` settings — control how code points are displayed

### Changed

- Scanner uses manual line/column tracking instead of `document.positionAt` calls (performance improvement)

## [1.2.0]

### Added

- `characterWitness.addToAllowedCharacters` command
- `includeStrings` and `includeComments` settings — filter scanning by region type
- `diagnosticSeverities` setting — control which severity levels appear in the Problems panel
- `severityOverrides` setting — override severity for specific characters

## [1.1.0]

### Added

- `autoReplaceOnSave` and `replacementMap` settings

## [1.0.0]

### Added

- Initial release: detect, highlight, and diagnose non-ASCII characters
- Unicode 16.0.0 character name lookup
- `allowedCharacters` and `decoration` settings

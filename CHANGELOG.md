# Changelog

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

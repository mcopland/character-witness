/**
 * Regex-based string/comment region detection per language.
 * Safety: all start/end values are UTF-16 code-unit offsets into the raw
 * text string, the same coordinate space used by document.positionAt().
 */

export interface TextRegion {
  start: number;
  end: number;
  type: "string" | "comment";
}

interface LanguagePatterns {
  regex: RegExp;
  groupTypes: ("string" | "comment")[];
}

/**
 * Build a combined regex for the given language family.
 * Each alternative captures one "token" (string literal or comment).
 * The `groupTypes` array maps each capturing-group index (1-based) to its type.
 */
function buildPatterns(languageId: string): LanguagePatterns {
  switch (languageId) {
    case "javascript":
    case "javascriptreact":
    case "typescript":
    case "typescriptreact":
    case "c":
    case "cpp":
    case "java":
    case "go":
    case "rust":
    case "csharp":
    case "swift":
    case "kotlin":
    case "php":
    case "dart":
    case "css":
    case "scss":
    case "less":
    case "json":
    case "jsonc":
      return {
        // group1: line comment, group2: block comment,
        // group3: template literal, group4: double-quoted string, group5: single-quoted string
        regex:
          /(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)|(`(?:[^`\\]|\\.)*`)|("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')/g,
        groupTypes: ["comment", "comment", "string", "string", "string"],
      };

    case "python":
      return {
        // group1: line comment, group2: triple-double string,
        // group3: triple-single string, group4: double-quoted string, group5: single-quoted string
        regex:
          /(#[^\n]*)|("""[\s\S]*?""")|('''[\s\S]*?''')|("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')/g,
        groupTypes: ["comment", "string", "string", "string", "string"],
      };

    case "ruby":
    case "shellscript":
    case "perl":
    case "r":
    case "coffeescript":
    case "yaml":
      return {
        regex: /(#[^\n]*)|("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')/g,
        groupTypes: ["comment", "string", "string"],
      };

    case "html":
    case "xml":
    case "svg":
    case "vue":
    case "svelte":
      return {
        regex: /(<!--[\s\S]*?-->)|("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')/g,
        groupTypes: ["comment", "string", "string"],
      };

    case "sql":
      return {
        regex: /(--[^\n]*)|(\/\*[\s\S]*?\*\/)|('(?:[^'\\]|\\.)*')/g,
        groupTypes: ["comment", "comment", "string"],
      };

    case "lua":
      return {
        regex:
          /(--\[\[[\s\S]*?\]\])|(--[^\n]*)|("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')/g,
        groupTypes: ["comment", "comment", "string", "string"],
      };

    default:
      return {
        regex: /("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')/g,
        groupTypes: ["string", "string"],
      };
  }
}

export function getTextRegions(text: string, languageId: string): TextRegion[] {
  const { regex, groupTypes } = buildPatterns(languageId);
  const regions: TextRegion[] = [];

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    for (let i = 0; i < groupTypes.length; i++) {
      if (match[i + 1] !== undefined) {
        regions.push({
          start: match.index,
          end: match.index + match[0].length,
          type: groupTypes[i],
        });
        break;
      }
    }
  }

  return regions;
}

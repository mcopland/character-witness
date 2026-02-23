import * as vscode from "vscode";
import { getConfig } from "./config";
import { NonAsciiMatch } from "./scanner";
import { handleError } from "./logger";

export function buildReplacementEdits(
  document: vscode.TextDocument,
  getCachedMatchesFn: (doc: vscode.TextDocument, allowed: Set<string>) => NonAsciiMatch[]
): vscode.TextEdit[] {
  try {
    const config = getConfig();
    if (!config.enable || !config.autoReplaceOnSave) return [];

    const matches = getCachedMatchesFn(document, config.allowedCharacters);
    if (matches.length === 0) return [];

    const repMap = new Map<string, string>();
    for (const entry of config.replacements) {
      repMap.set(entry.from, entry.to);
    }

    const edits: vscode.TextEdit[] = [];
    for (const m of matches) {
      const replacement = repMap.get(m.char);
      if (replacement !== undefined) {
        edits.push(vscode.TextEdit.replace(m.range, replacement));
      }
    }
    return edits;
  } catch (err) {
    handleError("buildReplacementEdits", err);
    return [];
  }
}

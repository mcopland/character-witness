import * as vscode from "vscode";
import { getConfig } from "./config";
import { handleError } from "./logger";
import { NonAsciiMatch } from "./scanner";

type GetCachedMatchesFn = (
  doc: vscode.TextDocument,
  allowed: Set<string>,
  includeStrings: boolean,
  includeComments: boolean,
) => NonAsciiMatch[];

function buildEdits(
  document: vscode.TextDocument,
  getCachedMatchesFn: GetCachedMatchesFn,
): vscode.TextEdit[] {
  const config = getConfig();
  const matches = getCachedMatchesFn(
    document,
    config.allowedCharacters,
    config.includeStrings,
    config.includeComments,
  );
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
}

export function buildReplacementEdits(
  document: vscode.TextDocument,
  getCachedMatchesFn: GetCachedMatchesFn,
): vscode.TextEdit[] {
  try {
    const config = getConfig();
    if (!config.enable || !config.autoReplaceOnSave) return [];
    return buildEdits(document, getCachedMatchesFn);
  } catch (err) {
    handleError("buildReplacementEdits", err);
    return [];
  }
}

export function buildReplacementsOnDemand(
  document: vscode.TextDocument,
  getCachedMatchesFn: GetCachedMatchesFn,
): vscode.TextEdit[] {
  try {
    const config = getConfig();
    if (!config.enable) return [];
    return buildEdits(document, getCachedMatchesFn);
  } catch (err) {
    handleError("buildReplacementsOnDemand", err);
    return [];
  }
}

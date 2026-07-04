import * as vscode from "vscode";
import { buildReplacementsOnDemand, GetCachedMatchesFn } from "./autoreplace";
import { getConfig } from "./config";
import { handleError } from "./logger";
import { findNextMatchAfter, NonAsciiMatch } from "./scanner";
import { formatCodePoint, parseCharacterEntry, toHex } from "./utils";

export async function goToNextNonAsciiCharacter(
  getCachedMatchesFn: GetCachedMatchesFn,
): Promise<void> {
  try {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const config = getConfig(editor.document.uri);
    if (!config.enable) return;

    const matches = getCachedMatchesFn(editor.document, config);
    if (matches.length === 0) {
      vscode.window.showInformationMessage(
        "Character Witness: No non-ASCII characters found.",
      );
      return;
    }

    const cursor = editor.selection.active;
    const next = findNextMatchAfter(matches, cursor) ?? matches[0];

    editor.selection = new vscode.Selection(next.range.start, next.range.start);
    editor.revealRange(
      next.range,
      vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    );
  } catch (err) {
    handleError("goToNextNonAsciiCharacter", err);
  }
}

export async function applyReplacementsNow(
  getCachedMatchesFn: GetCachedMatchesFn,
  onComplete?: (editor: vscode.TextEditor) => void,
): Promise<void> {
  try {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const config = getConfig(editor.document.uri);
    if (!config.enable) return;

    const edits = buildReplacementsOnDemand(
      editor.document,
      getCachedMatchesFn,
    );
    if (edits.length === 0) {
      vscode.window.showInformationMessage(
        "Character Witness: No replacements to apply.",
      );
      return;
    }

    await editor.edit(editBuilder => {
      for (const edit of edits) {
        editBuilder.replace(edit.range, edit.newText);
      }
    });

    if (onComplete) {
      onComplete(editor);
    }
  } catch (err) {
    handleError("applyReplacementsNow", err);
  }
}

/**
 * Collect the non-ASCII characters covered by the given selections, excluding
 * `allowedCharacters`. Non-empty selections contribute every non-ASCII
 * character they contain; empty selections contribute the character at the
 * cursor (widened to a full surrogate pair when the cursor sits on a lead
 * surrogate).
 */
export function collectNonAsciiFromSelections(
  document: Pick<vscode.TextDocument, "getText">,
  selections: readonly vscode.Selection[],
  allowedCharacters: Set<string>,
): Set<string> {
  const chars = new Set<string>();

  for (const selection of selections) {
    if (!selection.isEmpty) {
      const text = document.getText(selection);
      for (const char of text) {
        const cp = char.codePointAt(0)!;
        if (cp > 127 && !allowedCharacters.has(char)) {
          chars.add(char);
        }
      }
    } else {
      // Read 2 code units so we capture a full surrogate pair if present.
      const pos = selection.active;
      const wideRange = new vscode.Range(pos, pos.translate(0, 2));
      const twoUnits = document.getText(wideRange);
      const firstCode = twoUnits.charCodeAt(0);
      const isSurrogatePair = firstCode >= 0xd800 && firstCode <= 0xdbff;
      const charRange = new vscode.Range(
        pos,
        pos.translate(0, isSurrogatePair ? 2 : 1),
      );
      const char = document.getText(charRange);
      if (char.length > 0) {
        const cp = char.codePointAt(0)!;
        if (cp > 127 && !allowedCharacters.has(char)) {
          chars.add(char);
        }
      }
    }
  }

  return chars;
}

/** Parse setting entries (u+hhhh and friends) into the characters they name. */
export function parseEntryChars(entries: readonly string[]): Set<string> {
  const chars = new Set<string>();
  for (const entry of entries) {
    const ch = parseCharacterEntry(entry);
    if (ch) chars.add(ch);
  }
  return chars;
}

/** Format characters as setting entries per codePointFormat/codePointCase. */
export function formatCharEntries(
  chars: Iterable<string>,
  codePointFormat: string,
  codePointCase: string,
): string[] {
  return [...chars].map(ch =>
    formatCodePoint(toHex(ch.codePointAt(0)!), codePointFormat, codePointCase),
  );
}

/**
 * Append `candidates` to `existing`, skipping any candidate whose character
 * is already present under any notation. Returns the merged list and the
 * entries actually added.
 */
export function appendMissingEntries(
  existing: readonly string[],
  candidates: readonly string[],
): { merged: string[]; added: string[] } {
  const existingChars = parseEntryChars(existing);
  const merged = [...existing];
  const added: string[] = [];
  for (const entry of candidates) {
    const ch = parseCharacterEntry(entry);
    if (ch && !existingChars.has(ch)) {
      existingChars.add(ch);
      merged.push(entry);
      added.push(entry);
    }
  }
  return { merged, added };
}

export async function addToAllowedCharacters(
  onComplete?: (editor: vscode.TextEditor) => void,
): Promise<void> {
  try {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const config = getConfig(editor.document.uri);
    if (!config.enable) return;

    const charsToAdd = collectNonAsciiFromSelections(
      editor.document,
      editor.selections,
      config.allowedCharacters,
    );

    if (charsToAdd.size === 0) {
      vscode.window.showInformationMessage(
        "Character Witness: No non-ASCII characters found at cursor or selection.",
      );
      return;
    }

    const cfg = vscode.workspace.getConfiguration("characterWitness");

    const hasWorkspace =
      vscode.workspace.workspaceFolders !== undefined &&
      vscode.workspace.workspaceFolders.length > 0;
    const target = hasWorkspace
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;

    const inspected = cfg.inspect<string[]>("allowedCharacters");
    const existing: string[] = hasWorkspace
      ? (inspected?.workspaceValue ?? [])
      : (inspected?.globalValue ?? []);

    const candidates = formatCharEntries(
      charsToAdd,
      config.codePointFormat,
      config.codePointCase,
    );
    const { merged, added } = appendMissingEntries(existing, candidates);

    await cfg.update("allowedCharacters", merged, target);

    const scopeLabel = hasWorkspace ? "workspace" : "user settings";
    const message = `Character Witness: Added ${added.join(", ")} to ${scopeLabel} allowed list.`;

    if (hasWorkspace) {
      const moveAction = "Save to User Settings instead";
      const choice = await vscode.window.showInformationMessage(
        message,
        moveAction,
      );
      if (choice === moveAction) {
        await moveAllowedEntriesToGlobal(cfg, added);
      }
    } else {
      vscode.window.showInformationMessage(message);
    }

    // Refresh the active editor immediately via callback
    if (onComplete) {
      onComplete(editor);
    }
  } catch (err) {
    handleError("addToAllowedCharacters", err);
  }
}

async function moveAllowedEntriesToGlobal(
  cfg: vscode.WorkspaceConfiguration,
  entries: string[],
): Promise<void> {
  const inspected = cfg.inspect<string[]>("allowedCharacters");
  const wsCurrent: string[] = inspected?.workspaceValue ?? [];
  const globalCurrent: string[] = inspected?.globalValue ?? [];

  const entrySet = new Set(entries);
  const wsNext = wsCurrent.filter(e => !entrySet.has(e));
  const { merged: globalNext } = appendMissingEntries(globalCurrent, entries);

  await cfg.update(
    "allowedCharacters",
    wsNext.length > 0 ? wsNext : undefined,
    vscode.ConfigurationTarget.Workspace,
  );
  await cfg.update(
    "allowedCharacters",
    globalNext,
    vscode.ConfigurationTarget.Global,
  );
}

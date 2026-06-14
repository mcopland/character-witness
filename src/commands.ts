import * as vscode from "vscode";
import { buildReplacementsOnDemand } from "./autoreplace";
import { ExtensionConfig, getConfig } from "./config";
import { handleError } from "./logger";
import { findNextMatchAfter, NonAsciiMatch } from "./scanner";
import { parseCharacterEntry, toHex } from "./utils";

type GetCachedMatchesFn = (
  doc: vscode.TextDocument,
  config: ExtensionConfig,
) => NonAsciiMatch[];

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

export async function addToAllowedCharacters(
  onComplete?: (editor: vscode.TextEditor) => void,
): Promise<void> {
  try {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const config = getConfig(editor.document.uri);
    if (!config.enable) return;

    // Determine which character(s) to add.
    // If there's a selection, use all non-ASCII chars in the selection.
    // Otherwise, use the character at the cursor position.
    const document = editor.document;
    const charsToAdd = new Set<string>();

    for (const selection of editor.selections) {
      if (!selection.isEmpty) {
        const text = document.getText(selection);
        for (const char of text) {
          const cp = char.codePointAt(0)!;
          if (cp > 127 && !config.allowedCharacters.has(char)) {
            charsToAdd.add(char);
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
          if (cp > 127 && !config.allowedCharacters.has(char)) {
            charsToAdd.add(char);
          }
        }
      }
    }

    if (charsToAdd.size === 0) {
      vscode.window.showInformationMessage(
        "Character Witness: No non-ASCII characters found at cursor or selection.",
      );
      return;
    }

    // Read the current array and append new entries as u+HHHH strings
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

    const existingChars = new Set<string>();
    for (const entry of existing) {
      const ch = parseCharacterEntry(entry);
      if (ch) existingChars.add(ch);
    }

    const addedEntries: string[] = [];
    const newEntries: string[] = [...existing];
    for (const ch of charsToAdd) {
      if (!existingChars.has(ch)) {
        const cp = ch.codePointAt(0)!;
        const entry = "u+" + toHex(cp);
        newEntries.push(entry);
        addedEntries.push(entry);
      }
    }

    await cfg.update("allowedCharacters", newEntries, target);

    const scopeLabel = hasWorkspace ? "workspace" : "user settings";
    const message = `Character Witness: Added ${addedEntries.join(", ")} to ${scopeLabel} allowed list.`;

    if (hasWorkspace) {
      const moveAction = "Save to User Settings instead";
      const choice = await vscode.window.showInformationMessage(
        message,
        moveAction,
      );
      if (choice === moveAction) {
        await moveAllowedEntriesToGlobal(cfg, addedEntries);
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

  const globalChars = new Set<string>();
  for (const e of globalCurrent) {
    const ch = parseCharacterEntry(e);
    if (ch) globalChars.add(ch);
  }
  const globalNext = [...globalCurrent];
  for (const e of entries) {
    const ch = parseCharacterEntry(e);
    if (ch && !globalChars.has(ch)) globalNext.push(e);
  }

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

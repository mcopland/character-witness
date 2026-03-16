import * as vscode from "vscode";
import { buildReplacementsOnDemand } from "./autoreplace";
import { getConfig } from "./config";
import { handleError } from "./logger";
import { NonAsciiMatch } from "./scanner";
import { parseCharacterEntry, toHex } from "./utils";

export async function applyReplacementsNow(
  getCachedMatchesFn: (
    doc: vscode.TextDocument,
    allowed: Set<string>,
  ) => NonAsciiMatch[],
  onComplete?: (editor: vscode.TextEditor) => void,
): Promise<void> {
  try {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const config = getConfig();
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

    const config = getConfig();
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
    const existing: string[] = cfg.get<string[]>("allowedCharacters", []);

    const existingChars = new Set<string>();
    for (const entry of existing) {
      const ch = parseCharacterEntry(entry);
      if (ch) existingChars.add(ch);
    }

    const newEntries: string[] = [...existing];
    for (const ch of charsToAdd) {
      if (!existingChars.has(ch)) {
        const cp = ch.codePointAt(0)!;
        newEntries.push("u+" + toHex(cp));
      }
    }

    await cfg.update(
      "allowedCharacters",
      newEntries,
      vscode.ConfigurationTarget.Global,
    );

    const added = Array.from(charsToAdd).map(ch => {
      const cp = ch.codePointAt(0)!;
      return "u+" + toHex(cp);
    });
    vscode.window.showInformationMessage(
      `Character Witness: Added ${added.join(", ")} to allowed list.`,
    );

    // Refresh the active editor immediately via callback
    if (onComplete) {
      onComplete(editor);
    }
  } catch (err) {
    handleError("addToAllowedCharacters", err);
  }
}

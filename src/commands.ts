import * as vscode from "vscode";
import { getConfig } from "./config";
import { parseCharacterEntry } from "./utils";
import { logError } from "./logger";

export async function addToAllowedCharacters(
  onComplete?: (editor: vscode.TextEditor) => void
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
        const isSurrogatePair = firstCode >= 0xD800 && firstCode <= 0xDBFF;
        const charRange = new vscode.Range(
          pos,
          pos.translate(0, isSurrogatePair ? 2 : 1)
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
        "Character Witness: No non-ASCII characters found at cursor or selection."
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
        const hex = cp.toString(16).toLowerCase().padStart(4, "0");
        newEntries.push("u+" + hex);
      }
    }

    await cfg.update(
      "allowedCharacters",
      newEntries,
      vscode.ConfigurationTarget.Global
    );

    const added = Array.from(charsToAdd).map((ch) => {
      const cp = ch.codePointAt(0)!;
      const hex = cp.toString(16).toLowerCase().padStart(4, "0");
      return "u+" + hex;
    });
    vscode.window.showInformationMessage(
      `Character Witness: Added ${added.join(", ")} to allowed list.`
    );

    // Refresh the active editor immediately via callback
    if (onComplete) {
      onComplete(editor);
    }
  } catch (err) {
    logError("addToAllowedCharacters", err);
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Character Witness: ${msg}`);
  }
}

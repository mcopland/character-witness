import * as vscode from "vscode";
import { getConfig, buildDecorationRenderOptions } from "./config";

let decorationType: vscode.TextEditorDecorationType | undefined;

/** Fingerprint of the last decoration style so we only recreate when it changes. */
let lastDecorationKey = "";

export function ensureDecorationType(): vscode.TextEditorDecorationType {
  const config = getConfig();
  const key = JSON.stringify(config.decoration);

  if (decorationType && key === lastDecorationKey) {
    return decorationType;
  }

  if (decorationType) {
    decorationType.dispose();
  }

  const renderOpts = buildDecorationRenderOptions(config.decoration);
  decorationType = vscode.window.createTextEditorDecorationType(renderOpts);
  lastDecorationKey = key;
  return decorationType;
}

export function disposeDecorationType(): void {
  if (decorationType) {
    decorationType.dispose();
    decorationType = undefined;
  }
}

export function clearDecorations(editor: vscode.TextEditor): void {
  if (decorationType) {
    editor.setDecorations(decorationType, []);
  }
}

export function resetDecorationKey(): void {
  lastDecorationKey = "";
}

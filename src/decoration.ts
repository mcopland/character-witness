import * as vscode from "vscode";
import {
  buildDecorationRenderOptions,
  DEFAULT_DECORATION,
  getConfig,
} from "./config";
import { logError } from "./logger";

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
  try {
    decorationType = vscode.window.createTextEditorDecorationType(renderOpts);
  } catch (err) {
    // A bad characterWitness.decoration setting can cause VS Code to reject
    // the options. Fall back to the built-in default so highlighting keeps
    // working rather than failing silently on every subsequent updateEditor.
    logError("ensureDecorationType", err);
    decorationType = vscode.window.createTextEditorDecorationType(
      buildDecorationRenderOptions(DEFAULT_DECORATION),
    );
  }
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

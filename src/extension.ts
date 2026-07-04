import { Minimatch } from "minimatch";
import * as vscode from "vscode";
import { buildReplacementEdits } from "./autoreplace";
import {
  addToAllowedCharacters,
  applyReplacementsNow,
  goToNextNonAsciiCharacter,
} from "./commands";
import {
  ExtensionConfig,
  getConfig,
  invalidateConfig,
  invalidateConfigCache,
} from "./config";
import { buildLineDiagnostics } from "./diagnostics";
import {
  clearDecorations,
  disposeDecorationType,
  ensureDecorationType,
  resetDecorationKey,
} from "./decoration";
import { handleError, initOutputChannel, log, logError } from "./logger";
import { ScanCache } from "./scancache";
import {
  findMatchAtPosition,
  formatHoverMarkdown,
  NonAsciiMatch,
} from "./scanner";
import { debounce } from "./utils";

let diagnosticCollection: vscode.DiagnosticCollection;

const DEBOUNCE_MS = 250;

const scanCache = new ScanCache();

function getCachedMatches(
  document: vscode.TextDocument,
  config: ExtensionConfig,
): NonAsciiMatch[] {
  return scanCache.getCachedMatches(document, config);
}

/**
 * Return true if the document's path matches any of the compiled `ignoredPaths`
 * globs. Paths are tested relative to the workspace folder when one is open,
 * and as absolute paths otherwise.
 */
export function isIgnoredDocument(
  document: { uri: vscode.Uri },
  ignoredPaths: Minimatch[],
): boolean {
  const normalized = document.uri.fsPath.replace(/\\/g, "/");
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const testPath = workspaceFolder
    ? normalized.slice(
        workspaceFolder.uri.fsPath.replace(/\\/g, "/").length + 1,
      )
    : normalized;
  return ignoredPaths.some(m => m.match(testPath));
}

function updateEditor(editor: vscode.TextEditor): void {
  try {
    const config = getConfig(editor.document.uri);

    if (!config.enable) {
      clearEditor(editor);
      return;
    }

    if (isIgnoredDocument(editor.document, config.ignoredPaths)) {
      clearEditor(editor);
      return;
    }

    const matches = getCachedMatches(editor.document, config);

    const decType = ensureDecorationType();
    if (matches.length === 0) {
      editor.setDecorations(decType, []);
      diagnosticCollection.set(editor.document.uri, []);
      return;
    }

    editor.setDecorations(
      decType,
      matches.map(m => ({ range: m.range })),
    );

    diagnosticCollection.set(
      editor.document.uri,
      buildLineDiagnostics(matches, config),
    );
  } catch (err) {
    logError("updateEditor", err);
    clearEditor(editor);
  }
}

function clearEditor(editor: vscode.TextEditor): void {
  clearDecorations(editor);
  diagnosticCollection.delete(editor.document.uri);
}

const scheduleUpdate = debounce((editor: vscode.TextEditor) => {
  if (editor.document.isClosed) return;
  if (editor !== vscode.window.activeTextEditor) return;
  updateEditor(editor);
}, DEBOUNCE_MS);

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(initOutputChannel());

  diagnosticCollection =
    vscode.languages.createDiagnosticCollection("characterWitness");
  context.subscriptions.push(diagnosticCollection);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "characterWitness.addToAllowedCharacters",
      () => addToAllowedCharacters(editor => updateEditor(editor)),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("characterWitness.applyReplacements", () =>
      applyReplacementsNow(getCachedMatches, editor => updateEditor(editor)),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "characterWitness.goToNextNonAsciiCharacter",
      () => goToNextNonAsciiCharacter(getCachedMatches),
    ),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      try {
        if (editor) {
          updateEditor(editor);
        }
      } catch (err) {
        handleError("onDidChangeActiveTextEditor", err);
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(event => {
      try {
        const editor = vscode.window.activeTextEditor;
        if (editor && event.document === editor.document) {
          const config = getConfig(event.document.uri);
          scanCache.tryIncrementalUpdate(event, config);
          scheduleUpdate(editor);
        }
      } catch (err) {
        handleError("onDidChangeTextDocument", err);
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      try {
        if (event.affectsConfiguration("characterWitness")) {
          invalidateConfigCache();
          scanCache.clear();
          resetDecorationKey();
          const editor = vscode.window.activeTextEditor;
          if (editor) {
            updateEditor(editor);
          }
        }
      } catch (err) {
        handleError("onDidChangeConfiguration", err);
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      try {
        invalidateConfigCache();
        scanCache.clear();
        log("workspace trust granted; full functionality restored");
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          updateEditor(editor);
        }
      } catch (err) {
        handleError("onDidGrantWorkspaceTrust", err);
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onWillSaveTextDocument(event => {
      try {
        const config = getConfig(event.document.uri);
        if (!config.enable) return;
        if (isIgnoredDocument(event.document, config.ignoredPaths)) return;
        const textLen = event.document.getText().length;
        if (textLen > config.maxFileSizeCodeUnits) {
          log(
            `skipping auto-replace: ${event.document.uri.fsPath} exceeds maxFileSizeKb (${textLen} code units > ${config.maxFileSizeCodeUnits})`,
          );
          return;
        }
        event.waitUntil(
          Promise.resolve(
            buildReplacementEdits(event.document, getCachedMatches),
          ),
        );
      } catch (err) {
        handleError("onWillSaveTextDocument", err);
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument(document => {
      try {
        diagnosticCollection.delete(document.uri);
        scanCache.delete(document.uri.toString());
        invalidateConfig(document.uri);
        // Do not cancel the pending debounced update here: it is shared
        // across all editors, so cancelling it when any document closes
        // would silently drop a pending rescan for the active editor. The
        // scheduleUpdate callback already guards against closed/inactive
        // editors.
      } catch (err) {
        handleError("onDidCloseTextDocument", err);
      }
    }),
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      [{ scheme: "file" }, { scheme: "untitled" }],
      {
        provideHover(document, position) {
          try {
            const config = getConfig(document.uri);
            if (!config.enable) return undefined;
            if (isIgnoredDocument(document, config.ignoredPaths))
              return undefined;
            const matches = getCachedMatches(document, config);
            const match = findMatchAtPosition(matches, position);
            if (!match) return undefined;
            return new vscode.Hover(
              formatHoverMarkdown(
                match,
                config.codePointFormat,
                config.codePointCase,
              ),
              match.range,
            );
          } catch (err) {
            logError("provideHover", err);
            return undefined;
          }
        },
      },
    ),
  );

  if (vscode.window.activeTextEditor) {
    updateEditor(vscode.window.activeTextEditor);
  }

  if (!vscode.workspace.isTrusted) {
    log(
      "limited mode: workspace is not trusted; auto-replace, replacementMap, and ignoredPaths are disabled",
    );
  }

  log("activated");
}

export function deactivate(): void {
  log("deactivated");
  scheduleUpdate.cancel();
  disposeDecorationType();
}

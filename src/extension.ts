import * as vscode from "vscode";
import { buildReplacementEdits } from "./autoreplace";
import { addToAllowedCharacters, applyReplacementsNow } from "./commands";
import {
  getCharacterSeverity,
  getConfig,
  invalidateConfigCache,
} from "./config";
import {
  clearDecorations,
  disposeDecorationType,
  ensureDecorationType,
  resetDecorationKey,
} from "./decoration";
import { handleError, initOutputChannel, log, logError } from "./logger";
import {
  findNonAsciiCharacters,
  formatGroupedDiagnosticMessage,
  formatHoverMarkdown,
  NonAsciiMatch,
} from "./scanner";

let diagnosticCollection: vscode.DiagnosticCollection;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

const DEBOUNCE_MS = 250;

interface ScanCacheEntry {
  version: number;
  fingerprint: string;
  matches: NonAsciiMatch[];
}

const scanCache = new Map<string, ScanCacheEntry>();

export function isIgnoredDocument(
  document: { uri: { fsPath: string } },
  ignoredPaths: RegExp[],
): boolean {
  const normalized = document.uri.fsPath.replace(/\\/g, "/");
  return ignoredPaths.some(re => re.test(normalized));
}

function getCachedMatches(
  document: vscode.TextDocument,
  allowedCharacters: Set<string>,
  includeStrings: boolean = true,
  includeComments: boolean = true,
): NonAsciiMatch[] {
  const key = document.uri.toString();
  const fingerprint = `${[...allowedCharacters].sort().join(",")}|${includeStrings}|${includeComments}|${document.languageId}`;
  const cached = scanCache.get(key);

  if (
    cached &&
    cached.version === document.version &&
    cached.fingerprint === fingerprint
  ) {
    return cached.matches;
  }

  const matches = findNonAsciiCharacters(
    document,
    allowedCharacters,
    includeStrings,
    includeComments,
    document.languageId,
  );
  scanCache.set(key, { version: document.version, fingerprint, matches });
  return matches;
}

function updateEditor(editor: vscode.TextEditor): void {
  try {
    const config = getConfig();

    if (!config.enable) {
      clearEditor(editor);
      return;
    }

    if (isIgnoredDocument(editor.document, config.ignoredPaths)) {
      clearEditor(editor);
      return;
    }

    const matches = getCachedMatches(
      editor.document,
      config.allowedCharacters,
      config.includeStrings,
      config.includeComments,
    );

    const decType = ensureDecorationType();
    editor.setDecorations(decType, matches.map(m => ({ range: m.range })));

    const lineGroups = new Map<number, NonAsciiMatch[]>();
    for (const m of matches) {
      const line = m.range.start.line;
      let group = lineGroups.get(line);
      if (!group) {
        group = [];
        lineGroups.set(line, group);
      }
      group.push(m);
    }

    const diagnostics: vscode.Diagnostic[] = [];
    for (const group of lineGroups.values()) {
      const rangeStart = group[0].range.start;
      const rangeEnd = group[group.length - 1].range.end;
      const range = new vscode.Range(rangeStart, rangeEnd);

      // Worst (lowest enum value) severity in the group
      let worstSeverity = vscode.DiagnosticSeverity.Information;
      for (const m of group) {
        const s = getCharacterSeverity(m.char, config);
        if (s < worstSeverity) worstSeverity = s;
      }

      if (!config.diagnosticSeverities.has(worstSeverity)) continue;

      const diag = new vscode.Diagnostic(
        range,
        formatGroupedDiagnosticMessage(
          group,
          config.codePointFormat,
          config.codePointCase,
        ),
        worstSeverity,
      );
      diag.source = "Character Witness";
      diagnostics.push(diag);
    }
    diagnosticCollection.set(editor.document.uri, diagnostics);
  } catch (err) {
    logError("updateEditor", err);
    clearEditor(editor);
  }
}

function clearEditor(editor: vscode.TextEditor): void {
  clearDecorations(editor);
  diagnosticCollection.delete(editor.document.uri);
}

function scheduleUpdate(editor: vscode.TextEditor): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    updateEditor(editor);
  }, DEBOUNCE_MS);
}

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
    vscode.workspace.onWillSaveTextDocument(event => {
      try {
        const config = getConfig();
        if (!config.enable) return;
        if (isIgnoredDocument(event.document, config.ignoredPaths)) return;
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
      diagnosticCollection.delete(document.uri);
      scanCache.delete(document.uri.toString());
    }),
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ scheme: "*" }, {
      provideHover(document, position) {
        const config = getConfig();
        const matches = getCachedMatches(
          document,
          config.allowedCharacters,
          config.includeStrings,
          config.includeComments,
        );
        const match = matches.find(m => m.range.contains(position));
        if (!match) return undefined;
        return new vscode.Hover(
          formatHoverMarkdown(match, config.codePointFormat, config.codePointCase),
          match.range,
        );
      },
    }),
  );

  if (vscode.window.activeTextEditor) {
    updateEditor(vscode.window.activeTextEditor);
  }

  log("activated");
}

export function deactivate(): void {
  log("deactivated");
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  disposeDecorationType();
}

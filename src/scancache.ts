import * as vscode from "vscode";
import { ExtensionConfig } from "./config";
import {
  applyIncrementalChange,
  findNonAsciiCharacters,
  NonAsciiMatch,
} from "./scanner";

export const SCAN_CACHE_CAP = 50;
export const INCREMENTAL_THRESHOLD_LINES = 5000;

interface ScanCacheEntry {
  version: number;
  fingerprint: string;
  matches: NonAsciiMatch[];
}

export function computeFingerprint(
  document: vscode.TextDocument,
  config: ExtensionConfig,
): string {
  return `${config.allowedCharactersKey}|${config.includeStrings}|${config.includeComments}|${document.languageId}|${config.maxFileSizeCodeUnits}`;
}

/**
 * LRU cache of scan results, keyed by document URI. An entry is valid only
 * while both the document version and the config fingerprint match.
 */
export class ScanCache {
  private readonly entries = new Map<string, ScanCacheEntry>();

  getCachedMatches(
    document: vscode.TextDocument,
    config: ExtensionConfig,
  ): NonAsciiMatch[] {
    const key = document.uri.toString();
    const fingerprint = computeFingerprint(document, config);
    const cached = this.entries.get(key);

    if (
      cached &&
      cached.version === document.version &&
      cached.fingerprint === fingerprint
    ) {
      this.touch(key, cached);
      return cached.matches;
    }

    const matches = findNonAsciiCharacters(document, config.allowedCharacters, {
      includeStrings: config.includeStrings,
      includeComments: config.includeComments,
      languageId: document.languageId,
      maxFileSizeCodeUnits: config.maxFileSizeCodeUnits,
    });
    this.touch(key, { version: document.version, fingerprint, matches });
    return matches;
  }

  tryIncrementalUpdate(
    event: vscode.TextDocumentChangeEvent,
    config: ExtensionConfig,
  ): boolean {
    if (!this.canIncrementalUpdate(event.document, config)) return false;
    if (event.contentChanges.length === 0) return false;
    // Multiple changes in one event carry pre-event line numbers, but only
    // the fully-updated document is available to rescan; an earlier-in-
    // document change that alters the line count would corrupt the mapping
    // of the later changes. Fall back to a full scan instead.
    if (event.contentChanges.length > 1) return false;

    const key = event.document.uri.toString();
    const cached = this.entries.get(key);
    if (!cached) return false;

    const fingerprint = computeFingerprint(event.document, config);
    if (cached.fingerprint !== fingerprint) return false;
    if (cached.version !== event.document.version - 1) return false;

    const matches = applyIncrementalChange(
      cached.matches,
      event.document,
      event.contentChanges[0],
      config.allowedCharacters,
    );

    this.touch(key, {
      version: event.document.version,
      fingerprint,
      matches,
    });
    return true;
  }

  delete(uri: string): void {
    this.entries.delete(uri);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  has(uri: string): boolean {
    return this.entries.has(uri);
  }

  private touch(key: string, entry: ScanCacheEntry): void {
    // Map preserves insertion order; delete + set moves to MRU position.
    this.entries.delete(key);
    this.entries.set(key, entry);
    if (this.entries.size > SCAN_CACHE_CAP) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  private canIncrementalUpdate(
    document: vscode.TextDocument,
    config: ExtensionConfig,
  ): boolean {
    if (document.lineCount < INCREMENTAL_THRESHOLD_LINES) return false;
    if (!config.includeStrings || !config.includeComments) return false;
    if (document.getText().length > config.maxFileSizeCodeUnits) return false;
    return true;
  }
}

import { Minimatch } from "minimatch";
import * as vscode from "vscode";
import { log } from "./logger";
import { ERROR_LEVEL_CODEPOINTS } from "./scanner";
import {
  parseCharacterEntries,
  parseCharacterEntry,
  parseCharacterGroup,
} from "./utils";

const DEFAULT_DECORATION: Record<string, string> = {
  backgroundColor: "rgba(125, 249, 255, 0.2)",
  borderColor: "rgba(125, 249, 255, 0.1)",
  borderRadius: "4px",
  borderStyle: "solid",
  borderWidth: "2px",
  color: "rgba(125, 249, 255, 1)",
  cursor: "help",
  fontStyle: "normal",
  fontWeight: "600",
  opacity: "1",
  overviewRulerColor: "",
};

function parseOverviewRulerLane(value: string): vscode.OverviewRulerLane {
  switch (value) {
    case "Left":
      return vscode.OverviewRulerLane.Left;
    case "Right":
      return vscode.OverviewRulerLane.Right;
    case "Full":
      return vscode.OverviewRulerLane.Full;
    case "Center":
    default:
      return vscode.OverviewRulerLane.Center;
  }
}

export function buildDecorationRenderOptions(
  style: Record<string, string>,
): vscode.DecorationRenderOptions {
  const { overviewRulerLane, ...rest } = style;
  const opts = rest as vscode.DecorationRenderOptions;
  if (rest.overviewRulerColor) {
    opts.overviewRulerLane = parseOverviewRulerLane(
      overviewRulerLane ?? "Center",
    );
  }
  return opts;
}

export interface ReplacementEntry {
  from: string;
  to: string;
}

function parseReplacementMap(raw: Record<string, string>): ReplacementEntry[] {
  const entries: ReplacementEntry[] = [];
  for (const [key, value] of Object.entries(raw)) {
    for (const fromChar of parseCharacterGroup(key)) {
      entries.push({ from: fromChar, to: value });
    }
  }
  return entries;
}

export interface ExtensionConfig {
  enable: boolean;
  decoration: Record<string, string>;
  allowedCharacters: Set<string>;
  allowedCharactersKey: string;
  autoReplaceOnSave: boolean;
  replacements: ReplacementEntry[];
  severityOverrides: Map<string, vscode.DiagnosticSeverity>;
  includeStrings: boolean;
  includeComments: boolean;
  codePointFormat: string;
  codePointCase: string;
  ignoredPaths: Minimatch[];
  diagnosticSeverities: Set<vscode.DiagnosticSeverity>;
  maxFileSizeBytes: number;
  isLimited: boolean;
}

export function compileIgnoredPaths(patterns: string[]): Minimatch[] {
  return patterns.map(p => new Minimatch(p, { dot: true }));
}

function parseSeverityString(
  value: string,
): vscode.DiagnosticSeverity | undefined {
  switch (value.toLowerCase()) {
    case "error":
      return vscode.DiagnosticSeverity.Error;
    case "warning":
      return vscode.DiagnosticSeverity.Warning;
    case "info":
      return vscode.DiagnosticSeverity.Information;
    default:
      return undefined;
  }
}

function parseSeverityOverrides(
  raw: Record<string, string>,
): Map<string, vscode.DiagnosticSeverity> {
  const map = new Map<string, vscode.DiagnosticSeverity>();
  for (const [key, value] of Object.entries(raw)) {
    const char = parseCharacterEntry(key);
    const severity = parseSeverityString(value);
    if (char && severity !== undefined) {
      map.set(char, severity);
    }
  }
  return map;
}

/**
 * Determine the diagnostic severity for a given character.
 * Checks user overrides first, then the hardcoded error-level set, then defaults to Information.
 */
export function getCharacterSeverity(
  char: string,
  config: ExtensionConfig,
): vscode.DiagnosticSeverity {
  const override = config.severityOverrides.get(char);
  if (override !== undefined) return override;

  const codePoint = char.codePointAt(0)!;
  if (ERROR_LEVEL_CODEPOINTS.has(codePoint))
    return vscode.DiagnosticSeverity.Error;

  return vscode.DiagnosticSeverity.Information;
}

const GLOBAL_CACHE_KEY = "__global__";
const cachedConfigs = new Map<string, ExtensionConfig>();

function readConfig(): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration("characterWitness");
  const trusted = vscode.workspace.isTrusted;

  const rawAllowed = cfg.get<string[]>("allowedCharacters", []);
  const allowedSet = new Set<string>();
  for (const entry of rawAllowed) {
    for (const ch of parseCharacterEntries(entry)) {
      allowedSet.add(ch);
    }
  }
  const allowedCharactersKey = [...allowedSet].sort().join(",");

  const rawDecoration = cfg.get<Record<string, string>>("decoration", {});
  const decoration: Record<string, string> = {
    ...DEFAULT_DECORATION,
    ...rawDecoration,
  };

  const rawReplacements = cfg.get<Record<string, string>>("replacementMap", {});

  const rawSeverityOverrides = cfg.get<Record<string, string>>(
    "severityOverrides",
    {},
  );

  const rawDiagnosticSeverities = cfg.get<string[]>("diagnosticSeverities", [
    "error",
    "warning",
    "info",
  ]);
  const diagnosticSeverities = new Set<vscode.DiagnosticSeverity>();
  for (const s of rawDiagnosticSeverities) {
    const severity = parseSeverityString(s);
    if (severity !== undefined) diagnosticSeverities.add(severity);
  }

  const maxKb = cfg.get<number>("maxFileSizeKb", 10240);
  const maxFileSizeBytes = maxKb > 0 ? maxKb * 1024 : Number.POSITIVE_INFINITY;

  return {
    enable: cfg.get<boolean>("enable", true),
    decoration,
    allowedCharacters: allowedSet,
    allowedCharactersKey,
    autoReplaceOnSave: trusted && cfg.get<boolean>("autoReplaceOnSave", false),
    replacements: trusted ? parseReplacementMap(rawReplacements) : [],
    severityOverrides: parseSeverityOverrides(rawSeverityOverrides),
    includeStrings: cfg.get<boolean>("includeStrings", true),
    includeComments: cfg.get<boolean>("includeComments", true),
    codePointFormat: cfg.get<string>("codePointFormat", "u+"),
    codePointCase: cfg.get<string>("codePointCase", "upper"),
    ignoredPaths: trusted
      ? compileIgnoredPaths(cfg.get<string[]>("ignoredPaths", []))
      : [],
    diagnosticSeverities,
    maxFileSizeBytes,
    isLimited: !trusted,
  };
}

export function getConfig(resource?: vscode.Uri): ExtensionConfig {
  const key = resource ? resource.toString() : GLOBAL_CACHE_KEY;
  const existing = cachedConfigs.get(key);
  if (existing) return existing;
  const fresh = readConfig(resource);
  cachedConfigs.set(key, fresh);
  return fresh;
}

export function invalidateConfigCache(): void {
  cachedConfigs.clear();
  log("config cache invalidated");
}

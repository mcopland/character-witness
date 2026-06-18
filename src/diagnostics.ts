import * as vscode from "vscode";
import { ExtensionConfig, getCharacterSeverity } from "./config";
import { formatGroupedDiagnosticMessage, NonAsciiMatch } from "./scanner";

/**
 * Build per-line diagnostics from a list of matches, respecting the
 * `diagnosticSeverities` filter independently for each match.
 *
 * Matches are filtered by enabled severity *before* grouping so that a line
 * containing both an Error-level and an Info-level char correctly produces an
 * Info diagnostic when only Info is enabled -- rather than suppressing the whole
 * line because the worst severity (Error) is disabled.
 */
export function buildLineDiagnostics(
  matches: NonAsciiMatch[],
  config: ExtensionConfig,
): vscode.Diagnostic[] {
  // Keep only matches whose severity is in the enabled set.
  const enabled = matches.filter(m =>
    config.diagnosticSeverities.has(getCharacterSeverity(m.char, config)),
  );

  // Group survivors by line number, preserving document order.
  const lineGroups = new Map<number, NonAsciiMatch[]>();
  for (const m of enabled) {
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

    // Worst (lowest enum value) severity among the *enabled* survivors.
    let worstSeverity = vscode.DiagnosticSeverity.Information;
    for (const m of group) {
      const s = getCharacterSeverity(m.char, config);
      if (s < worstSeverity) worstSeverity = s;
    }

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

  return diagnostics;
}

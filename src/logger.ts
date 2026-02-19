import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

export function initOutputChannel(): vscode.Disposable {
  channel = vscode.window.createOutputChannel("Character Witness");
  return channel;
}

export function log(message: string): void {
  if (channel) {
    channel.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}

export function logError(context: string, error?: unknown): void {
  const msg =
    error instanceof Error ? error.message : error !== undefined ? String(error) : "unknown error";
  log(`ERROR [${context}] ${msg}`);
}

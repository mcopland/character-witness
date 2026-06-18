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
    error instanceof Error
      ? error.message
      : error !== undefined
        ? String(error)
        : "unknown error";
  log(`ERROR [${context}] ${msg}`);
}

const THROTTLE_WINDOW_MS = 10_000;
let lastShownMessage: string | undefined;
let throttleTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Log the error and show a user-facing error notification.
 * Use this in event handlers and commands where the user needs to know
 * something went wrong. Duplicate messages within 10 seconds are suppressed
 * to avoid spamming the user on high-frequency callbacks.
 */
export function handleError(context: string, error: unknown): void {
  logError(context, error);
  const msg = error instanceof Error ? error.message : String(error);
  const notification = `Character Witness: ${msg}`;
  if (notification === lastShownMessage) return;
  lastShownMessage = notification;
  clearTimeout(throttleTimer);
  throttleTimer = setTimeout(() => {
    lastShownMessage = undefined;
  }, THROTTLE_WINDOW_MS);
  vscode.window.showErrorMessage(notification);
}

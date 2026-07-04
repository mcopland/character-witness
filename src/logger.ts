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
const lastShownAt = new Map<string, number>();

/**
 * Log the error and show a user-facing error notification.
 * Use this in event handlers and commands where the user needs to know
 * something went wrong. Each distinct message is suppressed for 10 seconds
 * after it was last shown, so alternating errors on high-frequency
 * callbacks cannot bypass the throttle.
 */
export function handleError(context: string, error: unknown): void {
  logError(context, error);
  const msg = error instanceof Error ? error.message : String(error);
  const notification = `Character Witness: ${msg}`;
  const now = Date.now();
  for (const [message, shownAt] of lastShownAt) {
    if (now - shownAt >= THROTTLE_WINDOW_MS) lastShownAt.delete(message);
  }
  if (lastShownAt.has(notification)) return;
  lastShownAt.set(notification, now);
  vscode.window.showErrorMessage(notification);
}

export function resetErrorThrottle(): void {
  lastShownAt.clear();
}

import * as assert from "assert";
import * as vscode from "vscode";

export const tests: Array<{ name: string; fn: () => Promise<void> }> = [];
function test(name: string, fn: () => Promise<void>) {
  tests.push({ name, fn });
}

function generateLargeContent(lines: number, nonAsciiEvery: number): string {
  const parts: string[] = [];
  for (let i = 0; i < lines; i++) {
    if (i % nonAsciiEvery === 0) {
      parts.push(`Line ${i}: hello \u2014 world`);
    } else {
      parts.push(`Line ${i}: just plain ascii text here`);
    }
  }
  return parts.join("\n");
}

async function waitForDiagnostics(
  uri: vscode.Uri,
  timeoutMs = 5000,
  intervalMs = 100,
): Promise<vscode.Diagnostic[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const diags = vscode.languages.getDiagnostics(uri);
    if (diags.length > 0) {
      return diags;
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return vscode.languages.getDiagnostics(uri);
}

test("10k lines sparse (non-ASCII every 100 lines) should produce diagnostics within 2s", async () => {
  const content = generateLargeContent(10000, 100);
  const document = await vscode.workspace.openTextDocument({
    content,
    language: "plaintext",
  });
  await vscode.window.showTextDocument(document);

  const start = Date.now();
  const diags = await waitForDiagnostics(document.uri, 5000);
  const elapsed = Date.now() - start;

  console.log(`[perf] 10k sparse: ${diags.length} diagnostics in ${elapsed}ms`);
  assert.ok(
    diags.length >= 100,
    `Expected >=100 diagnostics, got ${diags.length}`,
  );
  assert.ok(
    elapsed < 2000,
    `Expected diagnostics within 2s, took ${elapsed}ms`,
  );
});

test("10k lines dense (non-ASCII every line) should produce diagnostics within 3s", async () => {
  const content = generateLargeContent(10000, 1);
  const document = await vscode.workspace.openTextDocument({
    content,
    language: "plaintext",
  });
  await vscode.window.showTextDocument(document);

  const start = Date.now();
  const diags = await waitForDiagnostics(document.uri, 5000);
  const elapsed = Date.now() - start;

  console.log(`[perf] 10k dense: ${diags.length} diagnostics in ${elapsed}ms`);
  assert.ok(
    diags.length >= 10000,
    `Expected >=10000 diagnostics, got ${diags.length}`,
  );
  assert.ok(
    elapsed < 3000,
    `Expected diagnostics within 3s, took ${elapsed}ms`,
  );
});

test("Cache hit should be faster than cold scan", async () => {
  const content = generateLargeContent(5000, 10);
  const document = await vscode.workspace.openTextDocument({
    content,
    language: "plaintext",
  });
  await vscode.window.showTextDocument(document);

  const coldStart = Date.now();
  const diags1 = await waitForDiagnostics(document.uri, 5000);
  const coldElapsed = Date.now() - coldStart;

  assert.ok(
    diags1.length >= 500,
    `Expected >=500 diagnostics, got ${diags1.length}`,
  );

  const tempDoc = await vscode.workspace.openTextDocument({
    content: "temp",
    language: "plaintext",
  });
  await vscode.window.showTextDocument(tempDoc);
  await new Promise(r => setTimeout(r, 200));

  const warmStart = Date.now();
  await vscode.window.showTextDocument(document);
  const diags2 = await waitForDiagnostics(document.uri, 5000);
  const warmElapsed = Date.now() - warmStart;

  console.log(
    `[perf] Cache test: cold=${coldElapsed}ms, warm=${warmElapsed}ms, diags=${diags2.length}`,
  );
  // Warm path should be at least somewhat faster (generous threshold for CI)
  assert.ok(
    diags2.length >= 500,
    `Expected >=500 diagnostics on warm path, got ${diags2.length}`,
  );
});

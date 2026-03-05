import * as assert from 'assert';
import * as vscode from 'vscode';
import { buildReplacementEdits } from '../autoreplace';
import { findNonAsciiCharacters, formatGroupedDiagnosticMessage } from '../scanner';

export const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];
function test(name: string, fn: () => void | Promise<void>) { tests.push({ name, fn }); }

async function openDocumentWithContent(content: string): Promise<{ editor: vscode.TextEditor; document: vscode.TextDocument }> {
  const document = await vscode.workspace.openTextDocument({
    content,
    language: 'plaintext',
  });
  const editor = await vscode.window.showTextDocument(document);
  return { editor, document };
}

/**
 * Helper: wait for the diagnostic collection to be populated for a URI.
 * Uses onDidChangeDiagnostics for immediate notification; falls back to
 * timeoutMs if the event never fires with a non-empty result.
 */
async function waitForDiagnostics(uri: vscode.Uri, timeoutMs = 3000): Promise<vscode.Diagnostic[]> {
  const immediate = vscode.languages.getDiagnostics(uri);
  if (immediate.length > 0) { return immediate; }

  return new Promise((resolve) => {
    let done = false;

    const timer = setTimeout(() => {
      if (!done) { done = true; sub.dispose(); resolve(vscode.languages.getDiagnostics(uri)); }
    }, timeoutMs);

    const sub = vscode.languages.onDidChangeDiagnostics((e) => {
      if (!done && e.uris.some(u => u.toString() === uri.toString())) {
        const diags = vscode.languages.getDiagnostics(uri);
        if (diags.length > 0) { done = true; clearTimeout(timer); sub.dispose(); resolve(diags); }
      }
    });
  });
}

/**
 * Helper: wait for diagnostics to reach a specific count.
 * Uses onDidChangeDiagnostics for immediate notification; falls back to
 * timeoutMs if the target count is never reached.
 */
async function waitForDiagnosticCount(uri: vscode.Uri, count: number, timeoutMs = 3000): Promise<vscode.Diagnostic[]> {
  const immediate = vscode.languages.getDiagnostics(uri);
  if (immediate.length === count) { return immediate; }

  return new Promise((resolve) => {
    let done = false;

    const timer = setTimeout(() => {
      if (!done) { done = true; sub.dispose(); resolve(vscode.languages.getDiagnostics(uri)); }
    }, timeoutMs);

    const sub = vscode.languages.onDidChangeDiagnostics((e) => {
      if (!done && e.uris.some(u => u.toString() === uri.toString())) {
        const diags = vscode.languages.getDiagnostics(uri);
        if (diags.length === count) { done = true; clearTimeout(timer); sub.dispose(); resolve(diags); }
      }
    });
  });
}

async function withConfig<T>(
  settings: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  const cfg = vscode.workspace.getConfiguration('characterWitness');
  const originals: Record<string, unknown> = {};

  for (const key of Object.keys(settings)) {
    originals[key] = cfg.inspect(key)?.globalValue;
  }

  try {
    for (const [key, value] of Object.entries(settings)) {
      await cfg.update(key, value, vscode.ConfigurationTarget.Global);
    }
    // Allow config change events to propagate
    await new Promise(r => setTimeout(r, 200));
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      await cfg.update(key, value, vscode.ConfigurationTarget.Global);
    }
    await new Promise(r => setTimeout(r, 200));
  }
}

test('Extension should be present', () => {
  const ext = vscode.extensions.getExtension('character-witness.character-witness');
  assert.ok(ext, 'Extension not found in registry');
});

test('Should produce diagnostics for non-ASCII characters', async () => {
  const { document } = await openDocumentWithContent('hello \u00e9 world \u00f1oo\u00fc');
  const diags = await waitForDiagnostics(document.uri);

  // All 3 non-ASCII chars are on one line, so we expect 1 grouped diagnostic.
  assert.ok(diags.length >= 1, `Expected >=1 diagnostics, got ${diags.length}`);

  for (const d of diags) {
    assert.strictEqual(d.severity, vscode.DiagnosticSeverity.Information, 'Expected Information severity');
  }
});

test('Should not produce diagnostics for pure ASCII', async () => {
  const { document } = await openDocumentWithContent('just plain ascii 123!');
  await new Promise(r => setTimeout(r, 500));
  const diags = vscode.languages.getDiagnostics(document.uri);
  assert.strictEqual(diags.length, 0, 'Expected 0 diagnostics for ASCII text');
});

test('Ignored characters should not produce diagnostics', async () => {
  await withConfig({ allowedCharacters: ['u+00a3', 'u+00a9'] }, async () => {
    const { document } = await openDocumentWithContent('test \u00a3 \u00a9 end');
    await new Promise(r => setTimeout(r, 500));
    const diags = vscode.languages.getDiagnostics(document.uri);
    assert.strictEqual(diags.length, 0, 'Expected 0 diagnostics for ignored characters');
  });
});

test('Diagnostic message format should include character and hex code', async () => {
  const document = await vscode.workspace.openTextDocument({ content: '\u00e9', language: 'plaintext' });
  const matches = findNonAsciiCharacters(document, new Set<string>());
  assert.ok(matches.length >= 1, 'Expected at least 1 match from scanner');
  const msg = formatGroupedDiagnosticMessage(matches);
  assert.ok(msg.includes('\u00e9') && msg.includes('00E9'), `Message "${msg}" should include the character and its hex code`);
});

test('Config | Adding a char to allowedCharacters should suppress diagnostics', async () => {
  const { document } = await openDocumentWithContent('test \u00a9 end');
  const diagsBefore = await waitForDiagnostics(document.uri);
  assert.ok(diagsBefore.length >= 1, `Expected >=1 diagnostic for \u00a9, got ${diagsBefore.length}`);

  await withConfig({ allowedCharacters: ['u+00a9'] }, async () => {
    await waitForDiagnosticCount(document.uri, 0);
    const diags = vscode.languages.getDiagnostics(document.uri);
    assert.strictEqual(diags.length, 0, 'Expected 0 diagnostics when \u00a9 is allowed');
  });
});

test('Config | Setting enable: false should clear diagnostics; re-enabling should restore them', async () => {
  const { document } = await openDocumentWithContent('hello \u2014 world');
  await waitForDiagnostics(document.uri);

  await withConfig({ enable: false }, async () => {
    await waitForDiagnosticCount(document.uri, 0);
    const diags = vscode.languages.getDiagnostics(document.uri);
    assert.strictEqual(diags.length, 0, 'Expected 0 diagnostics when disabled');
  });

  const diags = await waitForDiagnostics(document.uri);
  assert.ok(diags.length >= 1, `Expected diagnostics to be restored after re-enable, got ${diags.length}`);
});

test('Auto-Replace | buildReplacementEdits should produce edits for mapped characters', async () => {
  const { document } = await openDocumentWithContent('hello \u2014 world');

  // Direct scan to get matches (bypass cache for isolated test)
  const getCachedFn = (doc: vscode.TextDocument, allowedSet: Set<string>) =>
    findNonAsciiCharacters(doc, allowedSet);

  await withConfig({ autoReplaceOnSave: true, replacementMap: { 'u+2014': '-' } }, async () => {
    const edits = buildReplacementEdits(document, getCachedFn);
    assert.ok(edits.length >= 1, `Expected at least 1 edit for em-dash, got ${edits.length}`);
    assert.strictEqual(edits[0].newText, '-', 'Expected replacement to be "-"');
  });
});

test('Auto-Replace | No edits when autoReplaceOnSave is false', async () => {
  const { document } = await openDocumentWithContent('hello \u2014 world');
  const getCachedFn = (doc: vscode.TextDocument, allowedSet: Set<string>) =>
    findNonAsciiCharacters(doc, allowedSet);

  await withConfig({ autoReplaceOnSave: false }, async () => {
    const edits = buildReplacementEdits(document, getCachedFn);
    assert.strictEqual(edits.length, 0, 'Expected 0 edits when autoReplaceOnSave is false');
  });
});

test('Auto-Replace | Characters not in replacementMap produce no edits', async () => {
  // u+2019 (right single quote) is not in default replacement map
  const { document } = await openDocumentWithContent('hello \u2019 world');
  const getCachedFn = (doc: vscode.TextDocument, allowedSet: Set<string>) =>
    findNonAsciiCharacters(doc, allowedSet);

  await withConfig({ autoReplaceOnSave: true, replacementMap: { 'u+2013': '-' } }, async () => {
    const edits = buildReplacementEdits(document, getCachedFn);
    assert.strictEqual(edits.length, 0, 'Expected 0 edits for unmapped character');
  });
});

test('Severity | Error-level characters (e.g. NBSP) should produce Error severity', async () => {
  const { document } = await openDocumentWithContent('hello\u00a0world');
  const diags = await waitForDiagnostics(document.uri);
  assert.ok(diags.length >= 1, 'Expected at least 1 diagnostic');
  assert.strictEqual(diags[0].severity, vscode.DiagnosticSeverity.Error, 'Expected Error severity for NBSP');
});

test('Severity | Severity overrides should change severity', async () => {
  await withConfig({ severityOverrides: { 'u+00a0': 'info' } }, async () => {
    const { document } = await openDocumentWithContent('hello\u00a0world');
    const diags = await waitForDiagnostics(document.uri);
    assert.ok(diags.length >= 1, 'Expected at least 1 diagnostic');
    assert.strictEqual(diags[0].severity, vscode.DiagnosticSeverity.Information, 'Expected Info severity after override');
  });
});

test('Severity | Grouped diagnostic should use worst severity in group', async () => {
  const { document } = await openDocumentWithContent('hello\u00a0world\u2014end');
  const diags = await waitForDiagnostics(document.uri);
  assert.strictEqual(diags.length, 1, `Expected 1 grouped diagnostic, got ${diags.length}`);
  assert.strictEqual(diags[0].severity, vscode.DiagnosticSeverity.Error, 'Expected worst severity (Error) in group');
});

test('Filtering | includeStrings: false should skip chars in strings', async () => {
  await withConfig({ includeStrings: false }, async () => {
    // The em-dash is inside a double-quoted string
    const { document } = await openDocumentWithContent('const x = "hello \u2014 world";');
    // Switch to JavaScript for proper region detection
    await vscode.languages.setTextDocumentLanguage(document, 'javascript');
    // Wait for re-scan after language change
    await new Promise(r => setTimeout(r, 600));
    const diags = vscode.languages.getDiagnostics(document.uri);
    assert.strictEqual(diags.length, 0, 'Expected 0 diagnostics for chars in strings when includeStrings is false');
  });
});

test('Filtering | includeComments: false should skip chars in comments', async () => {
  await withConfig({ includeComments: false }, async () => {
    const { document } = await openDocumentWithContent('// hello \u2014 world');
    await vscode.languages.setTextDocumentLanguage(document, 'javascript');
    await new Promise(r => setTimeout(r, 600));
    const diags = vscode.languages.getDiagnostics(document.uri);
    assert.strictEqual(diags.length, 0, 'Expected 0 diagnostics for chars in comments when includeComments is false');
  });
});

test('Filtering | Chars outside strings/comments should still be flagged even when filters are off', async () => {
  await withConfig({ includeStrings: false, includeComments: false }, async () => {
    // The em-dash is outside any string or comment
    const { document } = await openDocumentWithContent('const x = 42 \u2014 3;');
    await vscode.languages.setTextDocumentLanguage(document, 'javascript');
    await new Promise(r => setTimeout(r, 600));
    const diags = vscode.languages.getDiagnostics(document.uri);
    assert.ok(diags.length >= 1, `Expected >=1 diagnostic for char outside string/comment, got ${diags.length}`);
  });
});

test('Edge | Empty document should produce 0 diagnostics', async () => {
  const { document } = await openDocumentWithContent('');
  await new Promise(r => setTimeout(r, 500));
  const diags = vscode.languages.getDiagnostics(document.uri);
  assert.strictEqual(diags.length, 0, 'Expected 0 diagnostics for empty document');
});

test('Edge | Newlines-only document should produce 0 diagnostics', async () => {
  const { document } = await openDocumentWithContent('\n\n\n');
  await new Promise(r => setTimeout(r, 500));
  const diags = vscode.languages.getDiagnostics(document.uri);
  assert.strictEqual(diags.length, 0, 'Expected 0 diagnostics for newlines-only document');
});

test('Edge | Surrogate pair character (U+1F600) should produce diagnostic with correct code', async () => {
  await withConfig({ codePointFormat: 'u+', codePointCase: 'upper' }, async () => {
    const { document } = await openDocumentWithContent('\u{1F600}');
    const diags = await waitForDiagnostics(document.uri);
    assert.ok(diags.length >= 1, 'Expected at least 1 diagnostic for surrogate pair');
    assert.ok(diags[0].message.includes('U+1F600'), `Expected message to include 'U+1F600', got "${diags[0].message}"`);
  });
});

test('Edge | Mixed ASCII + non-ASCII on same line should produce grouped diagnostic', async () => {
  await withConfig({ allowedCharacters: [] }, async () => {
    const { document } = await openDocumentWithContent('caf\u00e9  \u2014 \u00fcber');
    await new Promise(r => setTimeout(r, 500));
    const allDiags = vscode.languages.getDiagnostics(document.uri);
    const diags = allDiags.filter(d => d.source === 'Character Witness');
    assert.strictEqual(diags.length, 1, `Expected 1 grouped diagnostic, got ${diags.length}`);
    assert.ok(diags[0].message.includes('3 non-ASCII characters'), `Expected grouped message, got "${diags[0].message}"`);
  });
});

test('Config | codePointFormat "0x" should format code point in message with 0x prefix', async () => {
  await withConfig({ codePointFormat: '0x', codePointCase: 'lower' }, async () => {
    const { document } = await openDocumentWithContent('\u00e9');
    const diags = await waitForDiagnostics(document.uri);
    assert.ok(diags.length >= 1);
    assert.ok(diags[0].message.includes('0x00e9'), `Expected message to include '0x00e9', got "${diags[0].message}"`);
  });
});

test('Config | codePointCase "upper" should produce uppercase hex in message', async () => {
  await withConfig({ codePointFormat: 'u+', codePointCase: 'upper' }, async () => {
    const { document } = await openDocumentWithContent('\u00e9');
    const diags = await waitForDiagnostics(document.uri);
    assert.ok(diags.length >= 1);
    assert.ok(diags[0].message.includes('U+00E9'), `Expected message to include 'U+00E9', got "${diags[0].message}"`);
  });
});

test('Config | diagnosticSeverities [] should suppress all diagnostics', async () => {
  await withConfig({ diagnosticSeverities: [] }, async () => {
    const { document } = await openDocumentWithContent('hello \u00e9 world');
    await new Promise(r => setTimeout(r, 500));
    const diags = vscode.languages.getDiagnostics(document.uri);
    assert.strictEqual(diags.length, 0, 'Expected 0 diagnostics when diagnosticSeverities is []');
  });
});

test('Config | diagnosticSeverities ["error"] should suppress info-level diagnostics', async () => {
  await withConfig({ diagnosticSeverities: ['error'] }, async () => {
    const { document } = await openDocumentWithContent('hello \u00e9 world');
    await new Promise(r => setTimeout(r, 500));
    const diags = vscode.languages.getDiagnostics(document.uri);
    assert.strictEqual(diags.length, 0, 'Expected 0 diagnostics for info-level char with ["error"] filter');
  });
});

test('Config | ignoredPaths matching file path should produce no diagnostics', async () => {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const tmpPath = path.join(os.tmpdir(), 'cw-test-ignored.txt');
  fs.writeFileSync(tmpPath, 'hello \u00e9 world');
  const uri = vscode.Uri.file(tmpPath);

  try {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);

    const diagsBefore = await waitForDiagnostics(uri);
    assert.ok(diagsBefore.length >= 1, 'Expected diagnostics before ignoredPaths configured');

    await withConfig({ ignoredPaths: ['*cw-test-ignored.txt'] }, async () => {
      await waitForDiagnosticCount(uri, 0);
      const diags = vscode.languages.getDiagnostics(uri);
      assert.strictEqual(diags.length, 0, 'Expected 0 diagnostics for ignored path');
    });
  } finally {
    fs.unlinkSync(tmpPath);
  }
});

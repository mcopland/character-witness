import * as vscode from 'vscode';

export async function run(): Promise<void> {
  const { tests } = await import('./perf.test');
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`pass  ${name}`);
    } catch (e) {
      console.error(`FAIL  ${name}`, e);
      failed++;
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  }
  const passed = tests.length - failed;
  const summary = `Performance Tests: ${passed} passed, ${failed} failed.`;
  if (failed > 0) {
    await vscode.window.showErrorMessage(summary, 'Close');
    throw new Error(`${failed} test(s) failed.`);
  } else {
    await vscode.window.showInformationMessage(summary, 'Close');
  }
}

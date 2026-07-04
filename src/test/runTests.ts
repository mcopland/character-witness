import * as path from "path";
import { runTests } from "@vscode/test-electron";

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, "../..");
  const suite =
    process.argv[2] === "perf" ? "runPerfTests" : "runExtensionTests";
  const extensionTestsPath = path.resolve(__dirname, `./${suite}`);
  await runTests({ extensionDevelopmentPath, extensionTestsPath });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

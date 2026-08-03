import { runTests } from "@vscode/test-electron";
import * as path from "path";

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        // This file runs from out/test/test, so the repository root is three levels up. Pointing at
        // anything else leaves the extension unloaded, and every contributed command missing.
        const extensionDevelopmentPath = path.resolve(__dirname, "../../../");

        // The path to test runner
        // Passed to --extensionTestsPath
        const extensionTestsPath = path.resolve(__dirname, "./suite/index");

        // Download VS Code, unzip it and run the integration test
        await runTests({ extensionDevelopmentPath, extensionTestsPath });
    } catch (err) {
        console.error("Failed to run tests", err);
        process.exit(1);
    }
}

main();

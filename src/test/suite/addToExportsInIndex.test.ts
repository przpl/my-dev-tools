import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { addToExportsInIndex } from "../../features/addToExportsInIndex";

suite("AddToExportsInIndex Tests", () => {
    let testEditor: vscode.TextEditor;
    let tempDir: string;

    setup(async () => {
        // Create temporary directory structure for test files
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-test-"));
    });

    teardown(async () => {
        // Close all editors
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");

        // Clean up temporary files
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test("should show message when no index.ts file found", async () => {
        // Create test file without index.ts
        const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), "isolated-test-"));
        const isolatedFilePath = path.join(isolatedDir, "component.ts");
        fs.writeFileSync(isolatedFilePath, `export function test() {}`, "utf8");

        const uri = vscode.Uri.file(isolatedFilePath);
        const testDocument = await vscode.workspace.openTextDocument(uri);
        testEditor = await vscode.window.showTextDocument(testDocument);

        let infoMessage = "";
        const originalShowInformationMessage = vscode.window.showInformationMessage;
        vscode.window.showInformationMessage = async (message: string) => {
            infoMessage = message;
            return undefined;
        };

        await addToExportsInIndex();

        // Restore original method
        vscode.window.showInformationMessage = originalShowInformationMessage;

        // Clean up isolated directory
        fs.rmSync(isolatedDir, { recursive: true, force: true });

        assert.strictEqual(infoMessage, "No nearest index.ts file found.", "Should show message when no index.ts found");
    });

    test("should not do anything without active editor", async () => {
        // Close all editors
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");

        let infoMessageCalled = false;
        const originalShowInformationMessage = vscode.window.showInformationMessage;
        vscode.window.showInformationMessage = async (message: string) => {
            infoMessageCalled = true;
            return undefined;
        };

        await addToExportsInIndex();

        // Restore original method
        vscode.window.showInformationMessage = originalShowInformationMessage;

        assert.strictEqual(infoMessageCalled, false, "Should not show any message without active editor");
    });

    // Note: Tests that require workspace folder context (like finding index.ts in parent directories)
    // cannot be reliably tested with temp directories outside the workspace.
    // These tests should be run manually or through integration tests with a proper workspace setup.
});

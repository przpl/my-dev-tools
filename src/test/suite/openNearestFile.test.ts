import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { openNearestFile } from "../../features/openNearestFile";

suite("OpenNearestFile Tests", () => {
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

    async function createFileStructure(structure: { [key: string]: string }): Promise<void> {
        for (const [relativePath, content] of Object.entries(structure)) {
            const fullPath = path.join(tempDir, relativePath);
            const dir = path.dirname(fullPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(fullPath, content, "utf8");
        }
    }

    async function openFile(relativePath: string): Promise<void> {
        const filePath = path.join(tempDir, relativePath);
        const uri = vscode.Uri.file(filePath);
        const document = await vscode.workspace.openTextDocument(uri);
        testEditor = await vscode.window.showTextDocument(document);
    }

    test("should show message when no matching file found", async () => {
        await createFileStructure({
            "src/components/Button.tsx": `export function Button() { return <button>Click</button>; }`,
        });

        await openFile("src/components/Button.tsx");

        let infoMessage = "";
        const originalShowInformationMessage = vscode.window.showInformationMessage;
        vscode.window.showInformationMessage = async (message: string) => {
            infoMessage = message;
            return undefined;
        };

        await openNearestFile("index.ts");

        // Restore original method
        vscode.window.showInformationMessage = originalShowInformationMessage;

        assert.strictEqual(infoMessage, "No nearest index.ts file found.", "Should show message when no file found");
    });

    test("should not do anything without active editor", async () => {
        // Close all editors
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");

        let showTextDocumentCalled = false;
        let infoMessageCalled = false;
        
        const originalShowTextDocument = vscode.window.showTextDocument;
        vscode.window.showTextDocument = async (documentOrUri: vscode.TextDocument | vscode.Uri, ...args: any[]) => {
            showTextDocumentCalled = true;
            const uri = documentOrUri instanceof vscode.Uri ? documentOrUri : documentOrUri.uri;
            return originalShowTextDocument.call(vscode.window, uri) as Promise<vscode.TextEditor>;
        };

        const originalShowInformationMessage = vscode.window.showInformationMessage;
        vscode.window.showInformationMessage = async (message: string) => {
            infoMessageCalled = true;
            return undefined;
        };

        await openNearestFile("index.ts");

        // Restore original methods
        vscode.window.showTextDocument = originalShowTextDocument;
        vscode.window.showInformationMessage = originalShowInformationMessage;

        assert.strictEqual(showTextDocumentCalled, false, "Should not try to open file without active editor");
        assert.strictEqual(infoMessageCalled, false, "Should not show message without active editor");
    });

    test("should show appropriate message for various patterns", async () => {
        await createFileStructure({
            "src/users/users.controller.ts": `@Controller() export class UsersController {}`,
        });

        await openFile("src/users/users.controller.ts");

        let infoMessage = "";
        const originalShowInformationMessage = vscode.window.showInformationMessage;
        vscode.window.showInformationMessage = async (message: string) => {
            infoMessage = message;
            return undefined;
        };

        await openNearestFile("*.module.ts");

        // Restore original method
        vscode.window.showInformationMessage = originalShowInformationMessage;

        assert.strictEqual(infoMessage, "No nearest *.module.ts file found.", "Should show message with pattern name");
    });

    // Note: Tests that require workspace folder context (like finding files in parent directories)
    // cannot be reliably tested with temp directories outside the workspace.
    // The FileUtils.findNearest function uses vscode.workspace.getWorkspaceFolder which
    // requires the file to be within an open workspace folder.
});

import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { convertEolToLf } from "../../features/convertEolToLf";

suite("ConvertEolToLf Tests", () => {
    let tempDir: string;
    let originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;
    let originalShowInputBox: typeof vscode.window.showInputBox;
    let originalShowInformationMessage: typeof vscode.window.showInformationMessage;
    let originalShowWarningMessage: typeof vscode.window.showWarningMessage;
    let originalShowErrorMessage: typeof vscode.window.showErrorMessage;
    let originalWithProgress: typeof vscode.window.withProgress;
    let originalFindFiles: typeof vscode.workspace.findFiles;

    setup(async () => {
        // Create temporary directory structure for test files
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-eol-test-"));

        // Save original methods
        originalWorkspaceFolders = vscode.workspace.workspaceFolders;
        originalShowInputBox = vscode.window.showInputBox;
        originalShowInformationMessage = vscode.window.showInformationMessage;
        originalShowWarningMessage = vscode.window.showWarningMessage;
        originalShowErrorMessage = vscode.window.showErrorMessage;
        originalWithProgress = vscode.window.withProgress;
        originalFindFiles = vscode.workspace.findFiles;

        // Mock workspace folders
        Object.defineProperty(vscode.workspace, "workspaceFolders", {
            value: [{ uri: vscode.Uri.file(tempDir), name: "test", index: 0 }],
            writable: true,
            configurable: true,
        });
    });

    teardown(async () => {
        // Restore original methods
        Object.defineProperty(vscode.workspace, "workspaceFolders", {
            value: originalWorkspaceFolders,
            writable: true,
            configurable: true,
        });
        vscode.window.showInputBox = originalShowInputBox;
        vscode.window.showInformationMessage = originalShowInformationMessage;
        vscode.window.showWarningMessage = originalShowWarningMessage;
        vscode.window.showErrorMessage = originalShowErrorMessage;
        vscode.window.withProgress = originalWithProgress;
        vscode.workspace.findFiles = originalFindFiles;

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

    test("should show error when no workspace folder is open", async () => {
        Object.defineProperty(vscode.workspace, "workspaceFolders", {
            value: undefined,
            writable: true,
            configurable: true,
        });

        let errorMessage = "";
        vscode.window.showErrorMessage = async (message: string) => {
            errorMessage = message;
            return undefined;
        };

        await convertEolToLf();

        assert.strictEqual(errorMessage, "No workspace folder is open");
    });

    test("should do nothing when user cancels input", async () => {
        vscode.window.showInputBox = async () => undefined;

        let progressCalled = false;
        (vscode.window.withProgress as any) = async () => {
            progressCalled = true;
            return undefined;
        };

        await convertEolToLf();

        assert.strictEqual(progressCalled, false, "Should not start conversion when user cancels");
    });

    test("should show message when no files found", async () => {
        vscode.window.showInputBox = async () => "**/*.nonexistent";
        vscode.workspace.findFiles = async () => [];

        let infoMessage = "";
        vscode.window.showInformationMessage = async (message: string) => {
            infoMessage = message;
            return undefined;
        };

        await convertEolToLf();

        assert.strictEqual(infoMessage, "No files found matching the glob pattern");
    });

    test("should convert CRLF to LF", async () => {
        const fileContent = "line1\r\nline2\r\nline3\r\n";
        await createFileStructure({
            "test.txt": fileContent,
        });

        const testFile = vscode.Uri.file(path.join(tempDir, "test.txt"));

        vscode.window.showInputBox = async () => "test.txt";
        vscode.workspace.findFiles = async () => [testFile];

        let infoMessage = "";
        vscode.window.showInformationMessage = async (message: string) => {
            infoMessage = message;
            return undefined;
        };

        // Mock withProgress to execute the task immediately
        (vscode.window.withProgress as any) = async (_: any, task: any) => {
            const progress = {
                report: () => {},
            };
            const token = {
                isCancellationRequested: false,
                onCancellationRequested: () => ({ dispose: () => {} }),
            };
            return await task(progress, token);
        };

        await convertEolToLf();

        const convertedContent = fs.readFileSync(testFile.fsPath, "utf-8");
        assert.strictEqual(convertedContent, "line1\nline2\nline3\n", "Should convert CRLF to LF");
        assert.ok(infoMessage.includes("1 file(s) converted"), "Should show success message");
    });

    test("should convert CR to LF", async () => {
        const fileContent = "line1\rline2\rline3\r";
        await createFileStructure({
            "test.txt": fileContent,
        });

        const testFile = vscode.Uri.file(path.join(tempDir, "test.txt"));

        vscode.window.showInputBox = async () => "test.txt";
        vscode.workspace.findFiles = async () => [testFile];

        vscode.window.showInformationMessage = async () => undefined;

        (vscode.window.withProgress as any) = async (_: any, task: any) => {
            const progress = { report: () => {} };
            const token = {
                isCancellationRequested: false,
                onCancellationRequested: () => ({ dispose: () => {} }),
            };
            return await task(progress, token);
        };

        await convertEolToLf();

        const convertedContent = fs.readFileSync(testFile.fsPath, "utf-8");
        assert.strictEqual(convertedContent, "line1\nline2\nline3\n", "Should convert CR to LF");
    });

    test("should not modify files that already have LF", async () => {
        const fileContent = "line1\nline2\nline3\n";
        await createFileStructure({
            "test.txt": fileContent,
        });

        const testFile = vscode.Uri.file(path.join(tempDir, "test.txt"));

        vscode.window.showInputBox = async () => "test.txt";
        vscode.workspace.findFiles = async () => [testFile];

        let infoMessage = "";
        vscode.window.showInformationMessage = async (message: string) => {
            infoMessage = message;
            return undefined;
        };

        (vscode.window.withProgress as any) = async (_: any, task: any) => {
            const progress = { report: () => {} };
            const token = {
                isCancellationRequested: false,
                onCancellationRequested: () => ({ dispose: () => {} }),
            };
            return await task(progress, token);
        };

        await convertEolToLf();

        const convertedContent = fs.readFileSync(testFile.fsPath, "utf-8");
        assert.strictEqual(convertedContent, fileContent, "Should not modify files with LF");
        assert.ok(infoMessage.includes("0 file(s) converted"), "Should report 0 files converted");
        assert.ok(infoMessage.includes("1 file(s) unchanged"), "Should report 1 file unchanged");
    });

    test("should convert multiple files", async () => {
        await createFileStructure({
            "file1.txt": "content1\r\n",
            "file2.txt": "content2\r\n",
            "file3.txt": "content3\n", // Already LF
        });

        const files = [
            vscode.Uri.file(path.join(tempDir, "file1.txt")),
            vscode.Uri.file(path.join(tempDir, "file2.txt")),
            vscode.Uri.file(path.join(tempDir, "file3.txt")),
        ];

        vscode.window.showInputBox = async () => "*.txt";
        vscode.workspace.findFiles = async () => files;

        let infoMessage = "";
        vscode.window.showInformationMessage = async (message: string) => {
            infoMessage = message;
            return undefined;
        };

        (vscode.window.withProgress as any) = async (_: any, task: any) => {
            const progress = { report: () => {} };
            const token = {
                isCancellationRequested: false,
                onCancellationRequested: () => ({ dispose: () => {} }),
            };
            return await task(progress, token);
        };

        await convertEolToLf();

        assert.strictEqual(fs.readFileSync(files[0].fsPath, "utf-8"), "content1\n");
        assert.strictEqual(fs.readFileSync(files[1].fsPath, "utf-8"), "content2\n");
        assert.strictEqual(fs.readFileSync(files[2].fsPath, "utf-8"), "content3\n");
        assert.ok(infoMessage.includes("2 file(s) converted"), "Should report 2 files converted");
        assert.ok(infoMessage.includes("1 file(s) unchanged"), "Should report 1 file unchanged");
    });

    test("should handle cancellation", async () => {
        await createFileStructure({
            "file1.txt": "content1\r\n",
            "file2.txt": "content2\r\n",
        });

        const files = [
            vscode.Uri.file(path.join(tempDir, "file1.txt")),
            vscode.Uri.file(path.join(tempDir, "file2.txt")),
        ];

        vscode.window.showInputBox = async () => "*.txt";
        vscode.workspace.findFiles = async () => files;

        let warningMessage = "";
        vscode.window.showWarningMessage = async (message: string) => {
            warningMessage = message;
            return undefined;
        };

        (vscode.window.withProgress as any) = async (_: any, task: any) => {
            const progress = { report: () => {} };
            const token = {
                isCancellationRequested: true, // Simulate cancellation
                onCancellationRequested: () => ({ dispose: () => {} }),
            };
            return await task(progress, token);
        };

        await convertEolToLf();

        assert.strictEqual(warningMessage, "EOL conversion cancelled");
    });

    test("should handle file read errors gracefully", async () => {
        await createFileStructure({
            "good-file.txt": "content\r\n",
        });

        const goodFile = vscode.Uri.file(path.join(tempDir, "good-file.txt"));
        const badFile = vscode.Uri.file(path.join(tempDir, "nonexistent.txt"));

        vscode.window.showInputBox = async () => "*.txt";
        vscode.workspace.findFiles = async () => [goodFile, badFile];

        let warningMessage = "";
        vscode.window.showWarningMessage = async (message: string, ..._: any[]) => {
            warningMessage = message;
            return undefined;
        };

        (vscode.window.withProgress as any) = async (_: any, task: any) => {
            const progress = { report: () => {} };
            const token = {
                isCancellationRequested: false,
                onCancellationRequested: () => ({ dispose: () => {} }),
            };
            return await task(progress, token);
        };

        await convertEolToLf();

        assert.ok(warningMessage.includes("1 file(s) converted"), "Should report converted file");
        assert.ok(warningMessage.includes("1 error(s)"), "Should report error count");
    });
});

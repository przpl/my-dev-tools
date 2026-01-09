import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";

// Mock child_process before importing quickCommit
const childProcessModule = require("child_process");
const originalExec = childProcessModule.exec;
let mockExecImpl: ((cmd: string, options: any, callback: any) => void) | null = null;

childProcessModule.exec = function (cmd: string, options: any, callback: any) {
    if (mockExecImpl) {
        return mockExecImpl(cmd, options, callback);
    }
    return originalExec.apply(this, arguments);
};

import { quickCommit } from "../../../features/git/quickCommit";

suite("QuickCommit Tests", () => {
    let originalShowErrorMessage: typeof vscode.window.showErrorMessage;
    let originalShowInputBox: typeof vscode.window.showInputBox;
    let originalShowInformationMessage: typeof vscode.window.showInformationMessage;

    setup(() => {
        originalShowErrorMessage = vscode.window.showErrorMessage;
        originalShowInputBox = vscode.window.showInputBox;
        originalShowInformationMessage = vscode.window.showInformationMessage;
    });

    teardown(() => {
        mockExecImpl = null;
        vscode.window.showErrorMessage = originalShowErrorMessage;
        vscode.window.showInputBox = originalShowInputBox;
        vscode.window.showInformationMessage = originalShowInformationMessage;
    });

    function createMockResourceState(filePath: string): vscode.SourceControlResourceState {
        return {
            resourceUri: vscode.Uri.file(filePath),
        };
    }

    test("should show error when no files are selected", async () => {
        let errorMessage = "";
        vscode.window.showErrorMessage = async (message: string) => {
            errorMessage = message;
            return undefined;
        };

        await quickCommit();

        assert.strictEqual(errorMessage, "No files selected for Quick Commit.");
    });

    test("should commit multiple files with correct git commands", async () => {
        const gitRoot = path.normalize("/projects/repo1");
        let gitCommands: string[] = [];

        mockExecImpl = (cmd: string, options: any, callback: any) => {
            gitCommands.push(cmd);
            if (cmd.includes("rev-parse --show-toplevel")) {
                callback(null, { stdout: gitRoot, stderr: "" });
            } else if (cmd.includes("status --porcelain")) {
                callback(null, { stdout: " M file1.ts\n M file2.ts\n", stderr: "" });
            } else {
                callback(null, { stdout: "", stderr: "" });
            }
        };

        vscode.window.showInputBox = async () => "Test commit";
        vscode.window.showInformationMessage = async () => undefined;

        const file1 = createMockResourceState(path.join(gitRoot, "file1.ts"));
        const file2 = createMockResourceState(path.join(gitRoot, "file2.ts"));

        await quickCommit(file1, file2);

        // Should call: git rev-parse (x2), git status, git add, git commit
        assert.ok(gitCommands.some(cmd => cmd.includes("git add")), "Should stage files");
        assert.ok(gitCommands.some(cmd => cmd.includes("git commit")), "Should commit files");
        const commitCmd = gitCommands.find(cmd => cmd.includes("git commit"));
        assert.ok(commitCmd?.includes("file1.ts") && commitCmd?.includes("file2.ts"), "Should commit both files");
    });

    test("should preserve already staged files", async () => {
        const gitRoot = path.normalize("/projects/repo1");
        let gitCommands: string[] = [];

        mockExecImpl = (cmd: string, options: any, callback: any) => {
            gitCommands.push(cmd);
            if (cmd.includes("rev-parse --show-toplevel")) {
                callback(null, { stdout: gitRoot, stderr: "" });
            } else if (cmd.includes("status --porcelain")) {
                // already-staged.ts is staged (M in first column), new-file.ts is unstaged
                callback(null, { stdout: "M  already-staged.ts\n M new-file.ts\n", stderr: "" });
            } else {
                callback(null, { stdout: "", stderr: "" });
            }
        };

        vscode.window.showInputBox = async () => "Commit new file";
        vscode.window.showInformationMessage = async () => undefined;

        const newFile = createMockResourceState(path.join(gitRoot, "new-file.ts"));
        await quickCommit(newFile);

        const addCommands = gitCommands.filter(cmd => cmd.includes("git add"));
        // Should add new-file.ts, then re-add already-staged.ts after commit
        assert.strictEqual(addCommands.length, 2, "Should call git add twice to restore staged files");
        assert.ok(addCommands[1].includes("already-staged.ts"), "Should restore previously staged file");
    });

    test("should handle commit errors", async () => {
        const gitRoot = path.normalize("/projects/repo1");
        let errorMessage = "";

        mockExecImpl = (cmd: string, options: any, callback: any) => {
            if (cmd.includes("rev-parse --show-toplevel")) {
                callback(null, { stdout: gitRoot, stderr: "" });
            } else if (cmd.includes("status --porcelain")) {
                callback(null, { stdout: " M file.ts\n", stderr: "" });
            } else if (cmd.includes("git commit")) {
                callback(new Error("nothing to commit"), { stdout: "", stderr: "nothing to commit" });
            } else {
                callback(null, { stdout: "", stderr: "" });
            }
        };

        vscode.window.showInputBox = async () => "Test";
        vscode.window.showErrorMessage = async (msg: string) => {
            errorMessage = msg;
            return undefined;
        };

        const file = createMockResourceState(path.join(gitRoot, "file.ts"));
        await quickCommit(file);

        assert.ok(errorMessage.includes("Quick Commit failed"), "Should show error");
        assert.ok(errorMessage.includes("nothing to commit"), "Should include git error message");
    });

    test("should not commit when user cancels", async () => {
        const gitRoot = path.normalize("/projects/repo1");
        let commitCalled = false;

        mockExecImpl = (cmd: string, options: any, callback: any) => {
            if (cmd.includes("git commit")) {
                commitCalled = true;
            }
            if (cmd.includes("rev-parse --show-toplevel")) {
                callback(null, { stdout: gitRoot, stderr: "" });
            } else {
                callback(null, { stdout: "", stderr: "" });
            }
        };

        vscode.window.showInputBox = async () => undefined; // User cancels

        const file = createMockResourceState(path.join(gitRoot, "file.ts"));
        await quickCommit(file);

        assert.strictEqual(commitCalled, false, "Should not commit when user cancels");
    });

    test("should show success message with correct file count", async () => {
        const gitRoot = path.normalize("/projects/repo1");
        let infoMessage = "";

        mockExecImpl = (cmd: string, options: any, callback: any) => {
            if (cmd.includes("rev-parse --show-toplevel")) {
                callback(null, { stdout: gitRoot, stderr: "" });
            } else if (cmd.includes("status --porcelain")) {
                callback(null, { stdout: " M f1.ts\n M f2.ts\n M f3.ts\n", stderr: "" });
            } else {
                callback(null, { stdout: "", stderr: "" });
            }
        };

        vscode.window.showInputBox = async () => "Multi file commit";
        vscode.window.showInformationMessage = async (msg: string) => {
            infoMessage = msg;
            return undefined;
        };

        const f1 = createMockResourceState(path.join(gitRoot, "f1.ts"));
        const f2 = createMockResourceState(path.join(gitRoot, "f2.ts"));
        const f3 = createMockResourceState(path.join(gitRoot, "f3.ts"));

        await quickCommit(f1, f2, f3);

        assert.ok(infoMessage.includes("3 files"), "Should show correct file count");
        assert.ok(infoMessage.includes("Successfully committed"), "Should show success message");
    });
});

import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { deleteEmptyDirectories } from "../../features/deleteEmptyDirectories";

suite("DeleteEmptyDirectories Tests", () => {
    let tempDir: string;
    let originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;
    let originalShowWarningMessage: typeof vscode.window.showWarningMessage;
    let originalShowInformationMessage: typeof vscode.window.showInformationMessage;
    let originalShowErrorMessage: typeof vscode.window.showErrorMessage;

    let capturedWarning: string | undefined;
    let capturedInfo: string | undefined;
    let capturedError: string | undefined;
    let warningAnswer: string | undefined;
    let originalWithProgress: typeof vscode.window.withProgress;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-del-empty-"));

        originalWorkspaceFolders = vscode.workspace.workspaceFolders;
        originalShowWarningMessage = vscode.window.showWarningMessage;
        originalShowInformationMessage = vscode.window.showInformationMessage;
        originalShowErrorMessage = vscode.window.showErrorMessage;
        originalWithProgress = vscode.window.withProgress;

        // Execute the task callback immediately without showing any UI
        vscode.window.withProgress = async (_options: any, task: any) => {
            return task({ report: () => {} }, new vscode.CancellationTokenSource().token);
        };

        capturedWarning = undefined;
        capturedInfo = undefined;
        capturedError = undefined;
        warningAnswer = "Delete";

        // Mock workspaceFolders to point to our temp dir
        Object.defineProperty(vscode.workspace, "workspaceFolders", {
            get: () => [{ uri: vscode.Uri.file(tempDir), index: 0, name: "test-workspace" }],
            configurable: true,
        });

        // Mock window messages
        vscode.window.showWarningMessage = async (message: string, ..._items: any[]) => {
            capturedWarning = message;
            return warningAnswer as any;
        };
        vscode.window.showInformationMessage = async (message: string) => {
            capturedInfo = message;
            return undefined as any;
        };
        vscode.window.showErrorMessage = async (message: string) => {
            capturedError = message;
            return undefined as any;
        };
    });

    teardown(() => {
        // Restore original workspaceFolders
        Object.defineProperty(vscode.workspace, "workspaceFolders", {
            get: () => originalWorkspaceFolders,
            configurable: true,
        });
        vscode.window.showWarningMessage = originalShowWarningMessage;
        vscode.window.showInformationMessage = originalShowInformationMessage;
        vscode.window.showErrorMessage = originalShowErrorMessage;
        vscode.window.withProgress = originalWithProgress;

        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test("should delete a single empty directory", async () => {
        const emptyDir = path.join(tempDir, "empty");
        fs.mkdirSync(emptyDir);

        await deleteEmptyDirectories();

        assert.strictEqual(fs.existsSync(emptyDir), false, "Empty directory should be deleted");
        assert.ok(capturedInfo?.includes("1"), "Should report 1 deleted directory");
    });

    test("should not delete a directory containing a regular file", async () => {
        const dir = path.join(tempDir, "with-file");
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, "file.txt"), "content");

        await deleteEmptyDirectories();

        assert.strictEqual(fs.existsSync(dir), true, "Non-empty directory should be kept");
        assert.strictEqual(capturedInfo, "No empty directories found.", "Should report no empty dirs");
    });

    test("should not delete a directory containing a hidden file", async () => {
        const dir = path.join(tempDir, "with-hidden-file");
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, ".gitkeep"), "");

        await deleteEmptyDirectories();

        assert.strictEqual(fs.existsSync(dir), true, "Directory with hidden file should be kept");
        assert.strictEqual(capturedInfo, "No empty directories found.", "Should report no empty dirs");
    });

    test("should delete nested empty directories bottom-up", async () => {
        // A/B/C — all empty
        const dirA = path.join(tempDir, "A");
        const dirB = path.join(dirA, "B");
        const dirC = path.join(dirB, "C");
        fs.mkdirSync(dirC, { recursive: true });

        await deleteEmptyDirectories();

        assert.strictEqual(fs.existsSync(dirC), false, "Deepest dir C should be deleted");
        assert.strictEqual(fs.existsSync(dirB), false, "Dir B should be deleted");
        assert.strictEqual(fs.existsSync(dirA), false, "Dir A should be deleted");
        assert.ok(capturedInfo?.includes("3"), "Should report 3 deleted directories");
    });

    test("should only delete empty sibling, keep non-empty sibling", async () => {
        const emptyDir = path.join(tempDir, "empty-sibling");
        const nonEmptyDir = path.join(tempDir, "non-empty-sibling");
        fs.mkdirSync(emptyDir);
        fs.mkdirSync(nonEmptyDir);
        fs.writeFileSync(path.join(nonEmptyDir, "file.txt"), "content");

        await deleteEmptyDirectories();

        assert.strictEqual(fs.existsSync(emptyDir), false, "Empty sibling should be deleted");
        assert.strictEqual(fs.existsSync(nonEmptyDir), true, "Non-empty sibling should be kept");
        assert.ok(capturedInfo?.includes("1"), "Should report 1 deleted directory");
    });

    test("should delete empty subdir but keep parent that has a file", async () => {
        const parentDir = path.join(tempDir, "parent");
        const emptySubDir = path.join(parentDir, "empty-child");
        fs.mkdirSync(emptySubDir, { recursive: true });
        fs.writeFileSync(path.join(parentDir, "file.txt"), "content");

        await deleteEmptyDirectories();

        assert.strictEqual(fs.existsSync(emptySubDir), false, "Empty child dir should be deleted");
        assert.strictEqual(fs.existsSync(parentDir), true, "Parent with file should be kept");
        assert.ok(capturedInfo?.includes("1"), "Should report 1 deleted directory");
    });

    test("should show 'no empty directories' message when none found", async () => {
        fs.writeFileSync(path.join(tempDir, "root-file.ts"), "export {}");

        await deleteEmptyDirectories();

        assert.strictEqual(capturedInfo, "No empty directories found.", "Should show no empty dirs message");
        assert.strictEqual(capturedWarning, undefined, "Should not show confirmation when nothing to delete");
    });

    test("should not delete anything when user cancels confirmation", async () => {
        warningAnswer = "Cancel";
        const emptyDir = path.join(tempDir, "empty");
        fs.mkdirSync(emptyDir);

        await deleteEmptyDirectories();

        assert.strictEqual(fs.existsSync(emptyDir), true, "Directory should not be deleted on cancel");
        assert.strictEqual(capturedInfo, undefined, "Should not show success message on cancel");
    });

    test("should show error when no workspace folder is open", async () => {
        Object.defineProperty(vscode.workspace, "workspaceFolders", {
            get: () => undefined,
            configurable: true,
        });

        await deleteEmptyDirectories();

        assert.strictEqual(capturedError, "No workspace folder is open.", "Should show error when no workspace");
    });

    test("should not delete the workspace root even if it were logically empty", async () => {
        // Workspace root contains only an empty subdir → subdir deleted, root preserved
        const emptySubDir = path.join(tempDir, "to-delete");
        fs.mkdirSync(emptySubDir);

        await deleteEmptyDirectories();

        assert.strictEqual(fs.existsSync(emptySubDir), false, "Empty subdir should be deleted");
        assert.strictEqual(fs.existsSync(tempDir), true, "Workspace root should never be deleted");
    });

    test("should not delete a directory matching a .gitignore pattern", async () => {
        fs.writeFileSync(path.join(tempDir, ".gitignore"), "node_modules\n");
        const ignoredDir = path.join(tempDir, "node_modules");
        fs.mkdirSync(ignoredDir);

        await deleteEmptyDirectories();

        assert.strictEqual(fs.existsSync(ignoredDir), true, "Ignored directory should not be deleted");
        assert.strictEqual(capturedInfo, "No empty directories found.", "Should report no deletable empty dirs");
    });

    test("should not delete parent whose only subdir is gitignore-ignored", async () => {
        fs.writeFileSync(path.join(tempDir, ".gitignore"), "node_modules\n");
        const parentDir = path.join(tempDir, "project");
        const ignoredSubDir = path.join(parentDir, "node_modules");
        fs.mkdirSync(ignoredSubDir, { recursive: true });

        await deleteEmptyDirectories();

        assert.strictEqual(fs.existsSync(ignoredSubDir), true, "Ignored subdir should not be deleted");
        assert.strictEqual(fs.existsSync(parentDir), true, "Parent of ignored dir should not be deleted");
        assert.strictEqual(capturedInfo, "No empty directories found.", "Should report no deletable empty dirs");
    });

    test("should delete empty sibling but keep parent that also contains an ignored directory", async () => {
        fs.writeFileSync(path.join(tempDir, ".gitignore"), "node_modules\n");
        const parentDir = path.join(tempDir, "project");
        const ignoredSubDir = path.join(parentDir, "node_modules");
        const emptySubDir = path.join(parentDir, "empty");
        fs.mkdirSync(ignoredSubDir, { recursive: true });
        fs.mkdirSync(emptySubDir, { recursive: true });

        await deleteEmptyDirectories();

        assert.strictEqual(fs.existsSync(emptySubDir), false, "Empty subdir should be deleted");
        assert.strictEqual(fs.existsSync(ignoredSubDir), true, "Ignored subdir should be kept");
        assert.strictEqual(fs.existsSync(parentDir), true, "Parent should be kept");
    });

    test("should support root-relative gitignore pattern", async () => {
        fs.writeFileSync(path.join(tempDir, ".gitignore"), "/dist\n");
        const distDir = path.join(tempDir, "dist");
        fs.mkdirSync(distDir);

        await deleteEmptyDirectories();

        assert.strictEqual(fs.existsSync(distDir), true, "Root-relative pattern /dist should not be deleted");
    });

    test("should delete dir matching gitignore directory name when .gitignore has trailing slash pattern", async () => {
        fs.writeFileSync(path.join(tempDir, ".gitignore"), "cache/\n");
        const cacheDir = path.join(tempDir, "cache");
        fs.mkdirSync(cacheDir);

        await deleteEmptyDirectories();

        assert.strictEqual(fs.existsSync(cacheDir), true, "Trailing-slash gitignore pattern should exclude the directory");
    });
});

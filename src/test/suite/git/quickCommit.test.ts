import * as assert from "assert";
import * as vscode from "vscode";
import { quickCommit } from "../../../features/git/quickCommit";

suite("QuickCommit Tests", () => {
    let originalGetExtension: typeof vscode.extensions.getExtension;
    let originalShowErrorMessage: typeof vscode.window.showErrorMessage;
    let originalShowInputBox: typeof vscode.window.showInputBox;
    let originalShowInformationMessage: typeof vscode.window.showInformationMessage;

    setup(() => {
        // Store original methods
        originalGetExtension = vscode.extensions.getExtension;
        originalShowErrorMessage = vscode.window.showErrorMessage;
        originalShowInputBox = vscode.window.showInputBox;
        originalShowInformationMessage = vscode.window.showInformationMessage;
    });

    teardown(() => {
        // Restore original methods
        (vscode.extensions as any).getExtension = originalGetExtension;
        vscode.window.showErrorMessage = originalShowErrorMessage;
        vscode.window.showInputBox = originalShowInputBox;
        vscode.window.showInformationMessage = originalShowInformationMessage;
    });

    function createMockGitExtension(repositories: any[]) {
        return {
            isActive: true,
            exports: {
                getAPI: (version: number) => ({
                    repositories,
                }),
            },
        };
    }

    function createMockRepository(
        rootPath: string,
        addFn?: (paths: string[]) => Promise<void>,
        commitFn?: (message: string) => Promise<void>
    ) {
        return {
            rootUri: vscode.Uri.file(rootPath),
            state: {
                workingTreeChanges: [],
                indexChanges: [],
                mergeChanges: [],
            },
            add: addFn || (async () => {}),
            commit: commitFn || (async () => {}),
        };
    }

    function createMockResourceState(filePath: string): vscode.SourceControlResourceState {
        return {
            resourceUri: vscode.Uri.file(filePath),
        };
    }

    test("should show error when Git extension is not found", async () => {
        let errorMessage = "";
        vscode.window.showErrorMessage = async (message: string) => {
            errorMessage = message;
            return undefined;
        };

        (vscode.extensions as any).getExtension = () => undefined;

        await quickCommit();

        assert.strictEqual(errorMessage, "Git extension not found.");
    });

    test("should show error when Git extension is not active", async () => {
        let errorMessage = "";
        vscode.window.showErrorMessage = async (message: string) => {
            errorMessage = message;
            return undefined;
        };

        (vscode.extensions as any).getExtension = () => ({
            isActive: false,
            exports: null,
        });

        await quickCommit();

        assert.strictEqual(errorMessage, "Git extension is not active.");
    });

    test("should show error when no repositories found", async () => {
        let errorMessage = "";
        vscode.window.showErrorMessage = async (message: string) => {
            errorMessage = message;
            return undefined;
        };

        (vscode.extensions as any).getExtension = () => createMockGitExtension([]);

        await quickCommit();

        assert.strictEqual(errorMessage, "No Git repositories found.");
    });

    test("should show error when no files are selected", async () => {
        let errorMessage = "";
        vscode.window.showErrorMessage = async (message: string) => {
            errorMessage = message;
            return undefined;
        };

        const mockRepo = createMockRepository("/projects/repo1");
        (vscode.extensions as any).getExtension = () => createMockGitExtension([mockRepo]);

        await quickCommit();

        assert.strictEqual(errorMessage, "No files selected for Quick Commit.");
    });

    test("should show error when repository for file is not found", async () => {
        let errorMessage = "";
        vscode.window.showErrorMessage = async (message: string) => {
            errorMessage = message;
            return undefined;
        };

        const mockRepo = createMockRepository("/projects/repo1");
        (vscode.extensions as any).getExtension = () => createMockGitExtension([mockRepo]);

        // File is in a different path that doesn't match the repo
        const resourceState = createMockResourceState("c:/other-location/file.ts");

        await quickCommit(resourceState, [resourceState]);

        assert.strictEqual(errorMessage, "Could not find Git repository for selected files.");
    });

    test("should show error when selected files are from different repositories", async () => {
        let errorMessage = "";
        vscode.window.showErrorMessage = async (message: string) => {
            errorMessage = message;
            return undefined;
        };

        const mockRepo1 = createMockRepository("/projects/repo1");
        const mockRepo2 = createMockRepository("/projects/repo2");
        (vscode.extensions as any).getExtension = () => createMockGitExtension([mockRepo1, mockRepo2]);

        // Files from different repositories
        const resourceState1 = createMockResourceState("/projects/repo1/file1.ts");
        const resourceState2 = createMockResourceState("/projects/repo2/file2.ts");

        await quickCommit(resourceState1, [resourceState1, resourceState2]);

        assert.strictEqual(errorMessage, "Selected files must be from the same repository.");
    });

    test("should not stage or commit when user cancels input box", async () => {
        let addCalled = false;
        let commitCalled = false;

        const mockRepo = createMockRepository(
            "/projects/repo1",
            async () => { addCalled = true; },
            async () => { commitCalled = true; }
        );
        (vscode.extensions as any).getExtension = () => createMockGitExtension([mockRepo]);

        vscode.window.showInputBox = async () => undefined; // User cancels

        const resourceState = createMockResourceState("/projects/repo1/file.ts");

        await quickCommit(resourceState, [resourceState]);

        assert.strictEqual(addCalled, false, "Should not call add when user cancels");
        assert.strictEqual(commitCalled, false, "Should not call commit when user cancels");
    });

    test("should stage and commit files successfully", async () => {
        let addedPaths: string[] = [];
        let commitMessage = "";
        let infoMessage = "";

        const mockRepo = createMockRepository(
            "/projects/repo1",
            async (paths: string[]) => { addedPaths = paths; },
            async (message: string) => { commitMessage = message; }
        );
        (vscode.extensions as any).getExtension = () => createMockGitExtension([mockRepo]);

        vscode.window.showInputBox = async () => "Test commit message";
        vscode.window.showInformationMessage = async (message: string) => {
            infoMessage = message;
            return undefined;
        };

        const resourceState = createMockResourceState("/projects/repo1/file.ts");

        await quickCommit(resourceState, [resourceState]);

        assert.strictEqual(addedPaths.length, 1, "Should add one file");
        assert.strictEqual(commitMessage, "Test commit message", "Should commit with correct message");
        assert.strictEqual(infoMessage, "Quick Commit: Successfully committed 1 file.");
    });

    test("should stage and commit multiple files successfully", async () => {
        let addedPaths: string[] = [];
        let commitMessage = "";
        let infoMessage = "";

        const mockRepo = createMockRepository(
            "/projects/repo1",
            async (paths: string[]) => { addedPaths = paths; },
            async (message: string) => { commitMessage = message; }
        );
        (vscode.extensions as any).getExtension = () => createMockGitExtension([mockRepo]);

        vscode.window.showInputBox = async () => "Multiple files commit";
        vscode.window.showInformationMessage = async (message: string) => {
            infoMessage = message;
            return undefined;
        };

        const resourceState1 = createMockResourceState("/projects/repo1/file1.ts");
        const resourceState2 = createMockResourceState("/projects/repo1/file2.ts");
        const resourceState3 = createMockResourceState("/projects/repo1/src/file3.ts");

        await quickCommit(resourceState1, [resourceState1, resourceState2, resourceState3]);

        assert.strictEqual(addedPaths.length, 3, "Should add three files");
        assert.strictEqual(commitMessage, "Multiple files commit", "Should commit with correct message");
        assert.strictEqual(infoMessage, "Quick Commit: Successfully committed 3 files.");
    });

    test("should show error when commit fails", async () => {
        let errorMessage = "";

        const mockRepo = createMockRepository(
            "/projects/repo1",
            async () => {},
            async () => { throw new Error("Commit failed: nothing to commit"); }
        );
        (vscode.extensions as any).getExtension = () => createMockGitExtension([mockRepo]);

        vscode.window.showInputBox = async () => "Test commit";
        vscode.window.showErrorMessage = async (message: string) => {
            errorMessage = message;
            return undefined;
        };

        const resourceState = createMockResourceState("/projects/repo1/file.ts");

        await quickCommit(resourceState, [resourceState]);

        assert.strictEqual(errorMessage, "Quick Commit failed: Commit failed: nothing to commit");
    });

    test("should handle single file selection without array argument", async () => {
        let addedPaths: string[] = [];
        let commitMessage = "";

        const mockRepo = createMockRepository(
            "/projects/repo1",
            async (paths: string[]) => { addedPaths = paths; },
            async (message: string) => { commitMessage = message; }
        );
        (vscode.extensions as any).getExtension = () => createMockGitExtension([mockRepo]);

        vscode.window.showInputBox = async () => "Single file commit";
        vscode.window.showInformationMessage = async () => undefined;

        const resourceState = createMockResourceState("/projects/repo1/file.ts");

        // Pass only single resourceState without array (simulating single click)
        await quickCommit(resourceState);

        assert.strictEqual(addedPaths.length, 1, "Should add one file");
        assert.strictEqual(commitMessage, "Single file commit", "Should commit with correct message");
    });

    test("should trim commit message whitespace", async () => {
        let commitMessage = "";

        const mockRepo = createMockRepository(
            "/projects/repo1",
            async () => {},
            async (message: string) => { commitMessage = message; }
        );
        (vscode.extensions as any).getExtension = () => createMockGitExtension([mockRepo]);

        vscode.window.showInputBox = async () => "  Commit with spaces  ";
        vscode.window.showInformationMessage = async () => undefined;

        const resourceState = createMockResourceState("/projects/repo1/file.ts");

        await quickCommit(resourceState, [resourceState]);

        assert.strictEqual(commitMessage, "Commit with spaces", "Should trim commit message");
    });
});

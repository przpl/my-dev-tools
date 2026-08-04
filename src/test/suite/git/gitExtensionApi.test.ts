import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";

import { resolveRepository, type GitRepository } from "../../../features/git/gitExtensionApi";

/**
 * Which repository a command acts on, in a window that has several. Every branch here decides where
 * a commit message is written, and none of them is reachable from a single-repository test window,
 * so the built-in Git extension's API is stood in for.
 */
suite("GitExtensionApi Tests", () => {
    let originalGetExtension: typeof vscode.extensions.getExtension;
    let originalShowQuickPick: typeof vscode.window.showQuickPick;
    let originalActiveTextEditor: vscode.TextEditor | undefined;

    setup(() => {
        originalGetExtension = vscode.extensions.getExtension;
        originalShowQuickPick = vscode.window.showQuickPick;
        originalActiveTextEditor = vscode.window.activeTextEditor;
    });

    teardown(() => {
        vscode.extensions.getExtension = originalGetExtension;
        vscode.window.showQuickPick = originalShowQuickPick;
        setActiveEditor(originalActiveTextEditor);
    });

    function repository(root: string): GitRepository {
        return { rootUri: vscode.Uri.file(root), inputBox: { value: "" } };
    }

    /** Stands in for the built-in Git extension, active and holding exactly these repositories. */
    function stubGitExtension(...repositories: GitRepository[]): void {
        const api = { repositories };
        vscode.extensions.getExtension = (() => ({ isActive: true, exports: { getAPI: () => api } })) as unknown as typeof vscode.extensions.getExtension;
    }

    function setActiveEditor(editor: vscode.TextEditor | undefined): void {
        Object.defineProperty(vscode.window, "activeTextEditor", { value: editor, configurable: true });
    }

    function activeFile(filePath: string): void {
        setActiveEditor({ document: { uri: vscode.Uri.file(filePath) } } as vscode.TextEditor);
    }

    test("should take the repository the menu handed over", async () => {
        const clicked = repository(path.join("C:", "work", "clicked"));
        stubGitExtension(repository(path.join("C:", "work", "other")));

        assert.strictEqual(await resolveRepository([clicked]), clicked);
    });

    test("should take the only repository in the window", async () => {
        const only = repository(path.join("C:", "work", "only"));
        stubGitExtension(only);

        assert.strictEqual(await resolveRepository([]), only);
    });

    test("should have nothing to resolve without a repository", async () => {
        stubGitExtension();

        assert.strictEqual(await resolveRepository([]), undefined);
    });

    test("should take the innermost repository containing the active file", async () => {
        // A submodule or a nested checkout: the file belongs to both, and the longer root is the one
        // whose commit the author is looking at.
        const outer = repository(path.join("C:", "work", "outer"));
        const inner = repository(path.join("C:", "work", "outer", "inner"));
        stubGitExtension(outer, inner);
        activeFile(path.join("C:", "work", "outer", "inner", "src", "app.ts"));

        vscode.window.showQuickPick = (async () => {
            throw new Error("The active file settles this without asking");
        }) as typeof vscode.window.showQuickPick;

        assert.strictEqual(await resolveRepository([]), inner);
    });

    test("should ask when the active file settles nothing", async () => {
        const first = repository(path.join("C:", "work", "first"));
        const second = repository(path.join("C:", "work", "second"));
        stubGitExtension(first, second);
        activeFile(path.join("C:", "elsewhere", "app.ts"));

        let offered: string[] = [];
        vscode.window.showQuickPick = (async (items: { label: string; repository: GitRepository }[]) => {
            offered = items.map(item => item.label);
            return items[1];
        }) as unknown as typeof vscode.window.showQuickPick;

        assert.strictEqual(await resolveRepository([]), second);
        assert.strictEqual(offered.length, 2);
    });

    test("should resolve to nothing when the pick is dismissed", async () => {
        stubGitExtension(repository(path.join("C:", "work", "first")), repository(path.join("C:", "work", "second")));
        setActiveEditor(undefined);

        vscode.window.showQuickPick = (async () => undefined) as typeof vscode.window.showQuickPick;

        assert.strictEqual(await resolveRepository([]), undefined);
    });
});

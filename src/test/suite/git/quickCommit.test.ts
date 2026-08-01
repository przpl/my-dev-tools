import * as assert from "assert";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

import { COMMIT_EDITOR_FILE_NAME, acceptCommitMessage, generateCommitMessageInEditor } from "../../../features/git/commitMessageEditor";
import { quickCommit } from "../../../features/git/quickCommit";

function git(cwd: string, args: string[]): string {
    return cp.execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });
}

function write(repo: string, relativePath: string, content: string): void {
    const target = path.join(repo, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function typeCommitMessage(editor: vscode.TextEditor, message: string): Promise<void> {
    const document = editor.document;
    await editor.edit(builder => builder.replace(new vscode.Range(0, 0, 0, document.lineAt(0).text.length), message));
}

async function closeCommitEditor(editor: vscode.TextEditor): Promise<void> {
    await vscode.window.showTextDocument(editor.document, { preview: false });
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
}

suite("QuickCommit Tests", () => {
    let repo: string;
    let originalShowErrorMessage: typeof vscode.window.showErrorMessage;
    let originalShowInputBox: typeof vscode.window.showInputBox;
    let originalShowInformationMessage: typeof vscode.window.showInformationMessage;
    let originalShowWarningMessage: typeof vscode.window.showWarningMessage;

    setup(() => {
        originalShowErrorMessage = vscode.window.showErrorMessage;
        originalShowInputBox = vscode.window.showInputBox;
        originalShowInformationMessage = vscode.window.showInformationMessage;
        originalShowWarningMessage = vscode.window.showWarningMessage;

        repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vscode-quick-commit-")));

        git(repo, ["init", "-q", "."]);
        git(repo, ["config", "user.email", "test@example.com"]);
        git(repo, ["config", "user.name", "Test"]);
    });

    teardown(async () => {
        vscode.window.showErrorMessage = originalShowErrorMessage;
        vscode.window.showInputBox = originalShowInputBox;
        vscode.window.showInformationMessage = originalShowInformationMessage;
        vscode.window.showWarningMessage = originalShowWarningMessage;

        await vscode.commands.executeCommand("workbench.action.closeAllEditors");

        try {
            fs.rmSync(repo, { recursive: true, force: true });
        } catch {
            // Windows can hold locks on the git directory; leaving the temp folder behind is harmless.
        }
    });

    function resource(relativePath: string): vscode.SourceControlResourceState {
        return { resourceUri: vscode.Uri.file(path.join(repo, relativePath)) };
    }

    function commitEditorPath(): string {
        return path.join(repo, ".git", COMMIT_EDITOR_FILE_NAME);
    }

    /**
     * This repository's editor specifically. A previous test's editor can still be visible when the
     * next one starts, and matching it by name alone made the tests act on a finished session.
     */
    function findCommitEditor(): vscode.TextEditor | undefined {
        const expected = vscode.Uri.file(commitEditorPath()).toString();
        return vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === expected);
    }

    /** The prompt opens a real editor, so the tests wait for it rather than stubbing an input box. */
    async function waitForCommitEditor(): Promise<vscode.TextEditor> {
        for (let attempt = 0; attempt < 100; attempt++) {
            const editor = findCommitEditor();
            if (editor) {
                return editor;
            }
            await delay(50);
        }

        throw new Error("The commit message editor never opened");
    }

    async function waitForCommitEditorToClose(): Promise<void> {
        for (let attempt = 0; attempt < 100 && findCommitEditor(); attempt++) {
            await delay(50);
        }
    }

    function captureErrorMessage(): () => string {
        let message = "";
        vscode.window.showErrorMessage = async (value: string) => {
            message = value;
            return undefined;
        };
        return () => message;
    }

    function captureInformationMessage(): () => string {
        let message = "";
        vscode.window.showInformationMessage = async (value: string) => {
            message = value;
            return undefined;
        };
        return () => message;
    }

    function captureWarningMessage(): () => string {
        let message = "";
        vscode.window.showWarningMessage = async (value: string) => {
            message = value;
            return undefined;
        };
        return () => message;
    }

    /**
     * Runs Quick Commit and answers its editor. `message === undefined` closes the editor instead,
     * which is how the editor cancels.
     */
    async function runQuickCommit(message: string | undefined, ...resources: vscode.SourceControlResourceState[]): Promise<void> {
        const running = quickCommit(...resources);
        const editor = await waitForCommitEditor();

        if (message === undefined) {
            await closeCommitEditor(editor);
        } else {
            await typeCommitMessage(editor, message);
            await acceptCommitMessage();
        }

        await running;
    }

    function commitAll(): void {
        git(repo, ["add", "-A"]);
        git(repo, ["commit", "-qm", "baseline"]);
    }

    /** Subject lines of every commit, newest first. */
    function subjects(): string[] {
        return git(repo, ["log", "--pretty=%s"])
            .split("\n")
            .filter(line => line.length > 0);
    }

    function lastCommitMessage(): string {
        return git(repo, ["log", "-1", "--pretty=%B"]).replace(/\r\n/g, "\n").trim();
    }

    function stagedPaths(): string[] {
        return git(repo, ["diff", "--cached", "--name-only"])
            .split("\n")
            .filter(line => line.length > 0);
    }

    test("should show error when no files are selected", async () => {
        const errorMessage = captureErrorMessage();

        await quickCommit();

        assert.strictEqual(errorMessage(), "No files selected for Quick Commit.");
    });

    test("should commit multiple files", async () => {
        write(repo, "file1.ts", "const a = 1;\n");
        write(repo, "file2.ts", "const b = 1;\n");
        commitAll();

        write(repo, "file1.ts", "const a = 2;\n");
        write(repo, "file2.ts", "const b = 2;\n");

        captureInformationMessage();

        await runQuickCommit("Test commit", resource("file1.ts"), resource("file2.ts"));

        assert.deepStrictEqual(subjects(), ["Test commit", "baseline"]);
        assert.strictEqual(git(repo, ["status", "--porcelain"]), "", "Working tree should be clean");
    });

    test("should commit an untracked file", async () => {
        write(repo, "seed.ts", "const seed = 1;\n");
        commitAll();

        write(repo, "brand-new.ts", "const isNew = true;\n");

        captureInformationMessage();

        await runQuickCommit("Add new file", resource("brand-new.ts"));

        assert.deepStrictEqual(git(repo, ["show", "--pretty=", "--name-only", "HEAD"]).trim(), "brand-new.ts");
    });

    test("should leave unrelated staged files in the index", async () => {
        write(repo, "already-staged.ts", "const staged = 1;\n");
        write(repo, "selected.ts", "const selected = 1;\n");
        commitAll();

        write(repo, "already-staged.ts", "const staged = 2;\n");
        git(repo, ["add", "already-staged.ts"]);
        write(repo, "selected.ts", "const selected = 2;\n");

        captureInformationMessage();

        await runQuickCommit("Commit only the selection", resource("selected.ts"));

        assert.deepStrictEqual(
            git(repo, ["show", "--pretty=", "--name-only", "HEAD"]).trim(),
            "selected.ts",
            "Only the selected file should be committed"
        );
        assert.deepStrictEqual(stagedPaths(), ["already-staged.ts"], "The other file should stay staged");
    });

    test("should show error when the commit fails", async () => {
        write(repo, "seed.ts", "const seed = 1;\n");
        commitAll();

        const errorMessage = captureErrorMessage();

        await runQuickCommit("Commit a file that is not there", resource("missing.ts"));

        assert.ok(errorMessage().startsWith("Quick Commit failed:"), `Unexpected message: ${errorMessage()}`);
        assert.ok(errorMessage().includes("missing.ts"), "Should include the git error message");
        assert.deepStrictEqual(subjects(), ["baseline"], "Nothing should be committed");
    });

    test("should not commit when user cancels", async () => {
        write(repo, "file.ts", "const a = 1;\n");
        commitAll();

        write(repo, "file.ts", "const a = 2;\n");

        await runQuickCommit(undefined, resource("file.ts")); // User closes the editor

        assert.deepStrictEqual(subjects(), ["baseline"], "Nothing should be committed");
    });

    test("should show success message with correct file count", async () => {
        write(repo, "f1.ts", "const a = 1;\n");
        write(repo, "f2.ts", "const b = 1;\n");
        write(repo, "f3.ts", "const c = 1;\n");

        const infoMessage = captureInformationMessage();

        await runQuickCommit("Multi file commit", resource("f1.ts"), resource("f2.ts"), resource("f3.ts"));

        assert.strictEqual(infoMessage(), "Quick Commit: Successfully committed 3 files.");
    });

    test("should pass commit messages and paths through verbatim", async () => {
        // Spaces and shell metacharacters used to be escaped by hand into a shell command line.
        const message = 'fix: handle "quoted" & $spaced input';
        write(repo, "a file with spaces.ts", "const a = 1;\n");

        captureInformationMessage();

        await runQuickCommit(message, resource("a file with spaces.ts"));

        assert.deepStrictEqual(subjects(), [message]);
        assert.strictEqual(git(repo, ["show", "--pretty=", "--name-only", "HEAD"]).trim(), "a file with spaces.ts");
    });

    suite("commit message editor", () => {
        test("should commit a title and a body", async () => {
            write(repo, "file.ts", "const a = 1;\n");
            captureInformationMessage();

            const message = "feat(git): commit from an editor\n\n- an input box holds one line, a body needs more\n- the editor strips its own comments";

            await runQuickCommit(message, resource("file.ts"));

            assert.strictEqual(lastCommitMessage(), message);
        });

        test("should keep the comment block out of the commit message", async () => {
            write(repo, "file.ts", "const a = 1;\n");
            captureInformationMessage();

            const running = quickCommit(resource("file.ts"));
            const editor = await waitForCommitEditor();

            assert.ok(editor.document.getText().includes("# Committing 1 file:"), "The template should list the selection");
            assert.ok(editor.document.getText().includes("#   file.ts"), "The template should name the file");

            await typeCommitMessage(editor, "docs: describe the change");
            await acceptCommitMessage();
            await running;

            assert.strictEqual(lastCommitMessage(), "docs: describe the change");
        });

        test("should open with the git-commit language mode", async () => {
            write(repo, "file.ts", "const a = 1;\n");
            captureInformationMessage();

            const running = quickCommit(resource("file.ts"));
            const editor = await waitForCommitEditor();
            const languageId = editor.document.languageId;

            await typeCommitMessage(editor, "chore: check the language mode");
            await acceptCommitMessage();
            await running;

            assert.strictEqual(languageId, "git-commit");
        });

        test("should refuse an empty commit message and stay open", async () => {
            write(repo, "file.ts", "const a = 1;\n");
            commitAll();
            write(repo, "file.ts", "const a = 2;\n");

            const warning = captureWarningMessage();

            const running = quickCommit(resource("file.ts"));
            const editor = await waitForCommitEditor();

            await typeCommitMessage(editor, "   ");
            await acceptCommitMessage();

            assert.strictEqual(warning(), "Commit message cannot be empty.");
            assert.ok(findCommitEditor(), "The editor should still be open");

            await closeCommitEditor(editor);
            await running;

            assert.deepStrictEqual(subjects(), ["baseline"], "Nothing should be committed");
        });

        test("should remove the scratch file once the prompt is answered", async () => {
            write(repo, "file.ts", "const a = 1;\n");
            captureInformationMessage();

            await runQuickCommit("chore: leave nothing behind", resource("file.ts"));
            await waitForCommitEditorToClose();

            assert.strictEqual(fs.existsSync(commitEditorPath()), false);
        });
    });

    suite("generate button", () => {
        test("should say there is nothing to describe rather than call the model", async () => {
            write(repo, "file.ts", "const a = 1;\n");
            commitAll();

            const infoMessage = captureInformationMessage();

            const running = quickCommit(resource("file.ts"));
            const editor = await waitForCommitEditor();

            await generateCommitMessageInEditor();

            assert.strictEqual(infoMessage(), "There are no changes to describe.");

            await closeCommitEditor(editor);
            await running;

            assert.deepStrictEqual(subjects(), ["baseline"]);
        });

        test("should report a generation failure without committing", async () => {
            write(repo, "file.ts", "const a = 1;\n");
            commitAll();
            write(repo, "file.ts", "const a = 2;\n");

            // Cancelling the API key prompt is the cheapest way to make generation fail offline.
            vscode.window.showInputBox = async () => undefined;
            const errorMessage = captureErrorMessage();

            const running = quickCommit(resource("file.ts"));
            const editor = await waitForCommitEditor();

            await generateCommitMessageInEditor();

            assert.ok(errorMessage().startsWith("Generation failed:"), `Unexpected message: ${errorMessage()}`);

            await closeCommitEditor(editor);
            await running;

            assert.deepStrictEqual(subjects(), ["baseline"], "Nothing should be committed");
        });
    });

    test("should show error when files come from different repositories", async () => {
        const otherRepo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vscode-quick-commit-other-")));
        git(otherRepo, ["init", "-q", "."]);
        fs.writeFileSync(path.join(otherRepo, "outside.ts"), "const outside = 1;\n");

        write(repo, "inside.ts", "const inside = 1;\n");

        const errorMessage = captureErrorMessage();

        try {
            await quickCommit(resource("inside.ts"), {
                resourceUri: vscode.Uri.file(path.join(otherRepo, "outside.ts")),
            } as vscode.SourceControlResourceState);

            assert.strictEqual(errorMessage(), "Selected files must be from the same repository.");
            assert.strictEqual(git(repo, ["status", "--porcelain"]).includes("?? inside.ts"), true, "Nothing staged");
        } finally {
            try {
                fs.rmSync(otherRepo, { recursive: true, force: true });
            } catch {
                // See teardown.
            }
        }
    });
});

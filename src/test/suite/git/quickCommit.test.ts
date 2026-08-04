import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

import { acceptCommitMessage, generateCommitMessageInEditor } from "../../../features/git/commitMessageEditor";
import { EDITOR_BUTTON_TOOLTIP, GENERATE_BUTTON_TOOLTIP } from "../../../features/git/commitMessageInput";
import { quickCommit } from "../../../features/git/quickCommit";
import { commitAll, createTempRepo, git, removeTempRepo, writeFile as write } from "../../helpers/tempRepo";
import {
    captureMessage,
    commitEditorPath,
    delay,
    findCommitEditor as findCommitEditorIn,
    restoreMessages,
    waitForCommitEditor as waitForEditorIn,
    waitForCommitEditorToClose as waitForEditorToCloseIn,
} from "../../helpers/vscodeStubs";
import { FakeInputBox, restoreInputBox, stubInputBox } from "./fakeInputBox";

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
    let originalShowInputBox: typeof vscode.window.showInputBox;

    setup(() => {
        originalShowInputBox = vscode.window.showInputBox;

        repo = createTempRepo("quick-commit");
    });

    teardown(async () => {
        restoreMessages();
        vscode.window.showInputBox = originalShowInputBox;
        restoreInputBox();

        await vscode.commands.executeCommand("workbench.action.closeAllEditors");

        removeTempRepo(repo);
    });

    function resource(relativePath: string): vscode.SourceControlResourceState {
        return { resourceUri: vscode.Uri.file(path.join(repo, relativePath)) };
    }

    function findCommitEditor(): vscode.TextEditor | undefined {
        return findCommitEditorIn(repo);
    }

    function waitForCommitEditor(): Promise<vscode.TextEditor> {
        return waitForEditorIn(repo);
    }

    function waitForCommitEditorToClose(): Promise<void> {
        return waitForEditorToCloseIn(repo);
    }

    const captureErrorMessage = () => captureMessage("error");
    const captureInformationMessage = () => captureMessage("information");
    const captureWarningMessage = () => captureMessage("warning");

    /**
     * Runs Quick Commit and answers its input box. `message === undefined` dismisses it instead,
     * which is how the prompt cancels.
     */
    async function runQuickCommit(message: string | undefined, ...resources: vscode.SourceControlResourceState[]): Promise<void> {
        stubInputBox(input => (message === undefined ? input.cancel() : input.accept(message)));

        await quickCommit(...resources);
    }

    /** The same, the long way round: the input box hands over to the editor, which answers instead. */
    async function runQuickCommitInEditor(message: string, ...resources: vscode.SourceControlResourceState[]): Promise<void> {
        stubInputBox(input => input.click(EDITOR_BUTTON_TOOLTIP));

        const running = quickCommit(...resources);
        const editor = await waitForCommitEditor();

        await typeCommitMessage(editor, message);
        await acceptCommitMessage();
        await running;
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
        commitAll(repo);

        write(repo, "file1.ts", "const a = 2;\n");
        write(repo, "file2.ts", "const b = 2;\n");

        captureInformationMessage();

        await runQuickCommit("Test commit", resource("file1.ts"), resource("file2.ts"));

        assert.deepStrictEqual(subjects(), ["Test commit", "baseline"]);
        assert.strictEqual(git(repo, ["status", "--porcelain"]), "", "Working tree should be clean");
    });

    test("should commit an untracked file", async () => {
        write(repo, "seed.ts", "const seed = 1;\n");
        commitAll(repo);

        write(repo, "brand-new.ts", "const isNew = true;\n");

        captureInformationMessage();

        await runQuickCommit("Add new file", resource("brand-new.ts"));

        assert.deepStrictEqual(git(repo, ["show", "--pretty=", "--name-only", "HEAD"]).trim(), "brand-new.ts");
    });

    test("should leave unrelated staged files in the index", async () => {
        write(repo, "already-staged.ts", "const staged = 1;\n");
        write(repo, "selected.ts", "const selected = 1;\n");
        commitAll(repo);

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

    test("should commit the working tree version of a partially staged file", async () => {
        // `git commit -- <paths>` commits what is on disk, bypassing the index for those paths: a
        // file staged hunk by hunk has its unstaged remainder committed along with it. Surprising,
        // but it is the contract, and the alternative would commit a version nobody selected.
        write(repo, "file.ts", "const a = 1;\nconst b = 1;\n");
        commitAll(repo);

        write(repo, "file.ts", "const a = 2;\nconst b = 1;\n");
        git(repo, ["add", "file.ts"]);
        write(repo, "file.ts", "const a = 2;\nconst b = 2;\n");

        captureInformationMessage();

        await runQuickCommit("Commit the whole file", resource("file.ts"));

        assert.strictEqual(git(repo, ["show", "HEAD:file.ts"]), "const a = 2;\nconst b = 2;\n");
        assert.strictEqual(git(repo, ["status", "--porcelain"]), "", "Nothing should be left behind");
    });

    test("should show error when the commit fails", async () => {
        write(repo, "seed.ts", "const seed = 1;\n");
        commitAll(repo);

        const errorMessage = captureErrorMessage();

        await runQuickCommit("Commit a file that is not there", resource("missing.ts"));

        assert.ok(errorMessage().startsWith("Quick Commit failed:"), `Unexpected message: ${errorMessage()}`);
        assert.ok(errorMessage().includes("missing.ts"), "Should include the git error message");
        assert.deepStrictEqual(subjects(), ["baseline"], "Nothing should be committed");
    });

    test("should not commit when user cancels", async () => {
        write(repo, "file.ts", "const a = 1;\n");
        commitAll(repo);

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

    suite("commit message input box", () => {
        test("should refuse an empty message and stay open", async () => {
            write(repo, "file.ts", "const a = 1;\n");
            commitAll(repo);
            write(repo, "file.ts", "const a = 2;\n");

            let box: FakeInputBox | undefined;
            stubInputBox(input => {
                box = input;
                input.accept("   ");
                input.cancel();
            });

            await quickCommit(resource("file.ts"));

            assert.strictEqual(box?.validationMessage, "Commit message cannot be empty.");
            assert.deepStrictEqual(subjects(), ["baseline"], "Nothing should be committed");
        });

        test("should carry what was typed over to the editor", async () => {
            // The button is there for a message that outgrows one line, so what is already written
            // has to survive the trip - retyping it is the reason nobody would press the button.
            write(repo, "file.ts", "const a = 1;\n");
            captureInformationMessage();

            stubInputBox(input => {
                input.type("feat: start in the box");
                input.click(EDITOR_BUTTON_TOOLTIP);
            });

            const running = quickCommit(resource("file.ts"));
            const editor = await waitForCommitEditor();

            assert.ok(editor.document.getText().startsWith("feat: start in the box\n"), editor.document.getText());

            await editor.edit(builder => builder.insert(new vscode.Position(1, 0), "\nand finish in the editor\n"));
            await acceptCommitMessage();
            await running;

            assert.strictEqual(lastCommitMessage(), "feat: start in the box\n\nand finish in the editor");
        });
    });

    suite("commit message editor", () => {
        test("should commit a title and a body", async () => {
            write(repo, "file.ts", "const a = 1;\n");
            captureInformationMessage();

            const message = "feat(git): commit from an editor\n\n- an input box holds one line, a body needs more\n- the editor strips its own comments";

            await runQuickCommitInEditor(message, resource("file.ts"));

            assert.strictEqual(lastCommitMessage(), message);
        });

        test("should keep the comment block out of the commit message", async () => {
            write(repo, "file.ts", "const a = 1;\n");
            captureInformationMessage();

            stubInputBox(input => input.click(EDITOR_BUTTON_TOOLTIP));

            const running = quickCommit(resource("file.ts"));
            const editor = await waitForCommitEditor();

            assert.ok(editor.document.getText().includes("# Committing 1 file:"), "The template should list the selection");
            assert.ok(editor.document.getText().includes("#   file.ts"), "The template should name the file");

            await typeCommitMessage(editor, "docs: describe the change");
            await acceptCommitMessage();
            await running;

            assert.strictEqual(lastCommitMessage(), "docs: describe the change");
        });

        test("should open with this extension's own commit language mode", async () => {
            write(repo, "file.ts", "const a = 1;\n");
            captureInformationMessage();

            stubInputBox(input => input.click(EDITOR_BUTTON_TOOLTIP));

            const running = quickCommit(resource("file.ts"));
            const editor = await waitForCommitEditor();
            const languageId = editor.document.languageId;

            await typeCommitMessage(editor, "chore: check the language mode");
            await acceptCommitMessage();
            await running;

            // `git-commit` would bring the built-in Git extension's own accept button along with
            // it, and that one discards the message instead of committing it.
            assert.strictEqual(languageId, "myDevToolsCommit");
        });

        test("should refuse an empty commit message and stay open", async () => {
            write(repo, "file.ts", "const a = 1;\n");
            commitAll(repo);
            write(repo, "file.ts", "const a = 2;\n");

            const warning = captureWarningMessage();

            stubInputBox(input => input.click(EDITOR_BUTTON_TOOLTIP));

            const running = quickCommit(resource("file.ts"));
            const editor = await waitForCommitEditor();

            await typeCommitMessage(editor, "   ");
            await acceptCommitMessage();

            assert.ok(warning().startsWith("Commit message cannot be empty."), `Unexpected message: ${warning()}`);
            assert.ok(findCommitEditor(), "The editor should still be open");

            await closeCommitEditor(editor);
            await running;

            assert.deepStrictEqual(subjects(), ["baseline"], "Nothing should be committed");
        });

        test("should say so when accepting without a prompt waiting for an answer", async () => {
            // A window reload restores the tab but not the session behind it, and the check mark is
            // contributed by file name alone. Doing nothing there is indistinguishable from a bug.
            const warning = captureWarningMessage();

            await acceptCommitMessage();

            assert.ok(warning().includes("no longer active"), `Unexpected message: ${warning()}`);
        });

        test("should remove the scratch file once the prompt is answered", async () => {
            write(repo, "file.ts", "const a = 1;\n");
            captureInformationMessage();

            await runQuickCommitInEditor("chore: leave nothing behind", resource("file.ts"));
            await waitForCommitEditorToClose();

            assert.strictEqual(fs.existsSync(commitEditorPath(repo)), false);
        });
    });

    suite("generate button", () => {
        test("should say there is nothing to describe rather than call the model from the input box", async () => {
            write(repo, "file.ts", "const a = 1;\n");
            commitAll(repo);

            const infoMessage = captureInformationMessage();

            stubInputBox(async input => {
                input.click(GENERATE_BUTTON_TOOLTIP);
                // The generate button runs on its own, so the box is still open behind it.
                for (let attempt = 0; attempt < 100 && infoMessage() === ""; attempt++) {
                    await delay(50);
                }
                input.cancel();
            });

            await quickCommit(resource("file.ts"));

            assert.strictEqual(infoMessage(), "There are no changes to describe.");
            assert.deepStrictEqual(subjects(), ["baseline"]);
        });

        test("should say there is nothing to describe rather than call the model", async () => {
            write(repo, "file.ts", "const a = 1;\n");
            commitAll(repo);

            const infoMessage = captureInformationMessage();

            stubInputBox(input => input.click(EDITOR_BUTTON_TOOLTIP));

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
            commitAll(repo);
            write(repo, "file.ts", "const a = 2;\n");

            // Cancelling the API key prompt is the cheapest way to make generation fail offline.
            vscode.window.showInputBox = async () => undefined;
            const errorMessage = captureErrorMessage();

            stubInputBox(input => input.click(EDITOR_BUTTON_TOOLTIP));

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
        const otherRepo = createTempRepo("quick-commit-other");
        write(otherRepo, "outside.ts", "const outside = 1;\n");

        write(repo, "inside.ts", "const inside = 1;\n");

        const errorMessage = captureErrorMessage();

        try {
            await quickCommit(resource("inside.ts"), {
                resourceUri: vscode.Uri.file(path.join(otherRepo, "outside.ts")),
            } as vscode.SourceControlResourceState);

            assert.strictEqual(errorMessage(), "Selected files must be from the same repository.");
            assert.strictEqual(git(repo, ["status", "--porcelain"]).includes("?? inside.ts"), true, "Nothing staged");
        } finally {
            removeTempRepo(otherRepo);
        }
    });
});

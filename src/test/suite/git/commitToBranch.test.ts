import * as assert from "assert";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

import { commitToBranch } from "../../../features/git/commitToBranch";
import { COMMIT_EDITOR_FILE_NAME, acceptCommitMessage } from "../../../features/git/commitMessageEditor";
import { EDITOR_BUTTON_TOOLTIP } from "../../../features/git/commitMessageInput";
import { restoreInputBox, stubInputBox } from "./fakeInputBox";

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

suite("CommitToBranch Tests", () => {
    let repo: string;
    let originalShowErrorMessage: typeof vscode.window.showErrorMessage;
    let originalShowInformationMessage: typeof vscode.window.showInformationMessage;
    let originalShowWarningMessage: typeof vscode.window.showWarningMessage;
    let originalShowQuickPick: typeof vscode.window.showQuickPick;

    setup(() => {
        originalShowErrorMessage = vscode.window.showErrorMessage;
        originalShowInformationMessage = vscode.window.showInformationMessage;
        originalShowWarningMessage = vscode.window.showWarningMessage;
        originalShowQuickPick = vscode.window.showQuickPick;

        repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vscode-commit-to-branch-")));

        git(repo, ["init", "-q", "-b", "main", "."]);
        git(repo, ["config", "user.email", "test@example.com"]);
        git(repo, ["config", "user.name", "Test"]);
    });

    teardown(async () => {
        vscode.window.showErrorMessage = originalShowErrorMessage;
        vscode.window.showInformationMessage = originalShowInformationMessage;
        vscode.window.showWarningMessage = originalShowWarningMessage;
        vscode.window.showQuickPick = originalShowQuickPick;
        restoreInputBox();

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

    function findCommitEditor(): vscode.TextEditor | undefined {
        const expected = vscode.Uri.file(path.join(repo, ".git", COMMIT_EDITOR_FILE_NAME)).toString();
        return vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === expected);
    }

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

    function captureMessage(channel: "showErrorMessage" | "showInformationMessage" | "showWarningMessage"): () => string {
        let message = "";
        vscode.window[channel] = (async (value: string) => {
            message = value;
            return undefined;
        }) as never;
        return () => message;
    }

    /** Answers the branch picker with `branchName`, or cancels it when `undefined`. */
    function pickBranch(branchName: string | undefined): () => string[] {
        let offered: string[] = [];

        vscode.window.showQuickPick = (async (items: readonly { label: string }[]) => {
            const resolved = await items;
            offered = resolved.map(item => item.label);
            return resolved.find(item => item.label === branchName);
        }) as never;

        return () => offered;
    }

    /** Runs the command and answers its message prompt. Assumes the branch picker is already stubbed. */
    async function runWithMessage(message: string, ...resources: vscode.SourceControlResourceState[]): Promise<void> {
        stubInputBox(input => input.accept(message));

        await commitToBranch(...resources);
    }

    /** Records whether the message prompt was reached at all, and dismisses it if it was. */
    function watchForPrompt(): () => boolean {
        let asked = false;

        stubInputBox(input => {
            asked = true;
            input.cancel();
        });

        return () => asked;
    }

    function subjects(rev: string): string[] {
        return git(repo, ["log", "--pretty=%s", rev])
            .split("\n")
            .filter(line => line.length > 0);
    }

    function fileAt(rev: string, relativePath: string): string {
        return git(repo, ["show", `${rev}:${relativePath}`]);
    }

    /** A repository on `fix/1` whose `readme.md` matches `main`, with unrelated changes pending. */
    function seedDivergedBranch(): void {
        write(repo, "readme.md", "hello\n");
        write(repo, "app.ts", "const a = 1;\n");
        git(repo, ["add", "-A"]);
        git(repo, ["commit", "-qm", "baseline"]);

        git(repo, ["checkout", "-q", "-b", "fix/1"]);
        write(repo, "app.ts", "const a = 2;\n");
        git(repo, ["commit", "-qam", "work in progress"]);
    }

    test("should commit to another branch without switching or disturbing pending changes", async () => {
        seedDivergedBranch();

        // The pending mess this command exists to avoid stashing.
        write(repo, "app.ts", "const a = 3;\n");
        git(repo, ["add", "app.ts"]);
        write(repo, "unstaged.ts", "const b = 1;\n");
        git(repo, ["add", "unstaged.ts"]);
        git(repo, ["commit", "-qm", "second"]);
        write(repo, "unstaged.ts", "const b = 2;\n");
        write(repo, "untracked.ts", "const c = 1;\n");

        write(repo, "readme.md", "hello world\n");

        // Snapshotted with the edit in place: the file stays modified here afterwards, since fix/1
        // does not contain the commit yet. That is the state the command must not disturb.
        const statusBefore = git(repo, ["status", "--porcelain"]);
        const headBefore = git(repo, ["rev-parse", "HEAD"]);

        pickBranch("main");
        const info = captureMessage("showInformationMessage");

        await runWithMessage("docs: update readme", resource("readme.md"));

        assert.deepStrictEqual(subjects("main"), ["docs: update readme", "baseline"]);
        assert.strictEqual(fileAt("main", "readme.md"), "hello world\n");
        assert.strictEqual(git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).trim(), "fix/1", "Should stay on the same branch");
        assert.strictEqual(git(repo, ["rev-parse", "HEAD"]), headBefore, "The current branch should not move");
        assert.strictEqual(git(repo, ["status", "--porcelain"]), statusBefore, "Working tree and index should be untouched");
        assert.strictEqual(info(), "Commit to Branch: committed 1 file to main. They stay modified here until fix/1 includes main.");
    });

    test("should refuse when the file differs between the branches", async () => {
        seedDivergedBranch();

        // main moves the same file, so the change would no longer produce the same diff there.
        git(repo, ["checkout", "-q", "main"]);
        write(repo, "readme.md", "hello from main\n");
        git(repo, ["commit", "-qam", "main edits the readme"]);
        git(repo, ["checkout", "-q", "fix/1"]);

        write(repo, "readme.md", "hello world\n");

        pickBranch("main");
        const warning = captureMessage("showWarningMessage");
        const asked = watchForPrompt();

        await commitToBranch(resource("readme.md"));

        assert.ok(warning().startsWith("readme.md differs between main and fix/1"), `Unexpected message: ${warning()}`);
        assert.deepStrictEqual(subjects("main"), ["main edits the readme", "baseline"], "main should not move");
        assert.strictEqual(asked(), false, "Should refuse before asking for a message");
    });

    test("should not offer branches that are checked out", async () => {
        seedDivergedBranch();
        git(repo, ["branch", "release"]);

        const worktree = path.join(repo, "..", path.basename(repo) + "-wt");
        git(repo, ["worktree", "add", "-q", worktree, "release"]);

        try {
            const offered = pickBranch(undefined);

            await commitToBranch(resource("readme.md"));

            assert.deepStrictEqual(offered(), ["main"], "fix/1 is HEAD and release is in a worktree");
        } finally {
            git(repo, ["worktree", "remove", "--force", worktree]);
        }
    });

    test("should commit a deletion and a new file", async () => {
        seedDivergedBranch();

        fs.rmSync(path.join(repo, "readme.md"));
        write(repo, "added.ts", "const added = 1;\n");

        pickBranch("main");
        captureMessage("showInformationMessage");

        await runWithMessage("chore: shuffle files", resource("readme.md"), resource("added.ts"));

        assert.deepStrictEqual(git(repo, ["show", "--pretty=", "--name-status", "main"]).trim().split("\n").sort(), [
            "A\tadded.ts",
            "D\treadme.md",
        ]);
        assert.strictEqual(fileAt("main", "added.ts"), "const added = 1;\n");
    });

    test("should report when the target already has the content", async () => {
        seedDivergedBranch();

        pickBranch("main");
        const info = captureMessage("showInformationMessage");

        await runWithMessage("docs: no-op", resource("readme.md")); // readme.md is unchanged on disk

        assert.strictEqual(info(), "main already has this content; nothing to commit.");
        assert.deepStrictEqual(subjects("main"), ["baseline"]);
    });

    test("should not commit when the branch picker is cancelled", async () => {
        seedDivergedBranch();
        write(repo, "readme.md", "hello world\n");

        pickBranch(undefined);
        const asked = watchForPrompt();

        await commitToBranch(resource("readme.md"));

        assert.deepStrictEqual(subjects("main"), ["baseline"]);
        assert.strictEqual(asked(), false, "Should not ask for a message");
    });

    test("should name the target branch in the prompt", async () => {
        seedDivergedBranch();
        write(repo, "readme.md", "hello world\n");

        pickBranch("main");

        let title: string | undefined;
        stubInputBox(input => {
            title = input.title;
            input.cancel();
        });

        await commitToBranch(resource("readme.md"));

        assert.strictEqual(title, "Commit 1 file to main");
    });

    test("should commit a title and a body through the editor", async () => {
        seedDivergedBranch();
        write(repo, "readme.md", "hello world\n");

        pickBranch("main");
        captureMessage("showInformationMessage");
        stubInputBox(input => input.click(EDITOR_BUTTON_TOOLTIP));

        const running = commitToBranch(resource("readme.md"));
        const editor = await waitForCommitEditor();

        await editor.edit(builder =>
            builder.replace(new vscode.Range(0, 0, 0, editor.document.lineAt(0).text.length), "docs: update readme\n\nwith a body")
        );
        await acceptCommitMessage();
        await running;

        assert.deepStrictEqual(subjects("main"), ["docs: update readme", "baseline"]);
        assert.strictEqual(fileAt("main", "readme.md"), "hello world\n");
    });

    test("should not commit when the message editor is closed", async () => {
        seedDivergedBranch();
        write(repo, "readme.md", "hello world\n");

        pickBranch("main");
        stubInputBox(input => input.click(EDITOR_BUTTON_TOOLTIP));

        const running = commitToBranch(resource("readme.md"));
        const editor = await waitForCommitEditor();

        assert.ok(editor.document.getText().includes("# Committing 1 file to main:"), "The template should name the target branch");

        await vscode.window.showTextDocument(editor.document, { preview: false });
        await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
        await running;

        assert.deepStrictEqual(subjects("main"), ["baseline"], "Nothing should be committed");
    });

    test("should leave the scratch index behind in no state", async () => {
        seedDivergedBranch();
        write(repo, "readme.md", "hello world\n");

        pickBranch("main");
        captureMessage("showInformationMessage");

        await runWithMessage("docs: update readme", resource("readme.md"));

        const leftovers = fs.readdirSync(path.join(repo, ".git")).filter(entry => entry.startsWith("MY_DEV_TOOLS_COMMIT_INDEX"));
        assert.deepStrictEqual(leftovers, [], "The scratch index should be removed");
    });

    test("should show error when no files are selected", async () => {
        const errorMessage = captureMessage("showErrorMessage");

        await commitToBranch();

        assert.strictEqual(errorMessage(), "No files selected for Commit to Branch.");
    });
});

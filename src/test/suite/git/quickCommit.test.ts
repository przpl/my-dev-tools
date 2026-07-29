import * as assert from "assert";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

import { quickCommit } from "../../../features/git/quickCommit";

function git(cwd: string, args: string[]): string {
    return cp.execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });
}

function write(repo: string, relativePath: string, content: string): void {
    const target = path.join(repo, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
}

suite("QuickCommit Tests", () => {
    let repo: string;
    let originalShowErrorMessage: typeof vscode.window.showErrorMessage;
    let originalShowInputBox: typeof vscode.window.showInputBox;
    let originalShowInformationMessage: typeof vscode.window.showInformationMessage;

    setup(() => {
        originalShowErrorMessage = vscode.window.showErrorMessage;
        originalShowInputBox = vscode.window.showInputBox;
        originalShowInformationMessage = vscode.window.showInformationMessage;

        repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vscode-quick-commit-")));

        git(repo, ["init", "-q", "."]);
        git(repo, ["config", "user.email", "test@example.com"]);
        git(repo, ["config", "user.name", "Test"]);
    });

    teardown(() => {
        vscode.window.showErrorMessage = originalShowErrorMessage;
        vscode.window.showInputBox = originalShowInputBox;
        vscode.window.showInformationMessage = originalShowInformationMessage;

        try {
            fs.rmSync(repo, { recursive: true, force: true });
        } catch {
            // Windows can hold locks on the git directory; leaving the temp folder behind is harmless.
        }
    });

    function resource(relativePath: string): vscode.SourceControlResourceState {
        return { resourceUri: vscode.Uri.file(path.join(repo, relativePath)) };
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

    function answerCommitMessage(message: string | undefined): void {
        vscode.window.showInputBox = async () => message;
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

        answerCommitMessage("Test commit");
        captureInformationMessage();

        await quickCommit(resource("file1.ts"), resource("file2.ts"));

        assert.deepStrictEqual(subjects(), ["Test commit", "baseline"]);
        assert.strictEqual(git(repo, ["status", "--porcelain"]), "", "Working tree should be clean");
    });

    test("should commit an untracked file", async () => {
        write(repo, "seed.ts", "const seed = 1;\n");
        commitAll();

        write(repo, "brand-new.ts", "const isNew = true;\n");

        answerCommitMessage("Add new file");
        captureInformationMessage();

        await quickCommit(resource("brand-new.ts"));

        assert.deepStrictEqual(git(repo, ["show", "--pretty=", "--name-only", "HEAD"]).trim(), "brand-new.ts");
    });

    test("should leave unrelated staged files in the index", async () => {
        write(repo, "already-staged.ts", "const staged = 1;\n");
        write(repo, "selected.ts", "const selected = 1;\n");
        commitAll();

        write(repo, "already-staged.ts", "const staged = 2;\n");
        git(repo, ["add", "already-staged.ts"]);
        write(repo, "selected.ts", "const selected = 2;\n");

        answerCommitMessage("Commit only the selection");
        captureInformationMessage();

        await quickCommit(resource("selected.ts"));

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

        answerCommitMessage("Commit a file that is not there");
        const errorMessage = captureErrorMessage();

        await quickCommit(resource("missing.ts"));

        assert.ok(errorMessage().startsWith("Quick Commit failed:"), `Unexpected message: ${errorMessage()}`);
        assert.ok(errorMessage().includes("missing.ts"), "Should include the git error message");
        assert.deepStrictEqual(subjects(), ["baseline"], "Nothing should be committed");
    });

    test("should not commit when user cancels", async () => {
        write(repo, "file.ts", "const a = 1;\n");
        commitAll();

        write(repo, "file.ts", "const a = 2;\n");

        answerCommitMessage(undefined); // User cancels

        await quickCommit(resource("file.ts"));

        assert.deepStrictEqual(subjects(), ["baseline"], "Nothing should be committed");
    });

    test("should show success message with correct file count", async () => {
        write(repo, "f1.ts", "const a = 1;\n");
        write(repo, "f2.ts", "const b = 1;\n");
        write(repo, "f3.ts", "const c = 1;\n");

        answerCommitMessage("Multi file commit");
        const infoMessage = captureInformationMessage();

        await quickCommit(resource("f1.ts"), resource("f2.ts"), resource("f3.ts"));

        assert.strictEqual(infoMessage(), "Quick Commit: Successfully committed 3 files.");
    });

    test("should pass commit messages and paths through verbatim", async () => {
        // Spaces and shell metacharacters used to be escaped by hand into a shell command line.
        const message = 'fix: handle "quoted" & $spaced input';
        write(repo, "a file with spaces.ts", "const a = 1;\n");

        answerCommitMessage(message);
        captureInformationMessage();

        await quickCommit(resource("a file with spaces.ts"));

        assert.deepStrictEqual(subjects(), [message]);
        assert.strictEqual(git(repo, ["show", "--pretty=", "--name-only", "HEAD"]).trim(), "a file with spaces.ts");
    });

    test("should show error when files come from different repositories", async () => {
        const otherRepo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vscode-quick-commit-other-")));
        git(otherRepo, ["init", "-q", "."]);
        fs.writeFileSync(path.join(otherRepo, "outside.ts"), "const outside = 1;\n");

        write(repo, "inside.ts", "const inside = 1;\n");

        answerCommitMessage("Should never run");
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

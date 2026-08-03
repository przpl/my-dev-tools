import * as assert from "assert";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

import { COMMIT_EDITOR_FILE_NAME } from "../../../features/git/commitMessageEditor";
import { EDITOR_BUTTON_TOOLTIP } from "../../../features/git/commitMessageInput";
import { restoreInputBox, stubInputBox } from "./fakeInputBox";

/**
 * The suite next door drives Quick Commit by calling its functions. These go through the registered
 * commands instead, which is what the context menu and the editor's check mark do: the wiring in
 * `package.json` and `extension.ts` is otherwise never exercised, and neither is the argument shape
 * VS Code actually passes.
 */

function git(cwd: string, args: string[]): string {
    return cp.execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

suite("Commit command wiring", () => {
    let repo: string;
    let originalShowInformationMessage: typeof vscode.window.showInformationMessage;

    setup(() => {
        originalShowInformationMessage = vscode.window.showInformationMessage;
        vscode.window.showInformationMessage = (async () => undefined) as typeof vscode.window.showInformationMessage;

        repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vscode-commit-commands-")));

        git(repo, ["init", "-q", "."]);
        git(repo, ["config", "user.email", "test@example.com"]);
        git(repo, ["config", "user.name", "Test"]);
    });

    teardown(async () => {
        vscode.window.showInformationMessage = originalShowInformationMessage;
        restoreInputBox();

        await vscode.commands.executeCommand("workbench.action.closeAllEditors");

        try {
            fs.rmSync(repo, { recursive: true, force: true });
        } catch {
            // Windows can hold locks on the git directory; leaving the temp folder behind is harmless.
        }
    });

    function write(relativePath: string, content: string): void {
        fs.writeFileSync(path.join(repo, relativePath), content);
    }

    function resource(relativePath: string): vscode.SourceControlResourceState {
        return { resourceUri: vscode.Uri.file(path.join(repo, relativePath)) };
    }

    /**
     * The comment block, not the tab: the file is a real file that an earlier window can leave
     * behind, so a tab with that name proves nothing about a prompt waiting behind it.
     */
    function findCommitEditor(): vscode.TextEditor | undefined {
        const expected = vscode.Uri.file(path.join(repo, ".git", COMMIT_EDITOR_FILE_NAME)).toString();
        return vscode.window.visibleTextEditors.find(
            editor => editor.document.uri.toString() === expected && editor.document.getText().includes("# Committing")
        );
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

    /** Runs Quick Commit the way the Source Control context menu does, and accepts with the check mark. */
    async function quickCommitThroughCommands(message: string, ...args: unknown[]): Promise<void> {
        stubInputBox(input => input.click(EDITOR_BUTTON_TOOLTIP));

        const running = vscode.commands.executeCommand("myDevTools.quickCommit", ...args);
        const editor = await waitForCommitEditor();

        await editor.edit(builder => builder.replace(new vscode.Range(0, 0, 0, editor.document.lineAt(0).text.length), message));
        await vscode.commands.executeCommand("myDevTools.acceptCommitMessage");

        await running;
    }

    function subjects(): string[] {
        return git(repo, ["log", "--pretty=%s"])
            .split("\n")
            .filter(line => line.length > 0);
    }

    function committedFiles(): string[] {
        return git(repo, ["show", "--pretty=", "--name-only", "HEAD"])
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .sort();
    }

    test("should commit through the command and the editor's check mark", async () => {
        write("file.ts", "const a = 1;\n");

        await quickCommitThroughCommands("commit through the commands", resource("file.ts"));

        assert.deepStrictEqual(subjects(), ["commit through the commands"]);
    });

    test("should commit through the command and its input box", async () => {
        // The short way round, which is the way nearly every commit goes: type a line, press Enter.
        write("file.ts", "const a = 1;\n");

        stubInputBox(input => input.accept("commit from the input box"));

        await vscode.commands.executeCommand("myDevTools.quickCommit", resource("file.ts"));

        assert.deepStrictEqual(subjects(), ["commit from the input box"]);
    });

    test("should commit a file handed over as a bare Uri", async () => {
        // The Explorer and the editor title bar pass `Uri`s, not resource states. Walking straight
        // past them left the command with an empty selection and an error about nothing selected.
        write("file.ts", "const a = 1;\n");

        stubInputBox(input => input.accept("commit from a uri"));

        await vscode.commands.executeCommand("myDevTools.quickCommit", vscode.Uri.file(path.join(repo, "file.ts")));

        assert.deepStrictEqual(subjects(), ["commit from a uri"]);
    });

    test("should open the message editor in this extension's own language", async () => {
        // Not `git-commit`. The built-in Git extension puts its "Accept Commit Message" button
        // inside every editor with that language, and that button only closes the tab - which this
        // command reads as a cancellation. Two commit buttons, one of which quietly discards the
        // message, and the more prominent one is the wrong one.
        write("file.ts", "const a = 1;\n");

        stubInputBox(input => input.click(EDITOR_BUTTON_TOOLTIP));

        const running = vscode.commands.executeCommand("myDevTools.quickCommit", resource("file.ts"));
        const editor = await waitForCommitEditor();

        assert.strictEqual(editor.document.languageId, "myDevToolsCommit");

        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
        await running;
    });

    test("should commit when the message editor is already open from an earlier session", async () => {
        // The scratch file is a real file in .git, so a window that closes with the prompt open
        // restores its tab on the next start - and then the prompt opens on top of a tab that is
        // already there. Anything that treats the resulting tab churn as "the user closed it"
        // cancels the commit the moment it is asked for, leaving a live-looking editor whose check
        // mark answers a promise nobody is waiting on any more.
        write("file.ts", "const a = 1;\n");

        const uri = vscode.Uri.file(path.join(repo, ".git", COMMIT_EDITOR_FILE_NAME));
        fs.writeFileSync(uri.fsPath, "leftover\n");
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: false });

        await quickCommitThroughCommands("commit with the editor already open", resource("file.ts"));

        assert.deepStrictEqual(subjects(), ["commit with the editor already open"]);
    });

    test("should commit every file of a multi-selection", async () => {
        write("one.ts", "const a = 1;\n");
        write("two.ts", "const b = 1;\n");
        write("three.ts", "const c = 1;\n");

        // A multi-selection arrives as the clicked resource plus an array of the whole selection.
        const selection = [resource("one.ts"), resource("two.ts"), resource("three.ts")];
        await quickCommitThroughCommands("commit the whole selection", selection[0], selection);

        assert.deepStrictEqual(committedFiles(), ["one.ts", "three.ts", "two.ts"]);
    });
});

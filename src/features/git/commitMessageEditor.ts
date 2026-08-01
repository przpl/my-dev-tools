import * as path from "path";
import * as vscode from "vscode";

import { NothingToDescribeError, generateCommitMessage } from "./commitContext";
import { findGitDir } from "./gitCli";

/**
 * A commit message prompt that holds a body, which the quick input box cannot: `InputBox` is a
 * single line with no multi-line mode, so anything past the title was invisible there and lost on
 * accept. This opens a scratch file the way `git commit` opens `COMMIT_EDITMSG` instead - a real
 * editor, with the `git-commit` language mode, its 50/72 rulers and its comment stripping.
 */

/** Also the `when` clause of the editor's accept, generate and keybinding contributions. */
export const COMMIT_EDITOR_FILE_NAME = "MY_DEV_TOOLS_COMMIT_EDITMSG";

interface Session {
    uri: vscode.Uri;
    gitRoot: string;
    /** Repository-relative paths, so generation describes the selection rather than the repository. */
    paths: string[];
    comments: string;
    resolve: (message: string | undefined) => void;
    disposables: vscode.Disposable[];
}

/** One prompt at a time: the editor is modal in practice, and the commands act on what is open. */
let session: Session | undefined;

function buildComments(paths: string[], targetBranch: string | undefined): string {
    const lines = [
        "",
        "Write the commit message above, title first, body after a blank line.",
        "Lines starting with '#' are ignored, and this block is removed.",
        "",
        "Press Ctrl+Enter (Cmd+Enter on macOS), or the check mark in the editor",
        "title bar, to commit. Close this editor to cancel.",
        "",
        `Committing ${paths.length} ${paths.length === 1 ? "file" : "files"}${targetBranch ? ` to ${targetBranch}` : ""}:`,
        ...paths.map(filePath => `  ${filePath}`),
    ];

    return lines.map(line => `#${line && ` ${line}`}`).join("\n");
}

/** Git's own `--cleanup=strip`: drop comment lines, trailing whitespace, and blank edges. */
export function stripCommitComments(text: string): string {
    return text
        .replace(/\r\n/g, "\n")
        .split("\n")
        .filter(line => !line.startsWith("#"))
        .map(line => line.trimEnd())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function findDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
    return vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString());
}

/** Reverting first means a message left half-typed never raises a "save your changes?" dialog. */
async function closeEditor(uri: vscode.Uri): Promise<void> {
    const document = findDocument(uri);
    if (!document || !isOpenInAnyTab(uri)) {
        return;
    }

    try {
        await vscode.window.showTextDocument(document, { preview: false });
        await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
    } catch {
        // A tab the user already closed is the outcome we wanted anyway.
    }
}

async function finish(message: string | undefined): Promise<void> {
    const current = session;
    if (!current) {
        return;
    }

    session = undefined;
    current.disposables.forEach(disposable => disposable.dispose());

    await closeEditor(current.uri);

    try {
        await vscode.workspace.fs.delete(current.uri);
    } catch {
        // The scratch file lives in .git and is rewritten on every prompt; a leftover is harmless.
    }

    current.resolve(message);
}

/**
 * Opens the commit message editor and resolves with the message once it is accepted, or with
 * `undefined` if the editor is closed instead. `targetBranch` names the branch in the comment block
 * when the commit is not headed for the checked-out one.
 */
export async function promptForCommitMessage(gitRoot: string, paths: string[], targetBranch?: string): Promise<string | undefined> {
    if (session) {
        await finish(undefined);
    }

    const gitDir = (await findGitDir(gitRoot)) ?? path.join(gitRoot, ".git");
    const uri = vscode.Uri.file(path.join(gitDir, COMMIT_EDITOR_FILE_NAME));
    const comments = buildComments(paths, targetBranch);

    await vscode.workspace.fs.writeFile(uri, Buffer.from(`\n${comments}\n`, "utf8"));

    let resolve!: (message: string | undefined) => void;
    const answer = new Promise<string | undefined>(settle => (resolve = settle));
    const disposables: vscode.Disposable[] = [];

    // Registered before the editor is shown, not after: an editor appears on screen a moment before
    // `showTextDocument` resolves, and until the session exists its check mark does nothing.
    session = { uri, gitRoot, paths, comments, resolve, disposables };

    // Closing the tab is how the editor says "cancel", so it has to settle the promise. Only this
    // tab's own closure counts: asking "is it still open?" on every tab event cancelled sessions
    // whose tab the tab model had not caught up with yet.
    disposables.push(
        vscode.window.tabGroups.onDidChangeTabs(event => {
            if (event.closed.some(tab => isTabFor(tab, uri)) && !isOpenInAnyTab(uri)) {
                void finish(undefined);
            }
        })
    );

    let document = await vscode.workspace.openTextDocument(uri);

    try {
        // Contributed by the built-in Git extension, so it is missing when that one is disabled.
        // The call replaces the document rather than mutating it, so the new one has to be kept.
        document = await vscode.languages.setTextDocumentLanguage(document, "git-commit");
    } catch {
        // Plain text still edits fine; only the rulers and the highlighting are lost.
    }

    const editor = await vscode.window.showTextDocument(document, { preview: false });
    editor.selection = new vscode.Selection(0, 0, 0, 0);

    return answer;
}

function isTabFor(tab: vscode.Tab, uri: vscode.Uri): boolean {
    return tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString();
}

/** A document can be open in several groups, so one closed tab is not necessarily the last one. */
function isOpenInAnyTab(uri: vscode.Uri): boolean {
    return vscode.window.tabGroups.all.some(group => group.tabs.some(tab => isTabFor(tab, uri)));
}

/** Commits what is in the editor. Bound to the check mark and to Ctrl+Enter. */
export async function acceptCommitMessage(): Promise<void> {
    const current = session;
    if (!current) {
        return;
    }

    const document = findDocument(current.uri);
    const message = stripCommitComments(document?.getText() ?? "");

    if (message.length === 0) {
        vscode.window.showWarningMessage("Commit message cannot be empty.");
        return;
    }

    await finish(message);
}

/** Writes a generated message above the comment block, keeping whatever is typed as the hint. */
export async function generateCommitMessageInEditor(): Promise<void> {
    const current = session;
    if (!current) {
        return;
    }

    const document = findDocument(current.uri);
    if (!document) {
        return;
    }

    const hint = stripCommitComments(document.getText());

    try {
        const message = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: "Generating commit message", cancellable: true },
            (_progress, token) => generateCommitMessage(current.gitRoot, { paths: current.paths, hint }, token)
        );

        if (!message) {
            return;
        }

        const edit = new vscode.WorkspaceEdit();
        edit.replace(current.uri, new vscode.Range(0, 0, document.lineCount, 0), `${message}\n\n${current.comments}\n`);
        await vscode.workspace.applyEdit(edit);
    } catch (error) {
        if (error instanceof NothingToDescribeError) {
            vscode.window.showInformationMessage(error.message);
            return;
        }

        vscode.window.showErrorMessage(`Generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

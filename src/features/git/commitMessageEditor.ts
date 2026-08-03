import * as path from "path";
import * as vscode from "vscode";

import { NothingToDescribeError, generateCommitMessage } from "./commitContext";
import { findGitDir } from "./gitCli";

/**
 * The long-message half of the commit prompt, reached from the input box in `commitMessageInput`
 * when one line is not enough: `InputBox` has no multi-line mode, so anything past the title is
 * invisible there and lost on accept. This opens a scratch file the way `git commit` opens
 * `COMMIT_EDITMSG` instead - a real editor, with rulers at 50 and 72 and comment stripping.
 *
 * It is deliberately not the default prompt. An editor costs a tab, a place to click to accept and
 * a way to tell "closed" from "cancelled", none of which typing a line into an input box needs.
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

    // The answer first, the tidying up afterwards: closing an editor and deleting a file are both
    // round trips through the workbench, and the commit should not wait behind either of them.
    current.resolve(message);

    await closeEditor(current.uri);

    try {
        await vscode.workspace.fs.delete(current.uri);
    } catch {
        // The scratch file lives in .git and is rewritten on every prompt; a leftover is harmless.
    }
}

export interface CommitEditorOptions {
    /** Names the branch in the comment block when the commit is not headed for the checked-out one. */
    targetBranch?: string;
    /** What was already typed into the input box, or generated, before the editor was asked for. */
    initialMessage?: string;
}

/**
 * Opens the commit message editor and resolves with the message once it is accepted, or with
 * `undefined` if the editor is closed instead.
 */
export async function openCommitMessageEditor(gitRoot: string, paths: string[], options: CommitEditorOptions = {}): Promise<string | undefined> {
    if (session) {
        await finish(undefined);
    }

    const gitDir = (await findGitDir(gitRoot)) ?? path.join(gitRoot, ".git");
    const uri = vscode.Uri.file(path.join(gitDir, COMMIT_EDITOR_FILE_NAME));

    // The scratch file is a real file, so a window that closed with a prompt open restores its tab
    // on the next start. Showing this prompt's editor on top of that tab closes and reopens it, and
    // that churn is indistinguishable from the user closing the editor. Take it out of the way now,
    // while there is no session left to cancel.
    await closeEditor(uri);

    const comments = buildComments(paths, options.targetBranch);
    const initialMessage = options.initialMessage ? `${options.initialMessage}\n` : "";

    await vscode.workspace.fs.writeFile(uri, Buffer.from(`${initialMessage}\n${comments}\n`, "utf8"));

    let resolve!: (message: string | undefined) => void;
    const answer = new Promise<string | undefined>(settle => (resolve = settle));
    const disposables: vscode.Disposable[] = [];

    // Set before the editor is shown, not after: an editor appears on screen a moment before
    // `showTextDocument` resolves, and until the session exists its check mark does nothing.
    session = { uri, gitRoot, paths, comments, resolve, disposables };

    // The language comes from the file name, through the `myDevToolsCommit` contribution in
    // `package.json`. Deliberately not `git-commit`: the built-in Git extension puts its own
    // "Accept Commit Message" button inside every editor with that language, and all that button
    // does is close the tab - which this file reads as a cancellation.
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, { preview: false });

    // At the end of what was carried over from the input box, so typing continues where it left off.
    const end = document.positionAt(options.initialMessage?.length ?? 0);
    editor.selection = new vscode.Selection(end, end);

    // Closing the tab is how the editor says "cancel", so it has to settle the promise. Watched only
    // once the editor is up: opening one on top of a tab left behind by an earlier window closes and
    // reopens that tab, and reading that churn as a cancellation kills the prompt on arrival.
    disposables.push(
        vscode.window.tabGroups.onDidChangeTabs(event => {
            if (event.closed.some(tab => isTabFor(tab, uri)) && !isOpenInAnyTab(uri)) {
                void finish(undefined);
            }
        })
    );

    return answer;
}

function isTabFor(tab: vscode.Tab, uri: vscode.Uri): boolean {
    return tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString();
}

/** A document can be open in several groups, so one closed tab is not necessarily the last one. */
function isOpenInAnyTab(uri: vscode.Uri): boolean {
    return vscode.window.tabGroups.all.some(group => group.tabs.some(tab => isTabFor(tab, uri)));
}

/**
 * The editor outlives the session that opened it: a window reload restores the tab, and the check
 * mark is contributed by file name alone, so it is there whether a command is waiting or not. Doing
 * nothing in that case looks exactly like a broken button, so say what happened instead.
 */
function reportExpiredSession(): void {
    vscode.window.showWarningMessage("This commit prompt is no longer active. Close the editor and run the command again.");
}

/** Commits what is in the editor. Bound to the check mark and to Ctrl+Enter. */
export async function acceptCommitMessage(): Promise<void> {
    const current = session;
    if (!current) {
        reportExpiredSession();
        return;
    }

    const document = findDocument(current.uri);
    const message = stripCommitComments(document?.getText() ?? "");

    if (message.length === 0) {
        // Every line starting with '#' is a comment, so an issue number as the first word strips away.
        vscode.window.showWarningMessage("Commit message cannot be empty. Lines starting with '#' are treated as comments and removed.");
        return;
    }

    await finish(message);
}

/** Writes a generated message above the comment block, keeping whatever is typed as the hint. */
export async function generateCommitMessageInEditor(): Promise<void> {
    const current = session;
    if (!current) {
        reportExpiredSession();
        return;
    }

    const document = findDocument(current.uri);
    if (!document) {
        reportExpiredSession();
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

import * as path from "path";
import * as vscode from "vscode";

import { execGit, findGitRoot, toGitPath } from "./gitCli";

/**
 * The modified side of a diff is a plain `file:` URI, but the original side is a `git:` URI whose
 * real path is carried in the query. Without this the command silently no-ops whenever the left
 * pane happens to hold focus.
 */
export function resolveFilePath(uri: vscode.Uri): string | undefined {
    if (uri.scheme === "file") {
        return uri.fsPath;
    }

    if (uri.scheme === "git") {
        try {
            const { path: filePath } = JSON.parse(uri.query) as { path?: string };
            return filePath || undefined;
        } catch {
            return undefined;
        }
    }

    return undefined;
}

function resolveTargetPath(): string | undefined {
    // Inside a multi-diff editor this is the entry the caret sits in, which is what we want.
    const editorUri = vscode.window.activeTextEditor?.document.uri;
    if (editorUri) {
        const filePath = resolveFilePath(editorUri);
        if (filePath) {
            return filePath;
        }
    }

    // No text editor focus (a tab was clicked rather than its content) - fall back to the tab itself.
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (input instanceof vscode.TabInputTextDiff) {
        return resolveFilePath(input.modified);
    }
    if (input instanceof vscode.TabInputText) {
        return resolveFilePath(input.uri);
    }

    return undefined;
}

export async function stageActiveFile(): Promise<void> {
    const filePath = resolveTargetPath();
    if (!filePath) {
        vscode.window.showErrorMessage("Stage file: no file is focused.");
        return;
    }

    const gitRoot = await findGitRoot(path.dirname(filePath));
    if (!gitRoot) {
        vscode.window.showErrorMessage("Stage file: could not find a Git repository.");
        return;
    }

    try {
        await execGit(gitRoot, ["add", "--", toGitPath(gitRoot, filePath)]);
        // A status bar message rather than a notification: this is meant to be pressed in rapid succession.
        vscode.window.setStatusBarMessage(`Staged ${path.basename(filePath)}`, 3000);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Stage file failed: ${errorMessage}`);
    }
}

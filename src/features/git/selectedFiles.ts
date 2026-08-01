import * as path from "path";
import * as vscode from "vscode";

import { collectResourceUris } from "./autoStage";
import { findGitRoot } from "./gitCli";

export interface SelectedFiles {
    gitRoot: string;
    /** Absolute, de-duplicated, and all inside `gitRoot`. */
    filePaths: string[];
}

/**
 * Resolves the files a commit command was invoked on, reporting the reasons a selection cannot be
 * committed. `commandLabel` names the command in the "nothing selected" message.
 */
export async function resolveSelectedFiles(args: unknown[], commandLabel: string): Promise<SelectedFiles | undefined> {
    const filePaths = [...new Set(collectResourceUris(args).map(uri => uri.fsPath))];

    if (filePaths.length === 0) {
        vscode.window.showErrorMessage(`No files selected for ${commandLabel}.`);
        return undefined;
    }

    const gitRoot = await findGitRoot(path.dirname(filePaths[0]));
    if (!gitRoot) {
        vscode.window.showErrorMessage("Could not find Git repository for selected files.");
        return undefined;
    }

    const roots = await Promise.all(filePaths.map(filePath => findGitRoot(path.dirname(filePath))));
    if (!roots.every(root => root === gitRoot)) {
        vscode.window.showErrorMessage("Selected files must be from the same repository.");
        return undefined;
    }

    return { gitRoot, filePaths };
}

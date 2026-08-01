import * as vscode from "vscode";

import { NothingToDescribeError, generateCommitMessage as generate } from "./commitContext";
import { findGitRoot } from "./gitCli";
import { resolveRepository } from "./gitExtensionApi";

/**
 * Fills the Source Control message box with a generated commit message. Contributed to both
 * `scm/inputBox` (the button inside the box, behind a proposed API) and `scm/title`, so there is
 * always somewhere to press even when the proposed API is not enabled.
 */
export async function generateCommitMessageCommand(...args: unknown[]): Promise<void> {
    const repository = await resolveRepository(args);
    if (!repository) {
        vscode.window.showErrorMessage("Generate commit message: no Git repository is open.");
        return;
    }

    const gitRoot = await findGitRoot(repository.rootUri.fsPath);
    if (!gitRoot) {
        vscode.window.showErrorMessage("Generate commit message: could not find a Git repository.");
        return;
    }

    // Whatever is already typed is intent, not text to keep: it guides the model, then is replaced.
    const hint = repository.inputBox.value;

    try {
        const message = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.SourceControl, title: "Generating commit message" },
            (_progress, token) => generate(gitRoot, { hint }, token)
        );

        if (message) {
            repository.inputBox.value = message;
        }
    } catch (error) {
        if (error instanceof NothingToDescribeError) {
            vscode.window.showInformationMessage("There are no changes to describe.");
            return;
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Generate commit message failed: ${errorMessage}`);
    }
}

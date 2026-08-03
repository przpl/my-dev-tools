import * as vscode from "vscode";
import * as path from "path";

import { promptForCommitMessage } from "./commitMessageInput";
import { execGit, toGitPath } from "./gitCli";
import { resolveSelectedFiles } from "./selectedFiles";

/** Absolute paths of the files that currently have something in the index. */
async function getStagedFiles(gitRoot: string): Promise<string[]> {
    const status = await execGit(gitRoot, ["status", "--porcelain"]);
    const staged: string[] = [];

    for (const line of status.split("\n")) {
        if (!line) continue;

        const stageStatus = line[0];
        const filePath = line.substring(3).trim();

        if (stageStatus !== " " && stageStatus !== "?") {
            staged.push(path.join(gitRoot, filePath));
        }
    }

    return staged;
}

export async function quickCommit(...args: unknown[]): Promise<void> {
    // Everything is inside, opening the prompt included: a command that rejects gets VS Code's own
    // "An unknown error occurred", which names neither the command nor what went wrong.
    try {
        const selection = await resolveSelectedFiles(args, "Quick Commit");
        if (!selection) {
            return;
        }

        const { gitRoot, filePaths } = selection;
        const gitPaths = filePaths.map(filePath => toGitPath(gitRoot, filePath));

        const commitMessage = await promptForCommitMessage(gitRoot, gitPaths);
        if (!commitMessage) {
            // User cancelled
            return;
        }

        // Under progress, because a pre-commit hook can hold `git commit` for a long time and the
        // prompt has closed by now: without it the command looks like it did nothing at all.
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Quick Commit: committing" }, async () => {
            const stagedFiles = await getStagedFiles(gitRoot);

            // Stage files that aren't already staged
            const filesToStage = filePaths.filter(filePath => !stagedFiles.includes(filePath));
            if (filesToStage.length > 0) {
                await execGit(gitRoot, ["add", "--", ...filesToStage.map(fp => toGitPath(gitRoot, fp))]);
            }

            // Commit only the selected files
            // Note: git commit -- <files> commits only specified files and leaves other staged files in the staging area
            await execGit(gitRoot, ["commit", "-m", commitMessage.trim(), "--", ...gitPaths]);
        });

        const fileCount = filePaths.length;
        const fileWord = fileCount === 1 ? "file" : "files";
        vscode.window.showInformationMessage(`Quick Commit: Successfully committed ${fileCount} ${fileWord}.`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Quick Commit failed: ${errorMessage}`);
    }
}

import * as vscode from "vscode";
import * as path from "path";

import { collectResourceUris } from "./autoStage";
import { promptForCommitMessage } from "./commitMessageEditor";
import { execGit, findGitRoot, toGitPath } from "./gitCli";

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
    const filePaths = [...new Set(collectResourceUris(args).map(uri => uri.fsPath))];

    if (filePaths.length === 0) {
        vscode.window.showErrorMessage("No files selected for Quick Commit.");
        return;
    }

    // Find Git root for the first file
    const gitRoot = await findGitRoot(path.dirname(filePaths[0]));
    if (!gitRoot) {
        vscode.window.showErrorMessage("Could not find Git repository for selected files.");
        return;
    }

    // Verify all files belong to the same repository
    const allSameRepo = await Promise.all(
        filePaths.map(async filePath => {
            const root = await findGitRoot(path.dirname(filePath));
            return root === gitRoot;
        })
    );

    if (!allSameRepo.every(Boolean)) {
        vscode.window.showErrorMessage("Selected files must be from the same repository.");
        return;
    }

    const gitPaths = filePaths.map(filePath => toGitPath(gitRoot, filePath));

    const commitMessage = await promptForCommitMessage(gitRoot, gitPaths);
    if (!commitMessage) {
        // User cancelled
        return;
    }

    try {
        const stagedFiles = await getStagedFiles(gitRoot);

        // Stage files that aren't already staged
        const filesToStage = filePaths.filter(filePath => !stagedFiles.includes(filePath));
        if (filesToStage.length > 0) {
            await execGit(gitRoot, ["add", "--", ...filesToStage.map(fp => toGitPath(gitRoot, fp))]);
        }

        // Commit only the selected files
        // Note: git commit -- <files> commits only specified files and leaves other staged files in the staging area
        await execGit(gitRoot, ["commit", "-m", commitMessage.trim(), "--", ...gitPaths]);

        const fileCount = filePaths.length;
        const fileWord = fileCount === 1 ? "file" : "files";
        vscode.window.showInformationMessage(`Quick Commit: Successfully committed ${fileCount} ${fileWord}.`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Quick Commit failed: ${errorMessage}`);
    }
}

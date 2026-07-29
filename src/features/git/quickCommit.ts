import * as vscode from "vscode";
import * as path from "path";

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
    // Handle different invocation scenarios from SCM context menus
    let resourceStates: vscode.SourceControlResourceState[] = [];

    // VS Code passes multiple selected resources as separate arguments, not as an array
    // Each argument is a resource state object with resourceUri property
    for (const arg of args) {
        if (arg && typeof arg === 'object') {
            // Check if it's a resource group (has resourceStates property)
            if ('resourceStates' in arg) {
                const group = arg as vscode.SourceControlResourceGroup;
                resourceStates.push(...group.resourceStates);
            }
            // Check if it's a resource state (has resourceUri property)
            else if ('resourceUri' in arg) {
                resourceStates.push(arg as vscode.SourceControlResourceState);
            }
        }
    }

    if (resourceStates.length === 0) {
        vscode.window.showErrorMessage("No files selected for Quick Commit.");
        return;
    }

    // Get unique URIs and convert to file paths
    const filePaths = [...new Set(resourceStates.map((state) => state.resourceUri.fsPath))];

    // Find Git root for the first file
    const gitRoot = await findGitRoot(path.dirname(filePaths[0]));
    if (!gitRoot) {
        vscode.window.showErrorMessage("Could not find Git repository for selected files.");
        return;
    }

    // Verify all files belong to the same repository
    const allSameRepo = await Promise.all(
        filePaths.map(async (filePath) => {
            const root = await findGitRoot(path.dirname(filePath));
            return root === gitRoot;
        })
    );

    if (!allSameRepo.every(Boolean)) {
        vscode.window.showErrorMessage("Selected files must be from the same repository.");
        return;
    }

    // Prompt for commit message
    const commitMessage = await vscode.window.showInputBox({
        prompt: "Enter commit message",
        placeHolder: "Commit message",
        ignoreFocusOut: true,
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return "Commit message cannot be empty";
            }
            return null;
        },
    });

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
        await execGit(gitRoot, ["commit", "-m", commitMessage.trim(), "--", ...filePaths.map(fp => toGitPath(gitRoot, fp))]);

        const fileCount = filePaths.length;
        const fileWord = fileCount === 1 ? "file" : "files";
        vscode.window.showInformationMessage(`Quick Commit: Successfully committed ${fileCount} ${fileWord}.`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Quick Commit failed: ${errorMessage}`);
    }
}

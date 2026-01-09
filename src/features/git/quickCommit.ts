import * as vscode from "vscode";
import * as path from "path";
import * as cp from "child_process";
import { promisify } from "util";

const execAsync = promisify(cp.exec);

interface GitStatus {
    staged: string[];
    unstaged: string[];
}

async function execGit(cwd: string, args: string[]): Promise<string> {
    try {
        const { stdout } = await execAsync(`git ${args.join(" ")}`, { cwd });
        return stdout.trim();
    } catch (error: any) {
        throw new Error(error.stderr || error.message);
    }
}

async function findGitRoot(filePath: string): Promise<string | undefined> {
    try {
        const dir = path.dirname(filePath);
        const { stdout } = await execAsync("git rev-parse --show-toplevel", { cwd: dir });
        return stdout.trim();
    } catch {
        return undefined;
    }
}

async function getGitStatus(gitRoot: string): Promise<GitStatus> {
    const status = await execGit(gitRoot, ["status", "--porcelain"]);
    const staged: string[] = [];
    const unstaged: string[] = [];

    for (const line of status.split("\n")) {
        if (!line) continue;

        const stageStatus = line[0];
        const workStatus = line[1];
        const filePath = line.substring(3).trim();
        const fullPath = path.join(gitRoot, filePath);

        if (stageStatus !== " " && stageStatus !== "?") {
            staged.push(fullPath);
        }
        if (workStatus !== " " || stageStatus === "?") {
            unstaged.push(fullPath);
        }
    }

    return { staged, unstaged };
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
    const gitRoot = await findGitRoot(filePaths[0]);
    if (!gitRoot) {
        vscode.window.showErrorMessage("Could not find Git repository for selected files.");
        return;
    }

    // Verify all files belong to the same repository
    const allSameRepo = await Promise.all(
        filePaths.map(async (filePath) => {
            const root = await findGitRoot(filePath);
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
        // Get current git status
        const gitStatus = await getGitStatus(gitRoot);

        // Determine which files need staging
        const filesToStage: string[] = [];
        const alreadyStagedSelected: string[] = [];

        for (const filePath of filePaths) {
            if (gitStatus.staged.includes(filePath)) {
                alreadyStagedSelected.push(filePath);
            } else {
                filesToStage.push(filePath);
            }
        }

        // Stage files that aren't already staged
        if (filesToStage.length > 0) {
            const relativePaths = filesToStage.map(fp => path.relative(gitRoot, fp));
            await execGit(gitRoot, ["add", ...relativePaths]);
        }

        // Get list of files that were staged before (excluding our selection)
        const otherStaged = gitStatus.staged.filter(f => !filePaths.includes(f));

        // Commit only the selected files
        const allSelectedRelativePaths = filePaths.map(fp => path.relative(gitRoot, fp));
        await execGit(gitRoot, ["commit", "-m", commitMessage.trim(), "--", ...allSelectedRelativePaths]);

        // If there were other staged files, restore them to staged state
        // (git commit -- <files> removes them from stage if they weren't part of commit)
        if (otherStaged.length > 0) {
            const otherRelativePaths = otherStaged.map(fp => path.relative(gitRoot, fp));
            await execGit(gitRoot, ["add", ...otherRelativePaths]);
        }

        const fileCount = filePaths.length;
        const fileWord = fileCount === 1 ? "file" : "files";
        vscode.window.showInformationMessage(`Quick Commit: Successfully committed ${fileCount} ${fileWord}.`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Quick Commit failed: ${errorMessage}`);
    }
}

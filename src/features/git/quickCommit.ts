import * as vscode from "vscode";

interface GitExtension {
    getAPI(version: number): GitAPI;
}

interface GitAPI {
    repositories: Repository[];
}

interface Repository {
    rootUri: vscode.Uri;
    state: RepositoryState;
    add(paths: string[]): Promise<void>;
    commit(message: string): Promise<void>;
}

interface RepositoryState {
    workingTreeChanges: Change[];
    indexChanges: Change[];
    mergeChanges: Change[];
}

interface Change {
    uri: vscode.Uri;
}

interface SourceControlResourceState extends vscode.SourceControlResourceState {
    resourceUri: vscode.Uri;
}

function getGitAPI(): GitAPI | undefined {
    const gitExtension = vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (!gitExtension) {
        vscode.window.showErrorMessage("Git extension not found.");
        return undefined;
    }

    if (!gitExtension.isActive) {
        vscode.window.showErrorMessage("Git extension is not active.");
        return undefined;
    }

    return gitExtension.exports.getAPI(1);
}

function findRepositoryForUri(git: GitAPI, uri: vscode.Uri): Repository | undefined {
    return git.repositories.find((repo) => uri.fsPath.startsWith(repo.rootUri.fsPath));
}

export async function quickCommit(...args: unknown[]): Promise<void> {
    const git = getGitAPI();
    if (!git) {
        return;
    }

    if (git.repositories.length === 0) {
        vscode.window.showErrorMessage("No Git repositories found.");
        return;
    }

    // Handle both single and multiple selection scenarios
    // VS Code passes: (clicked item, all selected items) for context menu
    let resourceStates: SourceControlResourceState[] = [];

    if (args.length >= 2 && Array.isArray(args[1])) {
        // Multiple files selected - args[1] is the array of all selected items
        resourceStates = args[1] as SourceControlResourceState[];
    } else if (args.length >= 1 && args[0] && typeof args[0] === "object" && "resourceUri" in args[0]) {
        // Single file selected
        resourceStates = [args[0] as SourceControlResourceState];
    }

    if (resourceStates.length === 0) {
        vscode.window.showErrorMessage("No files selected for Quick Commit.");
        return;
    }

    // Get unique URIs
    const uris = resourceStates.map((state) => state.resourceUri);

    // Find the repository for the first file (assume all files are in the same repo)
    const repository = findRepositoryForUri(git, uris[0]);
    if (!repository) {
        vscode.window.showErrorMessage("Could not find Git repository for selected files.");
        return;
    }

    // Verify all files belong to the same repository
    const allSameRepo = uris.every((uri) => {
        const repo = findRepositoryForUri(git, uri);
        return repo && repo.rootUri.fsPath === repository.rootUri.fsPath;
    });
    if (!allSameRepo) {
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
        // Stage the selected files (Git API expects string paths)
        const paths = uris.map((uri) => uri.fsPath);
        await repository.add(paths);

        // Commit with the message
        await repository.commit(commitMessage.trim());

        const fileCount = uris.length;
        const fileWord = fileCount === 1 ? "file" : "files";
        vscode.window.showInformationMessage(`Quick Commit: Successfully committed ${fileCount} ${fileWord}.`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Quick Commit failed: ${errorMessage}`);
    }
}

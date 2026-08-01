import * as vscode from "vscode";

/**
 * The slice of the built-in Git extension's API this extension needs: finding the repository behind
 * a Source Control view and writing into its commit message box. Declared by hand rather than
 * vendoring the full `git.d.ts`, which is several hundred lines describing operations we never call.
 */

interface GitInputBox {
    value: string;
}

export interface GitRepository {
    readonly rootUri: vscode.Uri;
    readonly inputBox: GitInputBox;
}

interface GitApi {
    readonly repositories: GitRepository[];
}

interface GitExtension {
    getAPI(version: 1): GitApi;
}

async function getGitApi(): Promise<GitApi | undefined> {
    const extension = vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (!extension) {
        return undefined;
    }

    const exports = extension.isActive ? extension.exports : await extension.activate();
    return exports?.getAPI(1);
}

function isRepositoryLike(value: unknown): value is GitRepository {
    return typeof value === "object" && value !== null && "rootUri" in value && "inputBox" in value;
}

/** Picks the repository the command was invoked against, asking only when it is genuinely ambiguous. */
export async function resolveRepository(args: unknown[]): Promise<GitRepository | undefined> {
    // The SCM menus hand back the repository itself when they hand back anything at all.
    const fromArgs = args.find(isRepositoryLike);
    if (fromArgs) {
        return fromArgs;
    }

    const api = await getGitApi();
    const repositories = api?.repositories ?? [];

    if (repositories.length <= 1) {
        return repositories[0];
    }

    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (activeUri?.scheme === "file") {
        const containing = repositories
            .filter(repository => activeUri.fsPath.startsWith(repository.rootUri.fsPath))
            .sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length);

        if (containing.length > 0) {
            return containing[0];
        }
    }

    const picked = await vscode.window.showQuickPick(
        repositories.map(repository => ({ label: vscode.workspace.asRelativePath(repository.rootUri, false), repository })),
        { title: "Generate Commit Message", placeHolder: "Select a repository" }
    );

    return picked?.repository;
}

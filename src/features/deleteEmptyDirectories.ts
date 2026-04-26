import * as vscode from "vscode";
import ignore, { Ignore } from "ignore";

async function loadIgnoreForDir(dirUri: vscode.Uri): Promise<Ignore> {
    const ig = ignore();
    try {
        const gitignoreUri = vscode.Uri.joinPath(dirUri, ".gitignore");
        const bytes = await vscode.workspace.fs.readFile(gitignoreUri);
        const text = Buffer.from(bytes).toString("utf-8");

        // Strip trailing slashes: since we only ever test directory paths,
        // "cache/" and "cache" are identical in this context.
        const normalized = text
            .split("\n")
            .map(line => line.trimEnd().endsWith("/") ? line.trimEnd().slice(0, -1) : line)
            .join("\n");

        ig.add(normalized);
    } catch {
        // No .gitignore in this directory — that's fine
    }
    return ig;
}

function isIgnored(relativePath: string, igChain: Ignore[]): boolean {
    return igChain.some(ig => ig.ignores(relativePath));
}

/**
 * Collects URIs of empty directories bottom-up (deepest first).
 * Respects .gitignore files at every level of the tree.
 */
async function collectEmptyDirs(
    dirUri: vscode.Uri,
    rootUri: vscode.Uri,
    igChain: Ignore[],
    relativeBase: string = "",
): Promise<vscode.Uri[]> {
    // Load any .gitignore in this directory and append to the chain
    const localIg = await loadIgnoreForDir(dirUri);
    const currentChain = [...igChain, localIg];

    const entries = await vscode.workspace.fs.readDirectory(dirUri);

    if (entries.length === 0) {
        return [dirUri];
    }

    const subdirs = entries.filter(([, type]) => type === vscode.FileType.Directory);
    const hasFiles = entries.some(([, type]) => type !== vscode.FileType.Directory);

    if (hasFiles) {
        const results: vscode.Uri[] = [];
        for (const [name] of subdirs) {
            const relativePath = relativeBase ? `${relativeBase}/${name}` : name;
            if (isIgnored(relativePath, currentChain)) continue;
            const childUri = vscode.Uri.joinPath(dirUri, name);
            results.push(...(await collectEmptyDirs(childUri, rootUri, currentChain, relativePath)));
        }
        return results;
    }

    // Only subdirs — recurse and check whether all non-ignored children are empty
    const results: vscode.Uri[] = [];
    let allChildrenEmpty = true;

    for (const [name] of subdirs) {
        const relativePath = relativeBase ? `${relativeBase}/${name}` : name;
        if (isIgnored(relativePath, currentChain)) {
            allChildrenEmpty = false; // ignored dir counts as physical content
            continue;
        }
        const childUri = vscode.Uri.joinPath(dirUri, name);
        const childEmptyUris = await collectEmptyDirs(childUri, rootUri, currentChain, relativePath);
        results.push(...childEmptyUris);

        const childIsEmpty =
            childEmptyUris.length > 0 &&
            childEmptyUris[childEmptyUris.length - 1].toString() === childUri.toString();
        if (!childIsEmpty) allChildrenEmpty = false;
    }

    if (allChildrenEmpty) {
        results.push(dirUri);
    }

    return results;
}

export async function deleteEmptyDirectories(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage("No workspace folder is open.");
        return;
    }

    const rootUri = workspaceFolders[0].uri;
    let emptyDirs: vscode.Uri[] = [];

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Scanning for empty directories..." },
        async () => {
            const rootIg = await loadIgnoreForDir(rootUri);
            const allEmpty = await collectEmptyDirs(rootUri, rootUri, [rootIg]);
            emptyDirs = allEmpty.filter(uri => uri.toString() !== rootUri.toString());
        },
    );

    if (emptyDirs.length === 0) {
        vscode.window.showInformationMessage("No empty directories found.");
        return;
    }

    const answer = await vscode.window.showWarningMessage(
        `Found ${emptyDirs.length} empty ${emptyDirs.length === 1 ? "directory" : "directories"}. Delete?`,
        "Delete",
        "Cancel",
    );

    if (answer !== "Delete") return;

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Deleting empty directories" },
        async progress => {
            for (let i = 0; i < emptyDirs.length; i++) {
                progress.report({
                    message: `${i + 1} of ${emptyDirs.length}`,
                    increment: (1 / emptyDirs.length) * 100,
                });
                await vscode.workspace.fs.delete(emptyDirs[i], { recursive: false });
            }
        },
    );

    vscode.window.showInformationMessage(
        `Deleted ${emptyDirs.length} empty ${emptyDirs.length === 1 ? "directory" : "directories"}.`,
    );
}
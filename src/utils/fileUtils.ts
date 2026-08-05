import * as path from "node:path";
import * as vscode from "vscode";

export namespace FileUtils {
    /** Finds nearest files matching pattern. Supports multi-workspace. */
    export async function findNearest(startFolderPath: string, pattern: string): Promise<string[]> {
        const foundFilePaths: string[] = [];
        const folderUri = vscode.Uri.file(startFolderPath);

        const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folderUri, pattern), null, 1);
        if (files.length > 0) {
            foundFilePaths.push(files[0].fsPath);
        }

        // look in parent folder
        if (foundFilePaths.length === 0) {
            const parentFolder = path.dirname(startFolderPath);

            // Get the workspace folder for this specific path (supports multi-workspace)
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(folderUri);
            const workspaceRoot = workspaceFolder?.uri.fsPath;

            // Stop if we reached the workspace folder root or can't go higher
            if (!workspaceRoot || parentFolder === workspaceRoot || parentFolder === startFolderPath) {
                return foundFilePaths;
            }

            const files = await findNearest(parentFolder, pattern);
            foundFilePaths.push(...files);
        }

        return foundFilePaths;
    }

    /** The folder a file belongs to, falling back to the first open one for untitled documents. */
    export function resolveWorkspaceFolder(uri?: vscode.Uri): vscode.WorkspaceFolder | undefined {
        return (uri && vscode.workspace.getWorkspaceFolder(uri)) || vscode.workspace.workspaceFolders?.[0];
    }

    /** A file's contents as text, or undefined when it does not exist or cannot be read. */
    export async function readTextIfExists(uri: vscode.Uri): Promise<string | undefined> {
        try {
            return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        } catch {
            return undefined;
        }
    }

    export function getImportPath(fromFilePath: string, toFilePath: string): string {
        const fromDirectory = path.dirname(fromFilePath);
        const relativePath = path.relative(fromDirectory, toFilePath);
        const relativePathWithoutExtension = relativePath.replace(/\.[^/.]+$/, "");
        const importPath = relativePathWithoutExtension.replace(/\\/g, "/");
        return importPath.startsWith(".") ? importPath : "./" + importPath;
    }
}

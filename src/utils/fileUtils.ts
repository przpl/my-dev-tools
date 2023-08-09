import * as path from "node:path";
import * as vscode from "vscode";

export namespace FileUtils {
    /** Finds nearest files matching pattern. */
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
            const activeWorkspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath; // TODO: support multiple workspaces

            // stop if we reached the workspace folder, don't go above
            if (parentFolder === activeWorkspaceFolder) {
                return foundFilePaths;
            }

            if (parentFolder !== startFolderPath) {
                const files = await findNearest(parentFolder, pattern);
                foundFilePaths.push(...files);
            }
        }

        return foundFilePaths;
    }

    export function getImportPath(fromFilePath: string, toFilePath: string): string {
        const fromDirectory = path.dirname(fromFilePath);
        const relativePath = path.relative(fromDirectory, toFilePath);
        const relativePathWithoutExtension = relativePath.replace(/\.[^/.]+$/, "");
        const importPath = relativePathWithoutExtension.replace(/\\/g, "/");
        return importPath.startsWith(".") ? importPath : "./" + importPath;
    }
}

import * as path from "node:path";
import * as vscode from "vscode";
import { FileUtils } from "../utils/fileUtils";

/** Opens nearest file matching pattern found in parent folders. */
export async function openNearestFile(pattern: string) {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        const folderPath = path.dirname(activeEditor.document.uri.fsPath);
        const indexFiles = await FileUtils.findNearest(folderPath, pattern);

        if (indexFiles.length > 0) {
            const indexUri = vscode.Uri.file(indexFiles[0]);
            vscode.window.showTextDocument(indexUri);
        } else {
            vscode.window.showInformationMessage(`No nearest ${pattern} file found.`);
        }
    }
}

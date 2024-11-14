import { camelCase, kebabCase, pascalCase, snakeCase } from "es-toolkit";
import * as path from "node:path";
import * as vscode from "vscode";

export function renameToCamelCase() {
    renameFile((str) => transformFileName(str, camelCase));
}

export function renameToPascalCase() {
    renameFile((str) => transformFileName(str, pascalCase));
}

export function renameToSnakeCase() {
    renameFile((str) => transformFileName(str, snakeCase));
}

export function renameToKebabCase() {
    renameFile((str) => transformFileName(str, kebabCase));
}

function transformFileName(str: string, transformFunc: (str: string) => string): string {
    const ext = path.extname(str);
    const baseName = path.basename(str, ext);
    return `${transformFunc(baseName)}${ext}`;
}

async function renameFile(transform: (str: string) => string) {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        const oldUri = activeEditor.document.uri;
        const oldPath = oldUri.fsPath;
        const oldName = path.basename(oldPath);
        const newName = transform(oldName);
        const newPath = path.join(path.dirname(oldPath), newName);
        const newUri = vscode.Uri.file(newPath);

        const workspaceEdit = new vscode.WorkspaceEdit();
        workspaceEdit.renameFile(oldUri, newUri);

        const success = await vscode.workspace.applyEdit(workspaceEdit);
        if (!success) {
            vscode.window.showErrorMessage("Failed to rename file.");
        }
    } else {
        vscode.window.showErrorMessage("No active file to rename.");
    }
}

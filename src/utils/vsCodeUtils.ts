import * as vscode from "vscode";

interface Context {
    document: vscode.TextDocument;
    text: string;
}

export namespace VsCodeUtils {
    /**
     * Applies changes to the workspace using a standard WorkspaceEdit pattern
     */
    export async function applyChangesToWorkspace(context: Context, updatedText: string): Promise<boolean> {
        const fullRange = new vscode.Range(context.document.positionAt(0), context.document.positionAt(context.text.length));

        const edit = new vscode.WorkspaceEdit();
        edit.replace(context.document.uri, fullRange, updatedText);

        return await vscode.workspace.applyEdit(edit);
    }

    /**
     * Moves cursor to a specific position in the document
     */
    export function moveCursorToPosition(editor: vscode.TextEditor, document: vscode.TextDocument, offset: number): void {
        const cursorPosition = document.positionAt(offset);
        editor.selection = new vscode.Selection(cursorPosition, cursorPosition);
        editor.revealRange(new vscode.Range(cursorPosition, cursorPosition));
    }
}

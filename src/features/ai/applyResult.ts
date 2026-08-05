import * as vscode from "vscode";

import type { ProposedChange } from "./resultReview";

/**
 * Writes accepted proposals through a single WorkspaceEdit, so a whole run — however many files it
 * touched or created — is one undo away from never having happened.
 */

export async function applyChanges(changes: ProposedChange[]): Promise<boolean> {
    if (changes.length === 0) {
        return true;
    }

    const edit = new vscode.WorkspaceEdit();

    for (const change of changes) {
        if (change.isNew) {
            edit.createFile(change.uri, { overwrite: false, ignoreIfExists: true });
            edit.insert(change.uri, new vscode.Position(0, 0), change.proposed);
            continue;
        }

        // `partial` is set when only the selection was rewritten; replacing just it keeps the rest
        // of the document's folding, decorations and cursor where they were.
        if (change.partial) {
            edit.replace(change.uri, change.partial.range, change.partial.text);
        } else {
            const document = await vscode.workspace.openTextDocument(change.uri);
            edit.replace(change.uri, fullRange(document), change.proposed);
        }
    }

    return await vscode.workspace.applyEdit(edit);
}

function fullRange(document: vscode.TextDocument): vscode.Range {
    return new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
}

/** Opens what the run created, so a generated test file is in front of the user immediately. */
export async function openCreatedFiles(changes: ProposedChange[]): Promise<void> {
    for (const change of changes.filter(entry => entry.isNew)) {
        const document = await vscode.workspace.openTextDocument(change.uri);
        await vscode.window.showTextDocument(document, { preview: false });
    }
}

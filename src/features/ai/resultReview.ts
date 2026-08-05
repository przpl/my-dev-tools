import * as path from "node:path";
import * as vscode from "vscode";

/**
 * The confirmation step every AI command goes through: the proposal opens in a diff editor and
 * nothing touches the workspace until it is accepted. A model editing a whole file is exactly the
 * kind of change that is cheap to review and expensive to notice later.
 *
 * The right-hand side is served from memory through a content provider rather than written to a
 * temporary file, so a discarded proposal leaves nothing behind.
 */

const SCHEME = "mydevtools-ai";

const contents = new Map<string, string>();
let nextKey = 0;

/** A read-only document holding `text`, named after `relativePath` so the diff gets syntax colouring. */
function virtualDocument(relativePath: string, text: string): vscode.Uri {
    const key = String(nextKey++);
    contents.set(key, text);

    return vscode.Uri.from({ scheme: SCHEME, path: `/${relativePath.replace(/\\/g, "/")}`, query: key });
}

export function registerProposalContentProvider(): vscode.Disposable {
    const provider: vscode.TextDocumentContentProvider = {
        provideTextDocumentContent: uri => contents.get(uri.query) ?? "",
    };

    return vscode.Disposable.from(vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider), {
        dispose: () => contents.clear(),
    });
}

export interface ProposedChange {
    uri: vscode.Uri;
    /** Workspace-relative, for titles and messages. */
    relativePath: string;
    /** The file as it is now; empty for a file that does not exist yet. */
    original: string;
    /** The whole file as it would be. The diff needs whole files even when only a range is edited. */
    proposed: string;
    /** Set when only part of the document changes, so the edit can be narrower than the diff. */
    partial?: { range: vscode.Range; text: string };
    isNew: boolean;
}

export type ReviewDecision = "apply" | "skip" | "discard";

/** True when the model gave back far less than it was given, which usually means it truncated. */
function looksTruncated(change: ProposedChange): boolean {
    return !change.isNew && change.original.length > 400 && change.proposed.length < change.original.length / 2;
}

function describe(change: ProposedChange, index: number, total: number): string {
    const counter = total > 1 ? ` (${index + 1} of ${total})` : "";
    const name = path.basename(change.relativePath);

    if (change.isNew) {
        return `Create ${name}?${counter}`;
    }
    if (looksTruncated(change)) {
        return `Apply changes to ${name}? The result is much shorter than the original — check the diff.${counter}`;
    }

    return `Apply changes to ${name}?${counter}`;
}

/** Closes the diff we opened, leaving any other editor the user had open alone. */
async function closeDiff(modified: vscode.Uri): Promise<void> {
    const tabs = vscode.window.tabGroups.all
        .flatMap(group => group.tabs)
        .filter(tab => tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.toString() === modified.toString());

    if (tabs.length > 0) {
        await vscode.window.tabGroups.close(tabs, false);
    }
}

/**
 * Shows one proposal and waits for a verdict. The notification is non-modal on purpose: the point
 * of opening a diff is to be able to scroll it before deciding.
 */
export async function reviewChange(change: ProposedChange, title: string, index = 0, total = 1): Promise<ReviewDecision> {
    const modified = virtualDocument(change.relativePath, change.proposed);
    const original = change.isNew ? virtualDocument(change.relativePath, "") : change.uri;
    const name = path.basename(change.relativePath);

    await vscode.commands.executeCommand(
        "vscode.diff",
        original,
        modified,
        `${name} ↔ ${title}${change.isNew ? " (new file)" : ""}`,
        { preview: true }
    );

    const buttons = total > 1 ? ["Apply", "Skip", "Discard all"] : ["Apply", "Discard"];
    const choice = await vscode.window.showInformationMessage(describe(change, index, total), ...buttons);

    await closeDiff(modified);

    if (choice === "Apply") {
        return "apply";
    }

    // Dismissing the notification is a decision not to apply, not an invitation to keep asking.
    return choice === "Skip" ? "skip" : "discard";
}

/** Reviews every proposal in turn and returns the ones accepted. */
export async function reviewChanges(changes: ProposedChange[], title: string): Promise<ProposedChange[]> {
    const accepted: ProposedChange[] = [];

    for (const [index, change] of changes.entries()) {
        const decision = await reviewChange(change, title, index, changes.length);

        if (decision === "discard") {
            return [];
        }
        if (decision === "apply") {
            accepted.push(change);
        }
    }

    return accepted;
}

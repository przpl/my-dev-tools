import * as path from "path";
import * as vscode from "vscode";

import { COMMIT_EDITOR_FILE_NAME } from "../../features/git/commitMessageEditor";

/**
 * Stubs for the parts of the window a command talks back through, and the waiting that a prompt
 * opening a real editor requires. No mocking library: everything here is an assignment over the
 * `vscode` namespace, undone by `restoreMessages` in a suite's `teardown`.
 */

const MESSAGE_FUNCTIONS = {
    information: "showInformationMessage",
    warning: "showWarningMessage",
    error: "showErrorMessage",
} as const;

export type MessageKind = keyof typeof MESSAGE_FUNCTIONS;

const originals = new Map<MessageKind, unknown>();

/**
 * Replaces one of the window's message functions and returns a reader for what it was last told.
 * The message is read rather than asserted on the spot so a failure cannot leave the stub in place.
 */
export function captureMessage(kind: MessageKind = "information"): () => string {
    const name = MESSAGE_FUNCTIONS[kind];

    if (!originals.has(kind)) {
        originals.set(kind, vscode.window[name]);
    }

    let message = "";
    Object.assign(vscode.window, {
        [name]: async (value: string) => {
            message = value;
            return undefined;
        },
    });

    return () => message;
}

/** Restores every message function captured so far. Safe to call when none were. */
export function restoreMessages(): void {
    for (const [kind, original] of originals) {
        Object.assign(vscode.window, { [MESSAGE_FUNCTIONS[kind]]: original });
    }

    originals.clear();
}

export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** A SecretStorage backed by a Map, so nothing touches the real keychain. */
export function fakeSecrets(initialApiKey?: string): vscode.SecretStorage {
    const store = new Map<string, string>();
    if (initialApiKey !== undefined) {
        store.set("myDevTools.openRouter.apiKey", initialApiKey);
    }

    return {
        keys: async () => [...store.keys()],
        get: async key => store.get(key),
        store: async (key, value) => void store.set(key, value),
        delete: async key => void store.delete(key),
        onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event,
    };
}

export function commitEditorPath(repo: string): string {
    return path.join(repo, ".git", COMMIT_EDITOR_FILE_NAME);
}

export interface CommitEditorOptions {
    /**
     * Require the comment block rather than the file name alone. The scratch file is a real file an
     * earlier window can leave behind, so a tab with that name proves nothing about a live prompt.
     */
    withComments?: boolean;
}

/** This repository's commit editor: a previous test's editor can still be visible when the next starts. */
export function findCommitEditor(repo: string, options: CommitEditorOptions = {}): vscode.TextEditor | undefined {
    const expected = vscode.Uri.file(commitEditorPath(repo)).toString();

    return vscode.window.visibleTextEditors.find(
        editor =>
            editor.document.uri.toString() === expected && (!options.withComments || editor.document.getText().includes("# Committing"))
    );
}

/** The prompt opens a real editor, so the tests wait for it rather than stubbing one. */
export async function waitForCommitEditor(repo: string, options: CommitEditorOptions = {}): Promise<vscode.TextEditor> {
    for (let attempt = 0; attempt < 100; attempt++) {
        const editor = findCommitEditor(repo, options);
        if (editor) {
            return editor;
        }

        await delay(50);
    }

    throw new Error("The commit message editor never opened");
}

export async function waitForCommitEditorToClose(repo: string): Promise<void> {
    for (let attempt = 0; attempt < 100 && findCommitEditor(repo); attempt++) {
        await delay(50);
    }
}

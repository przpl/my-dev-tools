import * as path from "path";
import * as vscode from "vscode";

import { NothingToDescribeError, generateCommitMessage } from "./commitContext";
import { openCommitMessageEditor } from "./commitMessageEditor";

/**
 * The commit message prompt: an input box, because a commit message is nearly always one line and
 * an input box is the shortest path to typing one - open, type, Enter, done. No tab, no file, no
 * button to hunt for, and Escape means cancel the way it does everywhere else.
 *
 * The one thing it cannot do is a body, so the prompt carries a button that hands what is typed
 * over to a real editor. That is the exception; it is not the way in.
 */

const MAX_FILES_IN_PROMPT = 4;

export const EDITOR_BUTTON_TOOLTIP = "Write a longer message in an editor";
export const GENERATE_BUTTON_TOOLTIP = "Generate commit message";

const editorButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon("edit"), tooltip: EDITOR_BUTTON_TOOLTIP };
const generateButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon("sparkle"), tooltip: GENERATE_BUTTON_TOOLTIP };

function summarizeFiles(paths: string[]): string {
    const names = paths.slice(0, MAX_FILES_IN_PROMPT).map(filePath => path.basename(filePath));
    const remaining = paths.length - names.length;

    return remaining > 0 ? `${names.join(", ")} and ${remaining} more` : names.join(", ");
}

/**
 * Asks for a commit message and resolves with it, or with `undefined` if the prompt is dismissed.
 * `targetBranch` names the branch in the title when the commit is not headed for the checked-out one.
 */
export function promptForCommitMessage(gitRoot: string, paths: string[], targetBranch?: string): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve, reject) => {
        const input = vscode.window.createInputBox();
        const fileWord = paths.length === 1 ? "file" : "files";

        input.title = `Commit ${paths.length} ${fileWord}${targetBranch ? ` to ${targetBranch}` : ""}`;
        input.placeholder = "Commit message";
        input.prompt = summarizeFiles(paths);
        input.buttons = [generateButton, editorButton];
        // A commit message survives a click on the editor underneath, or on a notification.
        input.ignoreFocusOut = true;

        // Everything below can settle the prompt, including the box hiding itself, and a prompt that
        // settles twice resolves a promise the commit is no longer waiting on.
        let settled = false;

        function settle(message: string | undefined): void {
            if (settled) {
                return;
            }

            settled = true;
            input.dispose();
            resolve(message);
        }

        /** Carries what is typed over to the editor, which then owns the answer. */
        function handOverToEditor(message: string): void {
            if (settled) {
                return;
            }

            settled = true;
            input.dispose();
            openCommitMessageEditor(gitRoot, paths, { targetBranch, initialMessage: message || undefined }).then(resolve, reject);
        }

        async function generate(): Promise<void> {
            input.busy = true;
            input.enabled = false;

            try {
                const message = await generateCommitMessage(gitRoot, { paths, hint: input.value.trim() || undefined });

                if (settled) {
                    return;
                }

                // A generated body is exactly what this box cannot hold, so it goes where it fits.
                if (message.includes("\n")) {
                    handOverToEditor(message);
                    return;
                }

                input.value = message;
            } catch (error) {
                if (error instanceof NothingToDescribeError) {
                    vscode.window.showInformationMessage(error.message);
                } else {
                    vscode.window.showErrorMessage(`Generation failed: ${error instanceof Error ? error.message : String(error)}`);
                }
            } finally {
                if (!settled) {
                    input.busy = false;
                    input.enabled = true;
                }
            }
        }

        input.onDidAccept(() => {
            const message = input.value.trim();

            if (message.length === 0) {
                input.validationMessage = "Commit message cannot be empty.";
                return;
            }

            settle(message);
        });

        input.onDidChangeValue(() => (input.validationMessage = undefined));

        input.onDidTriggerButton(button => {
            if (button === editorButton) {
                handOverToEditor(input.value.trim());
            } else {
                void generate();
            }
        });

        // Escape, or anything else that dismisses the box, is a cancellation.
        input.onDidHide(() => settle(undefined));

        input.show();
    });
}

import * as vscode from "vscode";

/**
 * A stand-in for `window.createInputBox`, so a test can answer the commit prompt.
 *
 * The prompt is an input box rather than an editor, and a test window cannot type into one: quick
 * inputs live in the workbench, outside the extension host, with no API to drive them. The box is
 * therefore replaced with one whose events a test fires by hand - which still exercises everything
 * the extension does with it, buttons and validation included.
 */

const original = vscode.window.createInputBox;

export class FakeInputBox {
    value = "";
    placeholder: string | undefined;
    prompt: string | undefined;
    title: string | undefined;
    validationMessage: string | vscode.InputBoxValidationMessage | undefined;
    enabled = true;
    busy = false;
    ignoreFocusOut = false;
    buttons: readonly vscode.QuickInputButton[] = [];

    private readonly acceptEmitter = new vscode.EventEmitter<void>();
    private readonly changeEmitter = new vscode.EventEmitter<string>();
    private readonly buttonEmitter = new vscode.EventEmitter<vscode.QuickInputButton>();
    private readonly hideEmitter = new vscode.EventEmitter<void>();

    readonly onDidAccept = this.acceptEmitter.event;
    readonly onDidChangeValue = this.changeEmitter.event;
    readonly onDidTriggerButton = this.buttonEmitter.event;
    readonly onDidHide = this.hideEmitter.event;

    constructor(private readonly behaviour: (input: FakeInputBox) => void | Promise<void>) {}

    show(): void {
        void this.behaviour(this);
    }

    /** Escape, or anything else that dismisses the box. */
    cancel(): void {
        this.hideEmitter.fire();
    }

    dispose(): void {}

    /** Types a message and presses Enter. */
    accept(message: string): void {
        this.type(message);
        this.acceptEmitter.fire();
    }

    type(message: string): void {
        this.value = message;
        this.changeEmitter.fire(message);
    }

    click(tooltip: string): void {
        const button = this.buttons.find(candidate => candidate.tooltip === tooltip);
        if (!button) {
            throw new Error(`The prompt has no ${tooltip} button`);
        }

        this.buttonEmitter.fire(button);
    }
}

/** Replaces the input box for one prompt. Restore with `restoreInputBox` in a teardown. */
export function stubInputBox(behaviour: (input: FakeInputBox) => void | Promise<void>): void {
    vscode.window.createInputBox = () => new FakeInputBox(behaviour) as unknown as vscode.InputBox;
}

export function restoreInputBox(): void {
    vscode.window.createInputBox = original;
}

import * as assert from "assert";
import * as vscode from "vscode";

import { addUndefinedPropsToInterface } from "../../../features/react/addUndefinedPropsToInterface";

suite("AddUndefinedPropsToInterface Tests", () => {
    let testDocument: vscode.TextDocument;
    let testEditor: vscode.TextEditor;

    setup(async () => {
        testDocument = await vscode.workspace.openTextDocument({
            content: "",
            language: "typescriptreact",
        });
        testEditor = await vscode.window.showTextDocument(testDocument);
    });

    teardown(async () => {
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    });

    async function type(code: string): Promise<void> {
        await testEditor.edit(editBuilder => {
            editBuilder.insert(new vscode.Position(0, 0), code);
        });
    }

    /** An untitled document takes the platform line ending, which is not what any of this is about. */
    function text(): string {
        return testDocument.getText().replace(/\r\n/g, "\n");
    }

    /** The properties only: the component below the interface mentions the same names for other reasons. */
    function propsBody(): string {
        const body = /interface Props \{([\s\S]*?)\}/.exec(text());
        assert.ok(body, `No Props interface in:\n${text()}`);
        return body[1];
    }

    async function run(code: string): Promise<string> {
        await type(code);
        await addUndefinedPropsToInterface();

        return propsBody();
    }

    test("should add an identifier used in a JSX attribute expression", async () => {
        const updated = await run(`interface Props {
}

function MyComponent({ }: Props) {
    return <div id={label} />;
}`);

        assert.ok(updated.includes("label: string"), updated);
    });

    test("should add an identifier used in a JSX child expression", async () => {
        const updated = await run(`interface Props {
}

function MyComponent({ }: Props) {
    return <div>{label}</div>;
}`);

        assert.ok(updated.includes("label: string"), updated);
    });

    test("should add the property name behind a props parameter, not the parameter", async () => {
        const updated = await run(`interface Props {
}

function MyComponent(props: Props) {
    return <div className={props.className} />;
}`);

        assert.ok(updated.includes("className: string"), updated);
        assert.ok(!updated.includes("props"), "Should not add the props parameter itself as a prop");
    });

    test("should add the object of a property access, not the property", async () => {
        const updated = await run(`interface Props {
}

function MyComponent({ }: Props) {
    return <div>{user.name}</div>;
}`);

        assert.ok(updated.includes("user: unknown"), updated);
        assert.ok(!updated.includes("name"), "Should not add the accessed property as a prop");
    });

    test("should not re-add a prop that is already declared or destructured", async () => {
        const updated = await run(`interface Props {
    title: string;
}

function MyComponent({ title, label }: Props) {
    return <div id={title}>{label}</div>;
}`);

        assert.strictEqual((updated.match(/title: string/g) ?? []).length, 1, updated);
        assert.ok(!updated.includes("label"), "A destructured name is already a prop in the making");
    });

    test("should ignore imports, outer scope variables and built-ins", async () => {
        const updated = await run(`import React from "react";
import { useMemo } from "react";

const outerValue = 1;

interface Props {
}

function MyComponent({ }: Props) {
    return (
        <div id={outerValue} title={React.version}>
            {useMemo}
            {Math.max(1, 2)}
            {console.name}
        </div>
    );
}`);

        assert.strictEqual(updated.trim(), "", `Nothing in this component is undefined, but the interface gained:${updated}`);
    });

    test("should guess a type from the prop name", async () => {
        const updated = await run(`interface Props {
}

function MyComponent({ }: Props) {
    return <div className={className} id={isActive} title={isHighlighted} lang={itemCount} onClick={onClick} dir={zzz} />;
}`);

        assert.ok(updated.includes("className: string"), updated);
        assert.ok(updated.includes("isActive: boolean"), updated);
        // Only the `is` prefix rule can type this one; `isActive` is an exact match in the table.
        assert.ok(updated.includes("isHighlighted: boolean"), updated);
        assert.ok(updated.includes("itemCount: number"), updated);
        assert.ok(updated.includes("onClick: () => void"), updated);
        assert.ok(updated.includes("zzz: unknown"), updated);
    });

    test("should report and change nothing when every identifier is known", async () => {
        const code = `interface Props {
    title: string;
}

function MyComponent({ title }: Props) {
    return <div>{title}</div>;
}`;

        await type(code);

        let infoMessage = "";
        const originalShowInformationMessage = vscode.window.showInformationMessage;
        vscode.window.showInformationMessage = (async (message: string) => {
            infoMessage = message;
            return undefined;
        }) as typeof vscode.window.showInformationMessage;

        try {
            await addUndefinedPropsToInterface();
        } finally {
            vscode.window.showInformationMessage = originalShowInformationMessage;
        }

        assert.strictEqual(infoMessage, "No undefined props found in the component");
        assert.strictEqual(text(), code);
    });
});

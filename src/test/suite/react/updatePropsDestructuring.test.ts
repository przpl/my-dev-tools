import * as assert from "assert";
import * as vscode from "vscode";
import { updatePropsDestructuring } from "../../../features/react/updatePropsDestructuring";

suite("UpdatePropsDestructuring Tests", () => {
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

    test("should update props destructuring when interface changes", async () => {
        const initialCode = `interface Props {
    name: string;
    age: number;
}

function MyComponent({ name }: Props) {
    return <div>{name}</div>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), initialCode);
        });

        await updatePropsDestructuring(testDocument);
        const updatedContent = testDocument.getText();

        assert.ok(
            updatedContent.includes("function MyComponent({ name, age }: Props) {"),
            "Should include both name and age in destructuring"
        );
    });

    test("should handle extended interfaces", async () => {
        const codeWithExtendedInterface = `interface BaseProps {
    id: string;
    className?: string;
}

interface Props extends BaseProps {
    title: string;
    onClick: () => void;
}

function MyComponent({ title }: Props) {
    return <button>{title}</button>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), codeWithExtendedInterface);
        });

        await updatePropsDestructuring(testDocument);
        const updatedContent = testDocument.getText();

        assert.ok(
            updatedContent.includes("function MyComponent({ title, onClick, id, className }: Props) {"),
            "Should include optional properties in destructuring"
        );
    });

    test("should not modify non-destructured parameters", async () => {
        const codeWithNonDestructuredProps = `interface Props {
    name: string;
    age: number;
}

function MyComponent(props: Props) {
    return <div>{props.name}</div>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), codeWithNonDestructuredProps);
        });

        const originalContent = testDocument.getText();
        await updatePropsDestructuring(testDocument);
        const updatedContent = testDocument.getText();

        assert.strictEqual(originalContent, updatedContent, "Should not modify non-destructured parameters");
    });

    test("should handle empty interface gracefully", async () => {
        const codeWithEmptyInterface = `interface Props {
}

function MyComponent({ }: Props) {
    return <div>No props</div>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), codeWithEmptyInterface);
        });

        const originalContent = testDocument.getText();
        await updatePropsDestructuring(testDocument);
        const updatedContent = testDocument.getText();

        // Should not change empty interface (it's already correct)
        assert.strictEqual(originalContent, updatedContent, "Should not modify empty interface destructuring");
    });

    test("should handle optional properties", async () => {
        const codeWithOptionalProps = `interface Props {
    name: string;
    age?: number;
    email?: string;
}

function MyComponent({ name }: Props) {
    return <div>{name}</div>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), codeWithOptionalProps);
        });

        await updatePropsDestructuring(testDocument);
        const updatedContent = testDocument.getText();

        assert.ok(
            updatedContent.includes("function MyComponent({ name, age, email }: Props) {"),
            "Should include optional properties in destructuring"
        );
    });

    test("should update arrow function component destructuring", async () => {
        const codeWithArrowFunction = `interface Props {
    title: string;
    onClick: () => void;
}

const MyComponent = ({ title }: Props) => {
    return <button>{title}</button>;
};`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), codeWithArrowFunction);
        });

        await updatePropsDestructuring(testDocument);
        const updatedContent = testDocument.getText();

        assert.ok(
            updatedContent.includes("({ title, onClick }: Props)"),
            "Should update arrow function destructuring"
        );
    });

    test("should not modify rest spread destructuring", async () => {
        const codeWithRestSpread = `interface Props {
    name: string;
    age: number;
    extra: boolean;
}

function MyComponent({ name, ...rest }: Props) {
    return <div {...rest}>{name}</div>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), codeWithRestSpread);
        });

        const originalContent = testDocument.getText();
        await updatePropsDestructuring(testDocument);
        const updatedContent = testDocument.getText();

        assert.strictEqual(originalContent, updatedContent, "Should not modify rest spread destructuring");
    });

    test("should handle interface with custom Props suffix name", async () => {
        const codeWithCustomPropsName = `interface ButtonProps {
    label: string;
    disabled: boolean;
}

function Button({ label }: ButtonProps) {
    return <button>{label}</button>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), codeWithCustomPropsName);
        });

        await updatePropsDestructuring(testDocument);
        const updatedContent = testDocument.getText();

        assert.ok(
            updatedContent.includes("function Button({ label, disabled }: ButtonProps) {"),
            "Should update destructuring for custom Props interface name"
        );
    });

    test("should handle multiple interfaces in same file only updating Props ones", async () => {
        const codeWithMultipleInterfaces = `interface User {
    id: string;
    name: string;
}

interface CardProps {
    title: string;
    content: string;
}

function Card({ title }: CardProps) {
    return <div>{title}</div>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), codeWithMultipleInterfaces);
        });

        await updatePropsDestructuring(testDocument);
        const updatedContent = testDocument.getText();

        assert.ok(
            updatedContent.includes("function Card({ title, content }: CardProps)"),
            "Should update CardProps destructuring"
        );
        // User interface should still exist with its properties
        assert.ok(
            updatedContent.includes("interface User") && updatedContent.includes("id: string") && updatedContent.includes("name: string"),
            "Should not modify non-Props interfaces"
        );
    });

    test("should handle already correct destructuring", async () => {
        const correctCode = `interface Props {
    a: string;
    b: number;
}

function MyComponent({ a, b }: Props) {
    return <div>{a}{b}</div>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), correctCode);
        });

        const originalContent = testDocument.getText();
        await updatePropsDestructuring(testDocument);
        const updatedContent = testDocument.getText();

        assert.strictEqual(originalContent, updatedContent, "Should not modify already correct destructuring");
    });
});

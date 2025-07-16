import * as assert from "assert";
import * as vscode from "vscode";
import { updatePropsDestructuring } from "../../features/react/updatePropsDestructuring";

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
});

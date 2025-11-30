import * as assert from "assert";
import * as vscode from "vscode";
import { addClassNameToProps } from "../../../features/react/addClassNameToProps";

suite("AddClassNameToProps Tests", () => {
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

    test("should add className to existing Props interface", async () => {
        const initialCode = `interface Props {
    name: string;
}

function MyComponent({ name }: Props) {
    return <div>{name}</div>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), initialCode);
        });

        await addClassNameToProps();
        const updatedContent = testDocument.getText();

        assert.ok(updatedContent.includes("className?: string"), "Should add className property");
        assert.ok(updatedContent.includes("name: string"), "Should keep existing props");
    });

    test("should create Props interface and add className when no props exist", async () => {
        const initialCode = `function MyComponent() {
    return <div>Hello World</div>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), initialCode);
        });

        await addClassNameToProps();
        const updatedContent = testDocument.getText();

        assert.ok(updatedContent.includes("interface Props {"), "Should create Props interface");
        assert.ok(updatedContent.includes("className?: string"), "Should add className property");
        assert.ok(updatedContent.includes("function MyComponent({ className }: Props)"), "Should add destructured props parameter with className");
    });

    test("should not add className if it already exists", async () => {
        const codeWithClassName = `interface Props {
    className?: string;
}

function MyComponent({ className }: Props) {
    return <div className={className}>Hello World</div>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), codeWithClassName);
        });

        await addClassNameToProps();
        const updatedContent = testDocument.getText();

        // Count occurrences of className
        const classNameCount = (updatedContent.match(/className\?: string/g) || []).length;
        assert.strictEqual(classNameCount, 1, "Should not add duplicate className");
    });

    test("should update props destructuring after adding className", async () => {
        const initialCode = `interface Props {
    name: string;
}

function MyComponent({ name }: Props) {
    return <div>{name}</div>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), initialCode);
        });

        await addClassNameToProps();
        const updatedContent = testDocument.getText();

        assert.ok(updatedContent.includes("className?: string"), "Should add className property");
        assert.ok(
            updatedContent.includes("{ name, className }") || updatedContent.includes("{ className, name }"),
            "Should update destructuring to include className"
        );
    });

    test("should work with custom Props interface name", async () => {
        const initialCode = `interface MyComponentProps {
    title: string;
}

function MyComponent({ title }: MyComponentProps) {
    return <div>{title}</div>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), initialCode);
        });

        await addClassNameToProps();
        const updatedContent = testDocument.getText();

        assert.ok(updatedContent.includes("interface MyComponentProps {"), "Should keep custom interface name");
        assert.ok(updatedContent.includes("className?: string"), "Should add className property");
    });

    test("should work with arrow function components", async () => {
        const initialCode = `interface Props {
    value: number;
}

const MyComponent = ({ value }: Props) => {
    return <span>{value}</span>;
};`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), initialCode);
        });

        await addClassNameToProps();
        const updatedContent = testDocument.getText();

        assert.ok(updatedContent.includes("className?: string"), "Should add className property to arrow function component");
    });

    test("should not modify non-destructured props", async () => {
        const codeWithNonDestructuredProps = `interface Props {
    name: string;
}

function MyComponent(props: Props) {
    return <div>{props.name}</div>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), codeWithNonDestructuredProps);
        });

        await addClassNameToProps();
        const updatedContent = testDocument.getText();

        assert.ok(updatedContent.includes("className?: string"), "Should add className property");
        assert.ok(updatedContent.includes("(props: Props)"), "Should not modify non-destructured props parameter");
    });

    test("should work with empty destructuring pattern", async () => {
        const initialCode = `interface Props {
}

function MyComponent({ }: Props) {
    return <div>Empty</div>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), initialCode);
        });

        await addClassNameToProps();
        const updatedContent = testDocument.getText();

        assert.ok(updatedContent.includes("className?: string"), "Should add className property");
        assert.ok(updatedContent.includes("{ className }"), "Should update empty destructuring to include className");
    });

    test("should handle component with multiple interfaces", async () => {
        const initialCode = `interface OtherInterface {
    id: string;
}

interface Props {
    name: string;
}

function MyComponent({ name }: Props) {
    return <div>{name}</div>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), initialCode);
        });

        await addClassNameToProps();
        const updatedContent = testDocument.getText();

        // Should only add className to Props, not OtherInterface
        assert.ok(updatedContent.includes("className?: string"), "Should add className to Props interface");
        // OtherInterface should not have className
        const otherInterfaceMatch = updatedContent.match(/interface OtherInterface \{[^}]*\}/s);
        assert.ok(otherInterfaceMatch && !otherInterfaceMatch[0].includes("className"), "Should not modify OtherInterface");
    });

    test("should work with arrow function returning JSX fragment", async () => {
        const initialCode = `interface Props {
    items: string[];
}

const MyComponent = ({ items }: Props) => {
    return <>{items.map(i => <span key={i}>{i}</span>)}</>;
};`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), initialCode);
        });

        await addClassNameToProps();
        const updatedContent = testDocument.getText();

        assert.ok(updatedContent.includes("className?: string"), "Should add className property to fragment component");
    });
});

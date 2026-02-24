import * as assert from "assert";
import * as vscode from "vscode";
import { addPropsToComponent } from "../../../features/react/addPropsToComponent";

suite("AddPropsToComponent Tests", () => {
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

    test("should add empty Props interface to component without props", async () => {
        const initialCode = `function MyComponent() {
    return <div>Hello World</div>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), initialCode);
        });

        await addPropsToComponent();
        const updatedContent = testDocument.getText();

        assert.ok(updatedContent.includes("interface Props {"), "Should add Props interface");
        assert.ok(updatedContent.includes("function MyComponent({ }: Props) {"), "Should add empty destructured props parameter");
    });

    test("should not modify component that already has props", async () => {
        const codeWithExistingProps = `interface Props {
    name: string;
}

function MyComponent({ name }: Props) {
    return <div>{name}</div>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), codeWithExistingProps);
        });

        const originalContent = testDocument.getText();
        await addPropsToComponent();
        const updatedContent = testDocument.getText();

        assert.strictEqual(originalContent, updatedContent, "Should not modify component with existing props");
    });

    test("should not modify component with non-destructured props", async () => {
        const codeWithNonDestructuredProps = `interface Props {
    name: string;
}

function MyComponent(props: Props) {
    return <div>{props.name}</div>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), codeWithNonDestructuredProps);
        });

        const originalContent = testDocument.getText();
        await addPropsToComponent();
        const updatedContent = testDocument.getText();

        assert.strictEqual(originalContent, updatedContent, "Should not modify component with non-destructured props");
    });

    test("should place Props interface before component function", async () => {
        const initialCode = `// Component comment
function MyComponent() {
    return <div>Hello World</div>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), initialCode);
        });

        await addPropsToComponent();
        const updatedContent = testDocument.getText();

        const propsInterfaceIndex = updatedContent.indexOf("interface Props {");
        const componentFunctionIndex = updatedContent.indexOf("function MyComponent");

        assert.ok(propsInterfaceIndex < componentFunctionIndex, "Props interface should be placed before component function");
    });

    test("should create non-exported Props interface", async () => {
        const initialCode = `function MyComponent() {
    return <div>Hello World</div>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), initialCode);
        });

        await addPropsToComponent();
        const updatedContent = testDocument.getText();

        assert.ok(
            updatedContent.includes("interface Props {") && !updatedContent.includes("export interface Props {"),
            "Props interface should not be exported"
        );
    });

    test("should place cursor inside empty Props interface", async () => {
        const initialCode = `function MyComponent() {
    return <div>Hello World</div>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), initialCode);
        });

        await addPropsToComponent();

        const editor = vscode.window.activeTextEditor;
        assert.ok(editor, "Should have an active editor");

        const updatedContent = testDocument.getText();
        const interfaceStart = updatedContent.indexOf("interface Props");
        const openBrace = updatedContent.indexOf("{", interfaceStart);
        const closeBrace = updatedContent.indexOf("}", openBrace);
        const cursorOffset = testDocument.offsetAt(editor!.selection.active);
        const cursorPosition = editor!.selection.active;
        const interfaceLine = testDocument.positionAt(interfaceStart).line;

        assert.ok(interfaceStart >= 0, "Should contain Props interface");
        assert.ok(openBrace >= 0 && closeBrace >= 0, "Should contain interface braces");
        assert.ok(/interface Props \{\r?\n\s{4}\r?\n\}/.test(updatedContent), "Should format empty Props interface as multiline with indentation");
        assert.ok(cursorOffset > openBrace, "Cursor should be after opening brace");
        assert.ok(cursorOffset <= closeBrace, "Cursor should be inside interface body");
        assert.strictEqual(cursorPosition.line, interfaceLine + 1, "Cursor should be on line inside interface body");
        assert.strictEqual(cursorPosition.character, 4, "Cursor should be at body indentation level");
    });

    test("should work with function declaration style components", async () => {
        const initialCode = `export function MyComponent() {
    return <div>Hello World</div>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), initialCode);
        });

        await addPropsToComponent();
        const updatedContent = testDocument.getText();

        assert.ok(updatedContent.includes("interface Props {"), "Should add Props interface for exported function");
        assert.ok(updatedContent.includes("function MyComponent({ }: Props)"), "Should add empty destructured props");
    });

    test("should not modify arrow function that already has props", async () => {
        const codeWithExistingProps = `interface Props {
    value: number;
}

const MyComponent = ({ value }: Props) => {
    return <span>{value}</span>;
};`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), codeWithExistingProps);
        });

        const originalContent = testDocument.getText();
        await addPropsToComponent();
        const updatedContent = testDocument.getText();

        assert.strictEqual(originalContent, updatedContent, "Should not modify arrow function with existing props");
    });

    test("should handle component with JSX fragment", async () => {
        const initialCode = `function MyComponent() {
    return <>
        <div>First</div>
        <div>Second</div>
    </>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), initialCode);
        });

        await addPropsToComponent();
        const updatedContent = testDocument.getText();

        assert.ok(updatedContent.includes("interface Props {"), "Should add Props interface for fragment component");
    });
});

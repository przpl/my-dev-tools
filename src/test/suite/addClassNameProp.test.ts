import * as assert from "assert";
import * as vscode from "vscode";
import { addClassNameProp } from "../../features/react/addClassNameProp";

suite("AddClassNameProp Tests", () => {
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

    test("should add className prop to component without existing props", async () => {
        const initialCode = `function MyComponent() {
    return <div>Hello World</div>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), initialCode);
        });

        await addClassNameProp();
        const updatedContent = testDocument.getText();

        assert.ok(updatedContent.includes("interface Props {"), "Should create Props interface");
        assert.ok(updatedContent.includes("className?: string;"), "Should add optional className property to Props");
        assert.ok(updatedContent.includes("function MyComponent({ className }: Props) {"), "Should add className to destructured props");
        assert.ok(updatedContent.includes("className={className}"), "Should add className attribute to JSX element");
    });

    test("should add className prop to existing Props interface", async () => {
        const initialCode = `interface Props {
    title: string;
}

function MyComponent({ title }: Props) {
    return <div>{title}</div>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), initialCode);
        });

        await addClassNameProp();
        const updatedContent = testDocument.getText();

        assert.ok(updatedContent.includes("className?: string;"), "Should add className property to existing Props interface");
        assert.ok(
            updatedContent.includes("function MyComponent({ className, title }: Props) {"),
            "Should add className to existing destructured props"
        );
        assert.ok(updatedContent.includes("className={className}"), "Should add className attribute to JSX element");
    });

    test("should not add className if it already exists in Props interface", async () => {
        const initialCode = `interface Props {
    className?: string;
    title: string;
}

function MyComponent({ className, title }: Props) {
    return <div className={className}>{title}</div>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), initialCode);
        });

        const originalContent = testDocument.getText();
        await addClassNameProp();
        const updatedContent = testDocument.getText();

        // Should not duplicate className in interface or destructuring
        const classNameMatches = (updatedContent.match(/className/g) || []).length;
        const originalClassNameMatches = (originalContent.match(/className/g) || []).length;

        assert.strictEqual(classNameMatches, originalClassNameMatches, "Should not add duplicate className properties");
    });

    test("should handle non-destructured props parameter", async () => {
        const initialCode = `interface Props {
    title: string;
}

function MyComponent(props: Props) {
    return <div>{props.title}</div>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), initialCode);
        });

        await addClassNameProp();
        const updatedContent = testDocument.getText();

        assert.ok(updatedContent.includes("className?: string;"), "Should add className property to Props interface");
        assert.ok(updatedContent.includes("className={props.className}"), "Should use props.className in JSX attribute");
    });

    test("should work with arrow function components", async () => {
        const initialCode = `interface Props {
    title: string;
}

const MyComponent = ({ title }: Props) => {
    return <div>{title}</div>;
};`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), initialCode);
        });

        await addClassNameProp();
        const updatedContent = testDocument.getText();

        assert.ok(updatedContent.includes("className?: string;"), "Should add className property to Props interface");
        assert.ok(
            updatedContent.includes("const MyComponent = ({ className, title }: Props) => {"),
            "Should add className to arrow function destructured props"
        );
    });

    test("should handle JSX self-closing elements", async () => {
        const initialCode = `function MyComponent() {
    return <input type="text" />;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), initialCode);
        });

        await addClassNameProp();
        const updatedContent = testDocument.getText();

        assert.ok(updatedContent.includes("className={className}"), "Should add className attribute to self-closing JSX element");
    });

    test("should not add className attribute if it already exists", async () => {
        const initialCode = `interface Props {
    customClass: string;
}

function MyComponent({ customClass }: Props) {
    return <div className="existing-class">{customClass}</div>;
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), initialCode);
        });

        await addClassNameProp();
        const updatedContent = testDocument.getText();

        assert.ok(updatedContent.includes("className?: string;"), "Should add className property to Props interface");
        assert.ok(updatedContent.includes('className="existing-class"'), "Should preserve existing className attribute");

        // Should not add duplicate className attribute
        const classNameAttributeMatches = (updatedContent.match(/className=/g) || []).length;
        assert.strictEqual(classNameAttributeMatches, 1, "Should not duplicate className attribute");
    });

    test("should handle components with multiple JSX elements", async () => {
        const initialCode = `function MyComponent() {
    return (
        <div>
            <span>First element</span>
            <button>Second element</button>
        </div>
    );
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), initialCode);
        });

        await addClassNameProp();
        const updatedContent = testDocument.getText();

        assert.ok(updatedContent.includes("className={className}"), "Should add className attribute to root JSX element");

        // Should only add className to the first/root element
        const classNameAttributeMatches = (updatedContent.match(/className=/g) || []).length;
        assert.strictEqual(classNameAttributeMatches, 1, "Should only add className to root element");
    });

    test("should handle component without return statement gracefully", async () => {
        const initialCode = `function MyComponent() {
    console.log("No return");
}`;

        await testEditor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), initialCode);
        });

        await addClassNameProp();
        const updatedContent = testDocument.getText();

        // Should still add Props interface and parameter
        assert.ok(updatedContent.includes("interface Props {"), "Should create Props interface even without return statement");
        assert.ok(updatedContent.includes("className?: string;"), "Should add className property to Props interface");
        assert.ok(updatedContent.includes("function MyComponent({ className }: Props) {"), "Should add className to destructured props");
    });
});

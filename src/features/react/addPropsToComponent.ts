import { FunctionDeclaration, Node, Project } from "ts-morph";
import * as vscode from "vscode";

export async function addPropsToComponent() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage("No active editor");
        return;
    }

    const document = editor.document;
    const text = document.getText();

    const project = new Project();
    const sourceFile = project.createSourceFile("temp.tsx", text, { overwrite: true });

    const componentFunction = sourceFile.getFirstDescendant(
        (node): node is FunctionDeclaration => Node.isFunctionDeclaration(node) || Node.isArrowFunction(node)
    );

    if (!componentFunction) {
        vscode.window.showErrorMessage("No React component found");
        return;
    }

    const parameterList = componentFunction.getParameters();
    if (parameterList.length > 0) {
        vscode.window.showErrorMessage("Component already has props");
        return;
    }

    // Add empty Props interface
    const propsInterface = sourceFile.insertInterface(componentFunction.getChildIndex(), {
        name: "Props",
        isExported: false,
    });

    // Update component function
    componentFunction.addParameter({
        name: "{ }",
        type: "Props",
    });

    const updatedText = sourceFile.getFullText();
    const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(text.length));

    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, fullRange, updatedText);

    await vscode.workspace.applyEdit(edit);

    // Place cursor inside Props interface
    const propsInterfacePos = propsInterface.getPos() + "interface Props {".length;
    const cursorPosition = document.positionAt(propsInterfacePos);
    editor.selection = new vscode.Selection(cursorPosition, cursorPosition);
    editor.revealRange(new vscode.Range(cursorPosition, cursorPosition));

    vscode.window.showInformationMessage("Empty Props interface added successfully");
}

import { Project, SyntaxKind } from "ts-morph";
import * as vscode from "vscode";

export async function addPropsToComponent(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document.fileName.endsWith(".tsx")) {
        vscode.window.showErrorMessage("Please open a .tsx file to add Props to the component.");
        return;
    }

    const tsxFilePath = editor.document.fileName;

    const project = new Project();
    const sourceFile = project.addSourceFileAtPath(tsxFilePath);

    const component = sourceFile.getClasses()[0];
    if (!component) {
        vscode.window.showErrorMessage("No React component found in the file.");
        return;
    }

    component.insertInterface(0, {
        name: "Props",
        isExported: true,
        properties: [],
    });

    component.getConstructors()[0].addParameter({
        name: "props",
        type: "Props",
    });

    await sourceFile.save();
}


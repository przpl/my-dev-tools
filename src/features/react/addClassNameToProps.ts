import { SyntaxKind } from "ts-morph";
import * as vscode from "vscode";
import { ReactUtils } from "../../utils/reactUtils";
import { VsCodeUtils } from "../../utils/vsCodeUtils";
import { updatePropsDestructuring } from "./updatePropsDestructuring";

export async function addClassNameToProps() {
    const context = ReactUtils.setupWorkspaceContext();
    if (!context) {
        return;
    }

    // Find React component function
    const componentFunction = ReactUtils.findReactComponent(context.sourceFile);
    if (!componentFunction) {
        vscode.window.showErrorMessage(ReactUtils.ErrorMessages.NO_REACT_COMPONENT);
        return;
    }

    // Find or create Props interface
    let propsInterface = ReactUtils.findPropsInterface(context.sourceFile, componentFunction);
    let propsInterfaceName = "Props";

    if (!propsInterface) {
        // If no Props interface exists, determine the name and create it
        const existingParameter = componentFunction.getParameters()[0];
        if (existingParameter) {
            const typeNode = existingParameter.getTypeNode();
            if (typeNode && typeNode.getKind() === SyntaxKind.TypeReference) {
                propsInterfaceName = typeNode.getText();
            }
        }

        propsInterface = ReactUtils.findOrCreatePropsInterface(context.sourceFile, componentFunction, propsInterfaceName);

        // Update component function parameter if it doesn't exist
        if (!ReactUtils.componentHasProps(componentFunction)) {
            componentFunction.addParameter({
                name: "{ }",
                type: propsInterfaceName,
            });
        }
    } else {
        propsInterfaceName = propsInterface.getName() || "Props";
    }

    // Check if className already exists
    const existingProps = propsInterface.getProperties().map((p) => p.getName());
    if (existingProps.includes("className")) {
        vscode.window.showInformationMessage("className already exists in Props");
        return;
    }

    // Add className property to the interface
    propsInterface.addProperty({
        name: "className",
        type: "string",
        hasQuestionToken: true,
    });

    // Check if props are destructured
    const hasDestructuredProps =
        componentFunction.getParameters().length > 0 &&
        componentFunction.getParameters()[0].getFirstChildByKind(SyntaxKind.ObjectBindingPattern) !== undefined;

    // Apply changes
    const updatedText = context.sourceFile.getFullText();
    await VsCodeUtils.applyChangesToWorkspace(context, updatedText);

    // If props are destructured, run updatePropsDestructuring command
    if (hasDestructuredProps) {
        await updatePropsDestructuring(context.document);
    }

    // Move cursor to Props interface
    const propsStart = propsInterface.getStart();
    VsCodeUtils.moveCursorToPosition(context.editor, context.document, propsStart);

    vscode.window.showInformationMessage(`Added className to ${propsInterfaceName}`);
}

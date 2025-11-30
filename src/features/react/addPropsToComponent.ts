import * as vscode from "vscode";

import { ReactUtils } from "../../utils/reactUtils";
import { VsCodeUtils } from "../../utils/vsCodeUtils";

export async function addPropsToComponent() {
    const context = ReactUtils.setupWorkspaceContext();
    if (!context) {
        return;
    }

    const componentFunction = ReactUtils.findReactComponent(context.sourceFile);
    if (!componentFunction) {
        context.cleanup();
        vscode.window.showErrorMessage(ReactUtils.ErrorMessages.NO_REACT_COMPONENT);
        return;
    }

    if (ReactUtils.componentHasProps(componentFunction)) {
        context.cleanup();
        vscode.window.showErrorMessage("Component already has props");
        return;
    }

    try {
        // Add empty Props interface
        const propsInterface = ReactUtils.findOrCreatePropsInterface(context.sourceFile, componentFunction);

        // Add parameter to component function
        componentFunction.addParameter({
            name: "{ }",
            type: propsInterface.getName(),
        });

        // Get position before cleanup
        const propsInterfacePos = propsInterface.getPos() + "interface Props {".length;
        const updatedText = context.sourceFile.getFullText();

        await VsCodeUtils.applyChangesToWorkspace(context, updatedText);

        // Place cursor inside Props interface
        VsCodeUtils.moveCursorToPosition(context.editor, context.document, propsInterfacePos);

        vscode.window.showInformationMessage("Empty Props interface added successfully");
    } finally {
        context.cleanup();
    }
}

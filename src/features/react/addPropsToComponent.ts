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
        const hasEmptyPropsInterface = propsInterface.getMembers().length === 0;

        // Add parameter to component function
        componentFunction.addParameter({
            name: "{ }",
            type: propsInterface.getName(),
        });

        const interfaceStart = propsInterface.getStart();
        const interfaceEnd = propsInterface.getEnd();
        const eol = context.document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
        const interfaceHeader = `interface ${propsInterface.getName()} {`;

        let updatedText = context.sourceFile.getFullText();
        let propsInterfacePos = interfaceStart;

        const interfaceText = updatedText.slice(interfaceStart, interfaceEnd);
        const isSingleLineEmpty = /\{\s*\}/.test(interfaceText);

        if (hasEmptyPropsInterface && isSingleLineEmpty) {
            const multilineInterface = `${interfaceHeader}${eol}    ${eol}}`;
            updatedText = `${updatedText.slice(0, interfaceStart)}${multilineInterface}${updatedText.slice(interfaceEnd)}`;
            propsInterfacePos = interfaceStart + interfaceHeader.length + eol.length + 4;
        } else {
            const openBracePos = updatedText.indexOf("{", interfaceStart);
            propsInterfacePos = openBracePos >= 0 ? openBracePos + 1 : interfaceStart;
        }

        await VsCodeUtils.applyChangesToWorkspace(context, updatedText);

        // Place cursor inside Props interface
        VsCodeUtils.moveCursorToPosition(context.editor, context.document, propsInterfacePos);

        vscode.window.showInformationMessage("Empty Props interface added successfully");
    } finally {
        context.cleanup();
    }
}

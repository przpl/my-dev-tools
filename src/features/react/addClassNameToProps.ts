import * as vscode from "vscode";

import { ReactUtils } from "../../utils/reactUtils";

export async function addClassNameToProps() {
    await ReactUtils.withPropsInterface(async (ctx) => {
        const { propsInterface, propsInterfaceName } = ctx;

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

        // Apply changes and update destructuring
        await ReactUtils.applyPropsChanges(ctx);

        vscode.window.showInformationMessage(`Added className to ${propsInterfaceName}`);
    });
}

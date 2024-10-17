import { InterfaceDeclaration, Project, SyntaxKind } from "ts-morph";
import * as vscode from "vscode";

import { addToExportsInIndex } from "./features/addToExportsInIndex";
import { createNestJsController } from "./features/nestjs/createNestJsController";
import { openNearestFile } from "./features/openNearestFile";
import { addClassNameProp } from "./features/react/addClassNameProp";
import { addPropsToComponent } from "./features/react/addPropsToComponent";
import { createScssModule } from "./features/react/createScssModule";
import { updatePropsDestructuring } from "./features/react/updatePropsDestructuring";
import { renameToCamelCase, renameToKebabCase, renameToPascalCase, renameToSnakeCase } from "./features/renameFile";

export function activate(context: vscode.ExtensionContext) {
    // Generic
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.openNearestIndex", () => openNearestFile("index.ts")));
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.addToExportsInIndex", addToExportsInIndex));
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.renameToCamelCase", renameToCamelCase));
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.renameToPascalCase", renameToPascalCase));
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.renameToSnakeCase", renameToSnakeCase));
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.renameToKebabCase", renameToKebabCase));

    // React
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.createScssModule", createScssModule));
    activateUpdatePropsDestructuring(context);
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.addClassNameProp", addClassNameProp));
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.addPropsToComponent", addPropsToComponent));

    // NestJS
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.createNestJSController", createNestJsController));
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.openNearestNestJSModule", () => openNearestFile("*.module.ts")));
}

export function activateUpdatePropsDestructuring(context: vscode.ExtensionContext) {
    let timeout: NodeJS.Timeout | undefined;
    const project = new Project();

    const updatePropsHandler = (event: vscode.TextDocumentChangeEvent) => {
        const config = vscode.workspace.getConfiguration("myDevTools");
        const enableRealTimeUpdate = config.get<boolean>("enableRealTimePropsUpdate", false);
        const document = event.document;

        if (enableRealTimeUpdate && document.languageId === "typescriptreact") {
            const activeEditor = vscode.window.activeTextEditor;

            if (!activeEditor || activeEditor.document.uri.toString() !== document.uri.toString()) {
                return;
            }

            const cursorPosition = activeEditor.selection.active;
            const offset = document.offsetAt(cursorPosition);

            const sourceFile = project.createSourceFile(document.uri.fsPath, document.getText(), { overwrite: true });
            const nodeAtPosition = sourceFile.getDescendantAtPos(offset);

            let isInsidePropsInterface = false;
            let currentNode = nodeAtPosition;

            while (currentNode) {
                if (currentNode.getKind() === SyntaxKind.InterfaceDeclaration) {
                    const interfaceDeclaration = currentNode as InterfaceDeclaration;
                    if (interfaceDeclaration.getName() === "Props") {
                        isInsidePropsInterface = true;
                        break;
                    }
                }
                currentNode = currentNode.getParent();
            }

            if (isInsidePropsInterface) {
                if (timeout) {
                    clearTimeout(timeout);
                }
                timeout = setTimeout(async () => {
                    await updatePropsDestructuring(document);
                }, 350);
            }
        }
    };

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            updatePropsHandler(event);
        })
    );

    // Add a command to manually trigger the update
    context.subscriptions.push(
        vscode.commands.registerCommand("myDevTools.updatePropsDestructuring", async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === "typescriptreact") {
                await updatePropsDestructuring(editor.document);
            }
        })
    );

    // Add a command to toggle real-time updates
    context.subscriptions.push(
        vscode.commands.registerCommand("myDevTools.toggleRealTimePropsUpdate", () => {
            const config = vscode.workspace.getConfiguration("myDevTools");
            const currentValue = config.get<boolean>("enableRealTimePropsUpdate", true);
            config.update("enableRealTimePropsUpdate", !currentValue, true);
            vscode.window.showInformationMessage(`Real-time Props update is now ${!currentValue ? "enabled" : "disabled"}`);
        })
    );
}

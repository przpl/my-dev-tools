import { debounce } from "es-toolkit";
import { InterfaceDeclaration, SyntaxKind } from "ts-morph";
import * as vscode from "vscode";

import { addToExportsInIndex } from "./features/addToExportsInIndex";
import { openNearestFile } from "./features/openNearestFile";
import { updatePropsDestructuring } from "./features/react/updatePropsDestructuring";
import { Config } from "./utils/config";
import { ProjectManager } from "./utils/projectManager";
import { createNestJsController } from "./features/nestjs/createNestJsController";
import { addClassNameToProps } from "./features/react/addClassNameToProps";
import { addPropsToComponent } from "./features/react/addPropsToComponent";
import { addUndefinedPropsToInterface } from "./features/react/addUndefinedPropsToInterface";
import { renameToCamelCase, renameToPascalCase, renameToSnakeCase, renameToKebabCase, autoRename } from "./features/renameFile";
import { quickCommit } from "./features/git/quickCommit";

export function activate(context: vscode.ExtensionContext) {
    // Generic
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.openNearestIndex", () => openNearestFile("index.ts")));
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.addToExportsInIndex", addToExportsInIndex));
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.renameToCamelCase", renameToCamelCase));
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.renameToPascalCase", renameToPascalCase));
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.renameToSnakeCase", renameToSnakeCase));
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.renameToKebabCase", renameToKebabCase));
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.autoRename", autoRename));

    // React
    activateUpdatePropsDestructuring(context);
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.addPropsToComponent", addPropsToComponent));
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.addUndefinedPropsToInterface", addUndefinedPropsToInterface));
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.addClassNameToProps", addClassNameToProps));

    // NestJS
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.createNestJSController", createNestJsController));
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.openNearestNestJSModule", () => openNearestFile("*.module.ts")));

    // Git
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.quickCommit", quickCommit));
}

export function activateUpdatePropsDestructuring(context: vscode.ExtensionContext) {
    const debouncedUpdateProps = debounce(async (document: vscode.TextDocument) => {
        await updatePropsDestructuring(document);
    }, 350);

    const updatePropsHandler = (event: vscode.TextDocumentChangeEvent) => {
        const document = event.document;

        // Early exit if not a TSX file or real-time updates are disabled
        if (document.languageId !== "typescriptreact" || !Config.enableRealTimePropsUpdate) {
            return;
        }

        const activeEditor = vscode.window.activeTextEditor;

        if (!activeEditor || activeEditor.document.uri.toString() !== document.uri.toString()) {
            return;
        }

        const cursorPosition = activeEditor.selection.active;
        const offset = document.offsetAt(cursorPosition);

        const sourceFile = ProjectManager.createTempSourceFile(document.uri.fsPath, document.getText());
        const nodeAtPosition = sourceFile.getDescendantAtPos(offset);

        let isInsidePropsInterface = false;
        let currentNode = nodeAtPosition;

        while (currentNode) {
            if (currentNode.getKind() === SyntaxKind.InterfaceDeclaration) {
                const interfaceDeclaration = currentNode as InterfaceDeclaration;
                if (interfaceDeclaration.getName().endsWith("Props")) {
                    isInsidePropsInterface = true;
                    break;
                }
            }
            currentNode = currentNode.getParent();
        }

        ProjectManager.forgetSourceFile(sourceFile);

        if (isInsidePropsInterface) {
            debouncedUpdateProps(document);
        }
    };

    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(updatePropsHandler));

    // Cancel debounced calls on deactivation
    context.subscriptions.push({
        dispose: () => debouncedUpdateProps.cancel(),
    });

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
            const currentValue = Config.enableRealTimePropsUpdate;
            Config.enableRealTimePropsUpdate = !currentValue;
            vscode.window.showInformationMessage(`Real-time Props update is now ${!currentValue ? "enabled" : "disabled"}`);
        })
    );
}

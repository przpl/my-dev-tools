import * as vscode from "vscode";

import { addToExportsInIndex } from "./features/addToExportsInIndex";
import { createNestJsController } from "./features/nestjs/createNestJsController";
import { openNearestFile } from "./features/openNearestFile";
import { createScssModule } from "./features/react/createScssModule";

export function activate(context: vscode.ExtensionContext) {
    // Generic
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.openNearestIndex", () => openNearestFile("index.ts")));
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.addToExportsInIndex", addToExportsInIndex));

    // React
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.createScssModule", createScssModule));

    // NestJS
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.createNestJSController", createNestJsController));
    context.subscriptions.push(vscode.commands.registerCommand("myDevTools.openNearestNestJSModule", () => openNearestFile("*.module.ts")));
}

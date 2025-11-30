import { SyntaxKind, ts } from "ts-morph";
import * as vscode from "vscode";

import { FileUtils } from "../../utils/fileUtils";
import { ControllerName } from "../../utils/nestUtils";
import { ProjectManager } from "../../utils/projectManager";

async function fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

async function isDirectory(uri: vscode.Uri): Promise<boolean> {
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        return stat.type === vscode.FileType.Directory;
    } catch {
        return false;
    }
}

export async function createNestJsController(uri: vscode.Uri) {
    if (!uri || !(await isDirectory(uri))) {
        vscode.window.showErrorMessage("Please select a folder to create the NestJS controller.");
        return;
    }

    const userInput = await vscode.window.showInputBox({ prompt: "Enter the name of the controller (PascalCase preferred)" });

    if (!userInput) {
        vscode.window.showErrorMessage("Controller name cannot be empty.");
        return;
    }

    const controllerName = new ControllerName(userInput, uri.fsPath);
    const content = `import { Controller } from "@nestjs/common";

@Controller("${controllerName.slug}")
export class ${controllerName.className} {
    public constructor() {}
}`;

    try {
        const controllerUri = vscode.Uri.file(controllerName.filePath);

        if (await fileExists(controllerUri)) {
            vscode.window.showErrorMessage(`Controller file already exists: ${controllerName.fileName}`);
        } else {
            await vscode.workspace.fs.writeFile(controllerUri, Buffer.from(content));
            const controllerDocument = await vscode.workspace.openTextDocument(controllerUri);
            await vscode.window.showTextDocument(controllerDocument);
            await updateNestJSModuleFile(uri.fsPath, controllerName);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Error creating controller: ${error}`);
    }
}

async function updateNestJSModuleFile(folderPath: string, controllerName: ControllerName) {
    const moduleFiles = await FileUtils.findNearest(folderPath, "*.module.ts");

    if (moduleFiles.length === 0) {
        vscode.window.showErrorMessage("No NestJS module file (*.module.ts) found in the folder.");
        return;
    }

    if (moduleFiles.length > 1) {
        vscode.window.showErrorMessage(`More than one NestJS module file (*.module.ts) found in the folder.`);
        return;
    }

    updateModuleFileWithController(moduleFiles[0], controllerName);
}

async function updateModuleFileWithController(moduleFilePath: string, controllerName: ControllerName) {
    const project = ProjectManager.getFileSystemProject();
    const sourceFile = project.addSourceFileAtPath(moduleFilePath);

    try {
        sourceFile.addImportDeclaration({
            moduleSpecifier: FileUtils.getImportPath(moduleFilePath, controllerName.filePath),
            namedImports: [{ name: controllerName.className }],
        });

        const classes = sourceFile.getClasses();
        if (classes.length === 0) {
            vscode.window.showErrorMessage(`Module file does not have any class.`);
            return;
        }

        const moduleClass = classes.find((i) => i.getDecorator("Module"));
        if (!moduleClass) {
            vscode.window.showErrorMessage(`No class with @Module decorator found.`);
            return;
        }

        const moduleDecorator = moduleClass.getDecorator("Module")!; // we know that moduleClass has @Module decorator
        const decoratorArgs = moduleDecorator.getArguments();
        if (decoratorArgs.length === 0) {
            vscode.window.showErrorMessage(`Module decorator does not have any arguments.`);
            return;
        }
        const moduleDecoratorArgument = decoratorArgs[0];

        const controllersProp = moduleDecoratorArgument
            .getDescendants()
            .find(
                (d) =>
                    d.getKind() === SyntaxKind.PropertyAssignment && (d.compilerNode as ts.PropertyAssignment).name.getText() === "controllers"
            );
        if (controllersProp) {
            const controllers = controllersProp.getFirstChildByKindOrThrow(SyntaxKind.ArrayLiteralExpression);
            const controllerNames = controllers.getElements().map((i) => i.getText());
            const sortedIndex = controllerNames.findIndex((i) => i > controllerName.className);
            // If no element is greater (sortedIndex === -1), insert at the end
            const insertIndex = sortedIndex === -1 ? controllerNames.length : sortedIndex;
            controllers.insertElement(insertIndex, controllerName.className); // insert controller name in sorted order
        } else {
            // TODO implement, for now show message
            vscode.window.showInformationMessage("Module decorator config does not have controllers property.");
        }

        sourceFile.organizeImports();
        await sourceFile.save();
    } finally {
        // Clean up the source file from the shared project to prevent memory accumulation
        sourceFile.forget();
    }
}

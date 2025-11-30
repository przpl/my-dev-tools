import { ArrowFunction, FunctionDeclaration, InterfaceDeclaration, SyntaxKind } from "ts-morph";
import * as vscode from "vscode";

import { ProjectManager } from "../../utils/projectManager";

export async function updatePropsDestructuring(document: vscode.TextDocument) {
    const text = document.getText();
    const sourceFile = ProjectManager.createTempSourceFile("temp.tsx", text);

    try {
        const interfaces = sourceFile.getDescendantsOfKind(SyntaxKind.InterfaceDeclaration);
        if (interfaces.length === 0) {
            return;
        }

        const functions = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration);
        const arrowFunctions = sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction);
        const allFunctions = [...functions, ...arrowFunctions];
        
        if (allFunctions.length === 0) {
            return;
        }

        let hasChanges = false;
        interfaces.forEach((interfaceDeclaration) => {
            if (interfaceDeclaration.getName()?.endsWith("Props")) {
                const matchingFunction = findMatchingFunction(interfaceDeclaration, allFunctions);
                if (matchingFunction) {
                    hasChanges = updateFunctionParameter(interfaceDeclaration, matchingFunction) || hasChanges;
                }
            }
        });

        if (hasChanges) {
            const updatedText = sourceFile.getFullText();
            const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(text.length));

            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, fullRange, updatedText);

            return vscode.workspace.applyEdit(edit);
        }
    } finally {
        ProjectManager.forgetSourceFile(sourceFile);
    }
}

function findMatchingFunction(
    interfaceDeclaration: InterfaceDeclaration,
    functions: (FunctionDeclaration | ArrowFunction)[]
): FunctionDeclaration | ArrowFunction | undefined {
    const interfaceName = interfaceDeclaration.getName();
    return functions.find((func) => {
        const parameters = func.getParameters();
        return parameters.length === 1 && parameters[0].getType().getText() === interfaceName;
    });
}

function updateFunctionParameter(interfaceDeclaration: InterfaceDeclaration, functionDeclaration: FunctionDeclaration | ArrowFunction): boolean {
    const parameter = functionDeclaration.getParameters()[0];
    const object = parameter.getChildAtIndexIfKind(0, SyntaxKind.ObjectBindingPattern);
    if (!object) {
        // Skip parameters that are not object destructuring, for example: (props: Props)
        return false;
    }

    const actualProperties = object.getElements();
    if (actualProperties.length > 0 && actualProperties[actualProperties.length - 1].getDotDotDotToken()) {
        // Skip rest parameters, for example: ({ ...props }: Props)
        return false;
    }

    const expectedPropertiesName = getAllPropertiesIncludingExtended(interfaceDeclaration);

    if (actualProperties.length === expectedPropertiesName.length) {
        const actualPropertiesNames = actualProperties.map((i) => i.getName());
        if (actualPropertiesNames.every((prop) => expectedPropertiesName.includes(prop))) {
            return false;
        }
    }

    const newBindingPattern = `{ ${expectedPropertiesName.join(", ")} }`;
    object.replaceWithText(newBindingPattern);
    object.formatText();

    return true;
}

function getAllPropertiesIncludingExtended(interfaceDeclaration: InterfaceDeclaration): string[] {
    const properties = new Set<string>();
    const typesToProcess = [interfaceDeclaration.getType()];

    while (typesToProcess.length > 0) {
        const currentType = typesToProcess.pop()!;

        currentType.getProperties().forEach((prop) => {
            properties.add(prop.getName());
        });

        const baseTypes = currentType.getBaseTypes();
        typesToProcess.push(...baseTypes);
    }

    return Array.from(properties);
}

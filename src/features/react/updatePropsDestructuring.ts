import { FunctionDeclaration, InterfaceDeclaration, Project, SyntaxKind } from "ts-morph";
import * as vscode from "vscode";

let project: Project | null = null;

export async function updatePropsDestructuring(document: vscode.TextDocument) {
    const text = document.getText();

    if (!project) {
        project = new Project();
    }

    const sourceFile = project.createSourceFile("temp.ts", text, { overwrite: true });

    const interfaces = sourceFile.getDescendantsOfKind(SyntaxKind.InterfaceDeclaration);
    if (interfaces.length === 0) {
        return;
    }

    const functions = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration);

    let hasChanges = false;
    interfaces.forEach((interfaceDeclaration) => {
        if (interfaceDeclaration.getName()?.endsWith("Props")) {
            const matchingFunction = findMatchingFunction(interfaceDeclaration, functions);
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
}

function findMatchingFunction(
    interfaceDeclaration: InterfaceDeclaration,
    functions: FunctionDeclaration[]
): FunctionDeclaration | undefined {
    const interfaceName = interfaceDeclaration.getName();
    return functions.find((func) => {
        const parameters = func.getParameters();
        return parameters.length === 1 && parameters[0].getType().getText() === interfaceName;
    });
}

function updateFunctionParameter(interfaceDeclaration: InterfaceDeclaration, functionDeclaration: FunctionDeclaration): boolean {
    const parameter = functionDeclaration.getParameters()[0];
    const object = parameter.getChildAtIndexIfKind(0, SyntaxKind.ObjectBindingPattern);
    if (!object) {
        // Skip parameters that are not object destructuring, for example: (props: Props)
        return false;
    }

    const objectString = object.getText();
    if (objectString.includes("...")) {
        // Skip rest parameters, for example: ({ ...props }: Props)
        return false;
    }

    const actualProperties = object.getElements();
    const expectedPropertiesName = interfaceDeclaration.getProperties().map((prop) => prop.getName());

    let needsUpdate = false;
    if (actualProperties.length !== expectedPropertiesName.length) {
        needsUpdate = true;
    } else {
        const actualPropertiesNames = actualProperties.map((i) => i.getText());
        needsUpdate = !actualPropertiesNames.every((prop) => expectedPropertiesName.includes(prop));
    }

    if (needsUpdate) {
        let separator = " ";
        if (objectString.includes("\r\n")) {
            separator = "\r\n";
        } else if (objectString.includes("\n")) {
            separator = "\n";
        }

        const newBindingPattern = "{" + separator + `${expectedPropertiesName.join(`,${separator}`)}` + separator + "}";
        object.replaceWithText(newBindingPattern);
        object.formatText();
        return true;
    }

    return false;
}

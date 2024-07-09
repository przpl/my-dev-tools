import { FunctionDeclaration, InterfaceDeclaration, Node, Project, SyntaxKind } from "ts-morph";
import * as vscode from "vscode";

export async function addClassNameProp() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage("No active editor");
        return;
    }

    const document = editor.document;
    const text = document.getText();

    const project = new Project();
    const sourceFile = project.createSourceFile("temp.tsx", text, { overwrite: true });

    const componentFunction = sourceFile.getFirstDescendant(
        (node): node is FunctionDeclaration => Node.isFunctionDeclaration(node) || Node.isArrowFunction(node)
    );

    if (!componentFunction) {
        vscode.window.showErrorMessage("No React component found");
        return;
    }

    const propsType = componentFunction.getParameters()[0]?.getType();
    let propsInterface = propsType?.getSymbol()?.getDeclarations()[0] as InterfaceDeclaration | undefined;

    if (!propsInterface) {
        // If no Props interface exists, create it right before the component
        propsInterface = sourceFile.insertInterface(componentFunction.getChildIndex(), {
            name: "Props",
            isExported: false,
            properties: [{ name: "className", type: "string", hasQuestionToken: true }],
        });
    } else if (!propsInterface.getProperty("className")) {
        // If Props interface exists but doesn't have className, add it
        propsInterface.addProperty({
            name: "className",
            type: "string",
            hasQuestionToken: true,
        });
    }

    const propsInterfaceName = propsInterface.getName();

    const parameterList = componentFunction.getParameters();
    let classNameUsage = "className";

    if (parameterList.length === 0) {
        // No existing props, use destructuring
        componentFunction.addParameter({
            name: "{ className }",
            type: propsInterfaceName,
        });
    } else {
        const firstParam = parameterList[0];
        const nameNode = firstParam.getNameNode();

        if (Node.isObjectBindingPattern(nameNode)) {
            const text = nameNode.getText();
            if (!text.includes("className")) {
                const newText = text.replace("{", "{ className,");
                firstParam.replaceWithText(newText);
            }
        } else if (Node.isIdentifier(nameNode)) {
            classNameUsage = `${nameNode.getText()}.className`;
        }

        firstParam.setType(propsInterfaceName);
    }

    const returnStatement = componentFunction.getFirstDescendantByKind(SyntaxKind.ReturnStatement);
    if (returnStatement) {
        const jsxElement =
            returnStatement.getFirstDescendantByKind(SyntaxKind.JsxElement) ||
            returnStatement.getFirstDescendantByKind(SyntaxKind.JsxSelfClosingElement);
        if (jsxElement) {
            const openingElement = Node.isJsxElement(jsxElement) ? jsxElement.getOpeningElement() : jsxElement;
            if (!openingElement.getAttribute("className")) {
                openingElement.addAttribute({
                    name: "className",
                    initializer: `{${classNameUsage}}`,
                });
            }
        }
    }

    const updatedText = sourceFile.getFullText();
    const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(text.length));

    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, fullRange, updatedText);

    await vscode.workspace.applyEdit(edit);

    vscode.window.showInformationMessage("className prop added successfully");
}

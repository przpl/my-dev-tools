import { ArrowFunction, BindingElement, FunctionDeclaration, InterfaceDeclaration, Node, Project, SourceFile, SyntaxKind } from "ts-morph";
import * as vscode from "vscode";
import { updatePropsDestructuring } from "./updatePropsDestructuring";

interface UndefinedProp {
    name: string;
    type: string;
}

const typeGuesses = new Map<string, string>([
    ["className", "string"],
    ["title", "string"],
    ["name", "string"],
    ["label", "string"],
    ["placeholder", "string"],
    ["value", "string"],
    ["text", "string"],
    ["content", "string"],
    ["description", "string"],
    ["id", "string"],
    ["key", "string"],
    ["src", "string"],
    ["alt", "string"],
    ["href", "string"],
    ["type", "string"],
    ["role", "string"],
    ["count", "number"],
    ["length", "number"],
    ["width", "number"],
    ["height", "number"],
    ["size", "number"],
    ["index", "number"],
    ["max", "number"],
    ["min", "number"],
    ["step", "number"],
    ["tabIndex", "number"],
    ["isVisible", "boolean"],
    ["isOpen", "boolean"],
    ["isDisabled", "boolean"],
    ["isLoading", "boolean"],
    ["isActive", "boolean"],
    ["isSelected", "boolean"],
    ["disabled", "boolean"],
    ["checked", "boolean"],
    ["required", "boolean"],
    ["readonly", "boolean"],
    ["hidden", "boolean"],
    ["loading", "boolean"],
    ["visible", "boolean"],
    ["open", "boolean"],
    ["active", "boolean"],
    ["selected", "boolean"],
]);

export async function addUndefinedPropsToInterface() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage("No active editor");
        return;
    }

    const document = editor.document;
    const text = document.getText();

    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile("temp.tsx", text, { overwrite: true });

    // Find React component function
    const componentFunction = findReactComponent(sourceFile);
    if (!componentFunction) {
        vscode.window.showErrorMessage("No React component found");
        return;
    }

    // Find or create Props interface
    let propsInterface = findPropsInterface(sourceFile, componentFunction);
    let propsInterfaceName = "Props";

    if (!propsInterface) {
        // If no Props interface exists, determine the name and create it
        const existingParameter = componentFunction.getParameters()[0];
        if (existingParameter) {
            const typeNode = existingParameter.getTypeNode();
            if (typeNode && Node.isTypeReference(typeNode)) {
                propsInterfaceName = typeNode.getTypeName().getText();
            }
        }

        propsInterface = sourceFile.insertInterface(componentFunction.getChildIndex(), {
            name: propsInterfaceName,
            isExported: false,
        });

        // Update component function parameter if it doesn't exist
        if (componentFunction.getParameters().length === 0) {
            componentFunction.addParameter({
                name: "{ }",
                type: propsInterfaceName,
            });
        }
    } else {
        propsInterfaceName = propsInterface.getName() || "Props";
    }

    // Get existing props from the interface
    const existingProps = new Set(propsInterface.getProperties().map((p) => p.getName()));

    // Find undefined symbols used in the component
    const undefinedProps = findUndefinedPropsInComponent(componentFunction, existingProps);

    if (undefinedProps.length === 0) {
        vscode.window.showInformationMessage("No undefined props found in the component");
        return;
    }

    // Add undefined props to the interface
    undefinedProps.forEach((prop) => {
        propsInterface!.addProperty({
            name: prop.name,
            type: prop.type,
            hasQuestionToken: false, // Make props required (not optional)
        });
    });

    // Check if props are destructured
    const hasDestructuredProps =
        componentFunction.getParameters().length > 0 &&
        componentFunction.getParameters()[0].getFirstChildByKind(SyntaxKind.ObjectBindingPattern) !== undefined;

    // Apply changes
    const updatedText = sourceFile.getFullText();
    const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(text.length));

    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, fullRange, updatedText);

    await vscode.workspace.applyEdit(edit);

    // If props are destructured, run updatePropsDestructuring command
    if (hasDestructuredProps) {
        await updatePropsDestructuring(document);
    }

    // Move cursor to Props interface
    const propsStart = propsInterface.getStart();
    const propsPosition = document.positionAt(propsStart);
    editor.selection = new vscode.Selection(propsPosition, propsPosition);
    editor.revealRange(new vscode.Range(propsPosition, propsPosition));

    vscode.window.showInformationMessage(`Added ${undefinedProps.length} props to ${propsInterfaceName}`);
}

function findReactComponent(sourceFile: SourceFile): FunctionDeclaration | ArrowFunction | undefined {
    // Look for function declarations or arrow functions that return JSX
    const functions = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration);
    const arrowFunctions = sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction);

    const allFunctions = [...functions, ...arrowFunctions];

    for (const func of allFunctions) {
        if (hasJsxReturn(func)) {
            return func;
        }
    }

    return undefined;
}

function hasJsxReturn(func: any): boolean {
    // Check if function contains JSX elements
    const jsxElements = func.getDescendantsOfKind(SyntaxKind.JsxElement);
    const jsxSelfClosing = func.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement);
    const jsxFragments = func.getDescendantsOfKind(SyntaxKind.JsxFragment);

    return jsxElements.length > 0 || jsxSelfClosing.length > 0 || jsxFragments.length > 0;
}

function findPropsInterface(
    sourceFile: SourceFile,
    componentFunction: FunctionDeclaration | ArrowFunction
): InterfaceDeclaration | undefined {
    // First, check if component function has a typed parameter
    const parameters = componentFunction.getParameters();
    if (parameters.length > 0) {
        const typeNode = parameters[0].getTypeNode();
        if (typeNode && Node.isTypeReference(typeNode)) {
            const typeName = typeNode.getTypeName().getText();
            const interfaces = sourceFile.getDescendantsOfKind(SyntaxKind.InterfaceDeclaration);
            return interfaces.find((iface: InterfaceDeclaration) => iface.getName() === typeName);
        }
    }

    // If no typed parameter, look for interfaces ending with "Props"
    const interfaces = sourceFile.getDescendantsOfKind(SyntaxKind.InterfaceDeclaration);
    return interfaces.find((iface: InterfaceDeclaration) => iface.getName()?.endsWith("Props"));
}

function findUndefinedPropsInComponent(
    componentFunction: FunctionDeclaration | ArrowFunction,
    existingProps: Set<string>
): UndefinedProp[] {
    const undefinedProps: UndefinedProp[] = [];
    const usedIdentifiers = new Set<string>();

    // Get parameter names to exclude them
    const parameters = componentFunction.getParameters();
    const destructuredProps = new Set<string>();
    const parameterNames = new Set<string>();

    if (parameters.length > 0) {
        const param = parameters[0];

        // Get the parameter name (e.g., "props" in "props: Props")
        const paramName = param.getName();
        if (paramName) {
            parameterNames.add(paramName);
        }

        // Also get destructured parameter names
        const bindingPattern = param.getFirstChildByKind(SyntaxKind.ObjectBindingPattern);
        if (bindingPattern) {
            bindingPattern.getElements().forEach((element: BindingElement) => {
                const name = element.getName();
                if (name) {
                    destructuredProps.add(name);
                }
            });
        }
    }

    // Find all identifiers used in JSX attributes and expressions
    const jsxAttributes = componentFunction.getDescendantsOfKind(SyntaxKind.JsxAttribute);

    jsxAttributes.forEach((attr) => {
        const initializer = attr.getInitializer();
        if (initializer && Node.isJsxExpression(initializer)) {
            const expression = initializer.getExpression();
            if (expression) {
                collectIdentifiersFromExpression(expression, usedIdentifiers);
            }
        }
    });

    // Also check JSX expressions in element bodies
    const jsxExpressions = componentFunction.getDescendantsOfKind(SyntaxKind.JsxExpression);
    jsxExpressions.forEach((expr) => {
        const expression = expr.getExpression();
        if (expression) {
            collectIdentifiersFromExpression(expression, usedIdentifiers);
        }
    });

    // Filter out identifiers that are already defined as props or are built-in/imported
    usedIdentifiers.forEach((identifier) => {
        if (
            !existingProps.has(identifier) &&
            !destructuredProps.has(identifier) &&
            !parameterNames.has(identifier) &&
            !isBuiltInOrImported(identifier, componentFunction)
        ) {
            const type = guessType(identifier);
            undefinedProps.push({ name: identifier, type });
        }
    });

    return undefinedProps;
}

function collectIdentifiersFromExpression(expression: Node, identifiers: Set<string>) {
    if (Node.isIdentifier(expression)) {
        identifiers.add(expression.getText());
        return; // Don't process children for identifiers
    }

    // Handle property access (e.g., props.something -> "something")
    if (Node.isPropertyAccessExpression(expression)) {
        const left = expression.getExpression();
        if (Node.isIdentifier(left)) {
            // Only add the property name, not the object name
            identifiers.add(expression.getName());
            return; // Don't process children for property access expressions
        }
    }

    // Handle conditional expressions, binary expressions, etc.
    expression.getChildren().forEach((child) => {
        collectIdentifiersFromExpression(child, identifiers);
    });
}

function isBuiltInOrImported(identifier: string, componentFunction: FunctionDeclaration | ArrowFunction): boolean {
    const sourceFile = componentFunction.getSourceFile();

    // Check if it's an import
    const imports = sourceFile.getImportDeclarations();
    for (const importDecl of imports) {
        const namedImports = importDecl.getNamedImports();
        if (namedImports.some((imp) => imp.getName() === identifier)) {
            return true;
        }

        const defaultImport = importDecl.getDefaultImport();
        if (defaultImport && defaultImport.getText() === identifier) {
            return true;
        }
    }

    // Check if it's a variable declared in the same scope
    const functionScope = componentFunction.getParent();
    if (functionScope) {
        const variables = functionScope.getDescendantsOfKind(SyntaxKind.VariableDeclaration);
        if (variables.some((v) => v.getName() === identifier)) {
            return true;
        }
    }

    // Check if it's a built-in identifier (like console, window, document, etc.)
    const builtIns = [
        "console",
        "window",
        "document",
        "navigator",
        "location",
        "history",
        "localStorage",
        "sessionStorage",
        "undefined",
        "null",
        "true",
        "false",
    ];
    return builtIns.includes(identifier);
}

function guessType(propName: string): string {
    // Check for exact matches first
    if (typeGuesses.has(propName)) {
        return typeGuesses.get(propName)!;
    }

    // Check for common patterns
    if (propName.startsWith("is") || propName.startsWith("has") || propName.startsWith("can") || propName.startsWith("should")) {
        return "boolean";
    }

    if (propName.endsWith("Count") || propName.endsWith("Index") || propName.endsWith("Length") || propName.endsWith("Size")) {
        return "number";
    }

    if (propName.endsWith("Handler") || propName.startsWith("on")) {
        return "() => void";
    }

    if (propName.endsWith("Callback") || propName.endsWith("Function")) {
        return "() => void";
    }

    // Default to unknown
    return "unknown";
}

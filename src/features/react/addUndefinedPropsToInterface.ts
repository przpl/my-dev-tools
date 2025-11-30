import { ArrowFunction, BindingElement, FunctionDeclaration, Node, SyntaxKind } from "ts-morph";
import * as vscode from "vscode";

import { ReactUtils } from "../../utils/reactUtils";

interface UndefinedProp {
    name: string;
    type: string;
}

const typeGuesses = new Map<string, string>([
    // String types
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
    ["variant", "string"],
    ["color", "string"],
    ["testId", "string"],
    ["ariaLabel", "string"],

    // Number types
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

    // Boolean types
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

    // React-specific types
    ["children", "React.ReactNode"],
    ["style", "React.CSSProperties"],

    // Event handlers
    ["onClick", "() => void"],
]);

export async function addUndefinedPropsToInterface() {
    await ReactUtils.withPropsInterface(async (ctx) => {
        const { componentFunction, propsInterface, propsInterfaceName } = ctx;

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
            propsInterface.addProperty({
                name: prop.name,
                type: prop.type,
                hasQuestionToken: false, // Make props required (not optional)
            });
        });

        // Apply changes and update destructuring
        await ReactUtils.applyPropsChanges(ctx);

        vscode.window.showInformationMessage(`Added ${undefinedProps.length} props to ${propsInterfaceName}`);
    });
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
    let propsParamName: string | undefined;

    if (parameters.length > 0) {
        const param = parameters[0];

        // Get the parameter name (e.g., "props" in "props: Props")
        const paramName = param.getName();
        if (paramName) {
            parameterNames.add(paramName);
            propsParamName = paramName;
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
                collectIdentifiersFromExpression(expression, usedIdentifiers, propsParamName);
            }
        }
    });

    // Also check JSX expressions in element bodies
    const jsxExpressions = componentFunction.getDescendantsOfKind(SyntaxKind.JsxExpression);
    jsxExpressions.forEach((expr) => {
        const expression = expr.getExpression();
        if (expression) {
            collectIdentifiersFromExpression(expression, usedIdentifiers, propsParamName);
        }
    });

    // Pre-calculate known symbols to avoid repeated expensive checks
    // Start from parent to avoid adding the component's own parameters as known symbols
    const knownSymbols = getKnownSymbols(componentFunction.getParent(), componentFunction);

    // Filter out identifiers that are already defined as props or are built-in/imported
    usedIdentifiers.forEach((identifier) => {
        if (
            !existingProps.has(identifier) &&
            !destructuredProps.has(identifier) &&
            !parameterNames.has(identifier) &&
            !knownSymbols.has(identifier)
        ) {
            const type = guessType(identifier);
            undefinedProps.push({ name: identifier, type });
        }
    });

    return undefinedProps;
}

function collectIdentifiersFromExpression(expression: Node, identifiers: Set<string>, propsParamName?: string) {
    if (Node.isIdentifier(expression)) {
        identifiers.add(expression.getText());
        return; // Don't process children for identifiers
    }

    // Handle property access (e.g., props.something -> "something")
    if (Node.isPropertyAccessExpression(expression)) {
        const left = expression.getExpression();
        if (Node.isIdentifier(left) && propsParamName && left.getText() === propsParamName) {
            // Only add the property name if it's accessing the props object
            identifiers.add(expression.getName());
            return; 
        }
        
        // If it's not props.something, recurse on the left side (object)
        // e.g. user.name -> recurse on user. user is added. name is ignored.
        collectIdentifiersFromExpression(left, identifiers, propsParamName);
        return;
    }

    // Handle conditional expressions, binary expressions, etc.
    expression.getChildren().forEach((child) => {
        collectIdentifiersFromExpression(child, identifiers, propsParamName);
    });
}

function getKnownSymbols(
    startingScope: Node | undefined,
    componentFunction: FunctionDeclaration | ArrowFunction
): Set<string> {
    const symbols = new Set<string>();
    const sourceFile = componentFunction.getSourceFile();

    // 1. Imports
    const imports = sourceFile.getImportDeclarations();
    for (const importDecl of imports) {
        const namedImports = importDecl.getNamedImports();
        namedImports.forEach((imp) => symbols.add(imp.getName()));

        const defaultImport = importDecl.getDefaultImport();
        if (defaultImport) {
            symbols.add(defaultImport.getText());
        }
    }

    // 2. Variables in the component and parent scopes
    // Start from the provided scope (typically componentFunction.getParent()) to avoid
    // adding the component's own parameters as known symbols
    let currentScope: Node | undefined = startingScope;
    while (currentScope) {
        // Get variable declarations in this scope
        if (Node.isBlock(currentScope) || Node.isSourceFile(currentScope) || Node.isModuleBlock(currentScope)) {
             const varStatements = currentScope.getVariableStatements();
             for (const stmt of varStatements) {
                 const decls = stmt.getDeclarations();
                 for (const decl of decls) {
                     symbols.add(decl.getName());
                 }
             }
        } else if (Node.isFunctionDeclaration(currentScope) || Node.isArrowFunction(currentScope)) {
             // Function parameters (but not the component function's parameters)
             currentScope.getParameters().forEach(p => {
                 const name = p.getName();
                 if (name) symbols.add(name);
                 // Destructuring
                 const binding = p.getFirstChildByKind(SyntaxKind.ObjectBindingPattern);
                 if (binding) {
                     binding.getElements().forEach(e => {
                         const n = e.getName();
                         if (n) symbols.add(n);
                     });
                 }
             });
        }

        currentScope = currentScope.getParent();
    }

    // 3. Built-ins
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
        "Math", "JSON", "Object", "Array", "String", "Number", "Boolean", "Date", "RegExp", "Error", "Promise", "Map", "Set"
    ];
    builtIns.forEach(s => symbols.add(s));

    return symbols;
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

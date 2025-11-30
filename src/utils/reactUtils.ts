import { ArrowFunction, FunctionDeclaration, InterfaceDeclaration, Node, Project, SourceFile, SyntaxKind } from "ts-morph";
import * as vscode from "vscode";

import { ProjectManager } from "./projectManager";
import { VsCodeUtils } from "./vsCodeUtils";

export interface ReactWorkspaceContext {
    editor: vscode.TextEditor;
    document: vscode.TextDocument;
    text: string;
    project: Project;
    sourceFile: SourceFile;
    /** Clean up memory by forgetting the source file */
    cleanup: () => void;
}

export interface PropsOperationContext {
    context: ReactWorkspaceContext;
    componentFunction: FunctionDeclaration | ArrowFunction;
    propsInterface: InterfaceDeclaration;
    propsInterfaceName: string;
    hasDestructuredProps: boolean;
}

export namespace ReactUtils {
    export function setupWorkspaceContext(): ReactWorkspaceContext | null {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage("No active editor");
            return null;
        }

        const document = editor.document;
        const text = document.getText();

        const project = ProjectManager.getInMemoryProject();
        const sourceFile = project.createSourceFile("temp.tsx", text, { overwrite: true });

        return {
            editor,
            document,
            text,
            project,
            sourceFile,
            cleanup: () => ProjectManager.forgetSourceFile(sourceFile),
        };
    }

    /**
     * Higher-order utility for operations that work with React props interface.
     * Handles common setup, interface creation, and cleanup.
     */
    export async function withPropsInterface(operation: (ctx: PropsOperationContext) => Promise<void> | void): Promise<void> {
        const context = setupWorkspaceContext();
        if (!context) {
            return;
        }

        try {
            const componentFunction = findReactComponent(context.sourceFile);
            if (!componentFunction) {
                vscode.window.showErrorMessage(ErrorMessages.NO_REACT_COMPONENT);
                return;
            }

            let propsInterface = findPropsInterface(context.sourceFile, componentFunction);
            let propsInterfaceName = "Props";

            if (!propsInterface) {
                const existingParameter = componentFunction.getParameters()[0];
                if (existingParameter) {
                    const typeNode = existingParameter.getTypeNode();
                    if (typeNode && typeNode.getKind() === SyntaxKind.TypeReference) {
                        propsInterfaceName = typeNode.getText();
                    }
                }

                propsInterface = findOrCreatePropsInterface(context.sourceFile, componentFunction, propsInterfaceName);

                if (!componentHasProps(componentFunction)) {
                    componentFunction.addParameter({
                        name: "{ }",
                        type: propsInterfaceName,
                    });
                }
            } else {
                propsInterfaceName = propsInterface.getName() || "Props";
            }

            const hasDestructuredProps =
                componentFunction.getParameters().length > 0 &&
                componentFunction.getParameters()[0].getFirstChildByKind(SyntaxKind.ObjectBindingPattern) !== undefined;

            await operation({
                context,
                componentFunction,
                propsInterface,
                propsInterfaceName,
                hasDestructuredProps,
            });
        } finally {
            context.cleanup();
        }
    }

    /**
     * Apply changes to the workspace and optionally move cursor to props interface.
     * NOTE: Must be called BEFORE cleanup() as it accesses propsInterface.
     */
    export async function applyPropsChanges(
        ctx: PropsOperationContext,
        options: { moveCursorToProps?: boolean; updateDestructuring?: boolean } = {}
    ): Promise<void> {
        const { context, propsInterface, hasDestructuredProps } = ctx;
        const { moveCursorToProps = true, updateDestructuring = true } = options;

        // Get the start position BEFORE applying changes (node will still be valid)
        const propsStart = moveCursorToProps ? propsInterface.getStart() : 0;
        const updatedText = context.sourceFile.getFullText();
        
        await VsCodeUtils.applyChangesToWorkspace(context, updatedText);

        if (updateDestructuring && hasDestructuredProps) {
            // Dynamic import to avoid circular dependency
            const { updatePropsDestructuring } = await import("../features/react/updatePropsDestructuring");
            await updatePropsDestructuring(context.document);
        }

        if (moveCursorToProps) {
            VsCodeUtils.moveCursorToPosition(context.editor, context.document, propsStart);
        }
    }

    /**
     * Finds a React component (function or arrow function that returns JSX)
     */
    export function findReactComponent(sourceFile: SourceFile): FunctionDeclaration | ArrowFunction | undefined {
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

    /**
     * Checks if a function contains JSX elements in its return
     */
    export function hasJsxReturn(func: FunctionDeclaration | ArrowFunction): boolean {
        const jsxElements = func.getDescendantsOfKind(SyntaxKind.JsxElement);
        const jsxSelfClosing = func.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement);
        const jsxFragments = func.getDescendantsOfKind(SyntaxKind.JsxFragment);

        return jsxElements.length > 0 || jsxSelfClosing.length > 0 || jsxFragments.length > 0;
    }

    /**
     * Finds or creates a Props interface for a React component
     */
    export function findOrCreatePropsInterface(
        sourceFile: SourceFile,
        componentFunction: FunctionDeclaration | ArrowFunction,
        interfaceName: string = "Props"
    ): InterfaceDeclaration {
        let propsInterface = findPropsInterface(sourceFile, componentFunction);

        if (!propsInterface) {
            propsInterface = sourceFile.insertInterface(componentFunction.getChildIndex(), {
                name: interfaceName,
                isExported: false,
            });
        }

        return propsInterface;
    }

    /**
     * Finds an existing Props interface for a React component
     */
    export function findPropsInterface(
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

    /**
     * Checks if a component already has props parameters
     */
    export function componentHasProps(componentFunction: FunctionDeclaration | ArrowFunction): boolean {
        return componentFunction.getParameters().length > 0;
    }

    export const ErrorMessages = {
        NO_REACT_COMPONENT: "No React component found",
    } as const;
}

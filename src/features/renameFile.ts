import { camelCase, kebabCase, pascalCase, snakeCase } from "es-toolkit";
import * as path from "node:path";
import { ExportedDeclarations, SyntaxKind } from "ts-morph";
import * as vscode from "vscode";

import { Config } from "../utils/config";
import { ProjectManager } from "../utils/projectManager";

export function renameToCamelCase() {
    renameFile((str) => transformFileName(str, camelCase));
}

export function renameToPascalCase() {
    renameFile((str) => transformFileName(str, pascalCase));
}

export function renameToSnakeCase() {
    renameFile((str) => transformFileName(str, snakeCase));
}

export function renameToKebabCase() {
    renameFile((str) => transformFileName(str, kebabCase));
}

export async function autoRename() {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        vscode.window.showErrorMessage("No active file to rename.");
        return;
    }

    const document = activeEditor.document;
    const filePath = document.uri.fsPath;

    // Check if file is saved
    if (document.isDirty) {
        const saveResult = await vscode.window.showWarningMessage(
            "File must be saved before auto-renaming. Save now?",
            "Save and Continue",
            "Cancel"
        );

        if (saveResult !== "Save and Continue") {
            return;
        }

        await document.save();
    }

    try {
        const project = ProjectManager.getFileSystemProject();
        const sourceFile = project.addSourceFileAtPath(filePath);

        try {
            // Get all exported declarations
            const exportedDeclarations = sourceFile.getExportedDeclarations();
            const exportSymbols: Array<{ name: string; type: string; sortOrder: number }> = [];

            // Define type priorities for sorting
            const getTypeInfo = (declarations: ExportedDeclarations[]): { type: string; sortOrder: number } => {
                for (const declaration of declarations) {
                    if (declaration.getKind) {
                        const kind = declaration.getKind();
                        if (declaration.constructor.name.includes("ClassDeclaration") || kind === SyntaxKind.ClassDeclaration) {
                            return { type: "class", sortOrder: 1 };
                        }

                        if (declaration.constructor.name.includes("FunctionDeclaration") || kind === SyntaxKind.FunctionDeclaration) {
                            return { type: "function", sortOrder: 2 };
                        }

                        if (declaration.constructor.name.includes("InterfaceDeclaration") || kind === SyntaxKind.InterfaceDeclaration) {
                            return { type: "interface", sortOrder: 3 };
                        }

                        if (declaration.constructor.name.includes("TypeAliasDeclaration") || kind === SyntaxKind.TypeAliasDeclaration) {
                            return { type: "type", sortOrder: 3 };
                        }

                        if (declaration.constructor.name.includes("VariableDeclaration") || kind === SyntaxKind.VariableDeclaration) {
                            return { type: "variable", sortOrder: 4 };
                        }

                        if (declaration.constructor.name.includes("EnumDeclaration") || kind === SyntaxKind.EnumDeclaration) {
                            return { type: "enum", sortOrder: 4 };
                        }
                    }
                }
                return { type: "unknown", sortOrder: 5 };
            };

            // Collect all export names with their types
            for (const [name, declarations] of exportedDeclarations) {
                if (name !== "default") {
                    const typeInfo = getTypeInfo(declarations);
                    exportSymbols.push({ name, ...typeInfo });
                }
            }

            // Check for default export
            const defaultExportSymbol = sourceFile.getDefaultExportSymbol();
            if (defaultExportSymbol) {
                const defaultExportName = defaultExportSymbol.getName();
                if (defaultExportName && defaultExportName !== "default") {
                    // Try to get the default export declaration to determine its type
                    const defaultExportDeclarations = sourceFile.getExportedDeclarations().get("default") || [];
                    const typeInfo = getTypeInfo(defaultExportDeclarations);
                    exportSymbols.push({ name: defaultExportName, ...typeInfo });
                }
            }

            if (exportSymbols.length === 0) {
                vscode.window.showWarningMessage("No exported symbols found in the current file.");
                return;
            }

            let selectedSymbol: string;

            if (exportSymbols.length === 1) {
                selectedSymbol = exportSymbols[0].name;
            } else {
                // Sort symbols by type priority
                exportSymbols.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

                // Create quick pick items with symbol types
                const quickPickItems = exportSymbols.map((symbol) => ({
                    label: symbol.name,
                    description: symbol.type,
                }));

                // Show quick pick for multiple exports with first option pre-selected
                const selected = await vscode.window.showQuickPick(quickPickItems, {
                    placeHolder: "Select a symbol to use for auto-rename",
                    title: "Multiple exports found",
                });

                if (!selected) {
                    return; // User cancelled
                }

                selectedSymbol = selected.label;
            }

            // Get the configured naming strategy
            const strategy = Config.autoRenameStrategy;

            // Select the appropriate transformation function
            let transformFunc: (str: string) => string;
            switch (strategy) {
                case "camelCase":
                    transformFunc = camelCase;
                    break;
                case "PascalCase":
                    transformFunc = pascalCase;
                    break;
                case "snake_case":
                    transformFunc = snakeCase;
                    break;
                case "kebab-case":
                default:
                    transformFunc = kebabCase;
                    break;
            }

            // Check if file name already matches the selected symbol
            const currentName = path.basename(filePath);
            const extension = path.extname(currentName);
            const expectedFileName = `${transformFunc(selectedSymbol)}${extension}`;

            if (expectedFileName === currentName) {
                vscode.window.showInformationMessage("File name already matches the selected symbol.");
                return;
            }

            await renameFile((fileName) => {
                const ext = path.extname(fileName);
                return `${transformFunc(selectedSymbol)}${ext}`;
            });
        } finally {
            // Clean up the source file from the shared project to prevent memory accumulation
            sourceFile.forget();
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Error during auto-rename: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function transformFileName(str: string, transformFunc: (str: string) => string): string {
    const ext = path.extname(str);
    const baseName = path.basename(str, ext);
    return `${transformFunc(baseName)}${ext}`;
}

async function renameFile(transform: (str: string) => string) {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        vscode.window.showErrorMessage("No active file to rename.");
        return;
    }

    const oldUri = activeEditor.document.uri;
    const oldPath = oldUri.fsPath;
    const oldName = path.basename(oldPath);
    const newName = transform(oldName);
    const newPath = path.join(path.dirname(oldPath), newName);
    const newUri = vscode.Uri.file(newPath);

    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.renameFile(oldUri, newUri);

    const success = await vscode.workspace.applyEdit(workspaceEdit);
    if (!success) {
        vscode.window.showErrorMessage("Failed to rename file.");
    }
}

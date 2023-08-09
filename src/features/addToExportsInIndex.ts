import * as path from "node:path";
import { Project } from "ts-morph";
import * as vscode from "vscode";

import { FileUtils } from "../utils/fileUtils";

export async function addToExportsInIndex() {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        const exportedFilePath = activeEditor.document.uri.fsPath;
        const indexFiles = await FileUtils.findNearest(path.dirname(exportedFilePath), "index.ts"); // start searching from folder of exported file

        if (indexFiles.length > 0) {
            const indexFilePath = indexFiles[0];
            const importPath = FileUtils.getImportPath(indexFilePath, exportedFilePath);

            const project = new Project();
            const sourceFile = project.addSourceFileAtPath(indexFilePath);
            const selectedText = activeEditor.document.getText(activeEditor.selection);

            const exportDeclaration = sourceFile.getExportDeclaration((dep) => dep.getModuleSpecifierValue() === importPath);
            if (exportDeclaration) {
                if (exportDeclaration.getText().includes("export *")) {
                    vscode.window.showInformationMessage("All symbols are already exported.");
                    return;
                }

                if (selectedText) {
                    const namedExport = exportDeclaration.getNamedExports().find((namedExport) => namedExport.getText() === selectedText);
                    if (namedExport) {
                        vscode.window.showInformationMessage(`Symbol '${selectedText}' is already exported.`);
                        return;
                    } else {
                        exportDeclaration.addNamedExport(selectedText);
                    }
                } else {
                    // remove old export and replace it with export *
                    exportDeclaration.remove();
                    sourceFile.addExportDeclaration({ moduleSpecifier: importPath });
                }
            } else {
                if (selectedText) {
                    sourceFile.addExportDeclaration({ moduleSpecifier: importPath, namedExports: [{ name: selectedText }] });
                } else {
                    sourceFile.addExportDeclaration({ moduleSpecifier: importPath });
                }
            }

            sourceFile.organizeImports();
            await sourceFile.save();
        } else {
            vscode.window.showInformationMessage("No nearest index.ts file found.");
        }
    }
}

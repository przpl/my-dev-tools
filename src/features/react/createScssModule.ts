import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

export async function createScssModule() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document.fileName.endsWith(".tsx")) {
        vscode.window.showErrorMessage("Please open a .tsx file to create the SCSS module.");
        return;
    }

    const tsxFilePath = editor.document.fileName;
    const scssFileName = tsxFilePath.replace(".tsx", ".module.scss");

    try {
        if (fs.existsSync(scssFileName)) {
            vscode.window.showInformationMessage(`SCSS module already exists: ${scssFileName}`);
        } else {
            fs.writeFileSync(scssFileName, "");
            vscode.window.showInformationMessage(`Created SCSS module: ${scssFileName}`);
            // Update the .tsx file with the import statement
            updateTsxFileWithImport(tsxFilePath, path.basename(tsxFilePath, ".tsx"));

            // Open the .module.scss file in a new tab
            const scssDocument = await vscode.workspace.openTextDocument(scssFileName);
            vscode.window.showTextDocument(scssDocument);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Error creating SCSS module: ${error}`);
    }
}

function updateTsxFileWithImport(tsxFilePath: string, fileNameWithoutExtension: string) {
    const importStatement = `import styles from "./${fileNameWithoutExtension}.module.scss";\n`;

    try {
        const tsxContent = fs.readFileSync(tsxFilePath, "utf-8");
        if (!tsxContent.includes(importStatement)) {
            const updatedTsxContent = importStatement + tsxContent;
            fs.writeFileSync(tsxFilePath, updatedTsxContent, "utf-8");
        }
    } catch (error) {
        console.error("Error updating .tsx file:", error);
    }
}

import { readFile, writeFile } from "fs/promises";
import * as vscode from "vscode";

export async function convertEolToLf() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage("No workspace folder is open");
        return;
    }

    const globPattern = await vscode.window.showInputBox({
        prompt: "Enter glob pattern for files to convert",
        value: "**/*",
        placeHolder: "e.g., **/*.ts or src/**/*",
    });

    if (!globPattern) {
        return; // User cancelled
    }

    try {
        // Find all files matching the glob pattern
        const files = await vscode.workspace.findFiles(globPattern, "**/node_modules/**");

        if (files.length === 0) {
            vscode.window.showInformationMessage("No files found matching the glob pattern");
            return;
        }

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Converting EOL to LF",
                cancellable: true,
            },
            async (progress, token) => {
                let convertedCount = 0;
                let errorCount = 0;
                const errors: string[] = [];

                for (let i = 0; i < files.length; i++) {
                    if (token.isCancellationRequested) {
                        vscode.window.showWarningMessage("EOL conversion cancelled");
                        return;
                    }

                    const file = files[i];
                    progress.report({
                        message: `${i + 1}/${files.length} - ${file.fsPath}`,
                        increment: 100 / files.length,
                    });

                    try {
                        const content = await readFile(file.fsPath, "utf-8");

                        if (content.includes("\r")) {
                            const converted = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
                            await writeFile(file.fsPath, converted, "utf-8");
                            convertedCount++;
                        }
                    } catch (err) {
                        // Skip binary files or files with read errors
                        errorCount++;
                        if (errors.length < 10) {
                            errors.push(`${file.fsPath}: ${err instanceof Error ? err.message : String(err)}`);
                        }
                    }
                }

                // Show results
                const message = `EOL conversion complete: ${convertedCount} file(s) converted, ${files.length - convertedCount - errorCount} file(s) unchanged`;
                if (errorCount > 0) {
                    const errorMessage = `${message}, ${errorCount} error(s)`;
                    if (errors.length > 0) {
                        const showDetails = await vscode.window.showWarningMessage(
                            errorMessage,
                            "Show Errors"
                        );
                        if (showDetails) {
                            const outputChannel = vscode.window.createOutputChannel("EOL Conversion Errors");
                            outputChannel.appendLine("Failed to convert the following files:");
                            errors.forEach(err => outputChannel.appendLine(err));
                            if (errorCount > errors.length) {
                                outputChannel.appendLine(`...and ${errorCount - errors.length} more`);
                            }
                            outputChannel.show();
                        }
                    } else {
                        vscode.window.showWarningMessage(errorMessage);
                    }
                } else {
                    vscode.window.showInformationMessage(message);
                }
            }
        );
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to convert EOL: ${error instanceof Error ? error.message : String(error)}`);
    }
}

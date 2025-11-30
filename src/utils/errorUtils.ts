import * as vscode from "vscode";

/**
 * Handle and display an error to the user.
 */
export function handleError(error: unknown, context: string): void {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`${context}: ${message}`);
    console.error(`[MyDevTools] ${context}:`, error);
}

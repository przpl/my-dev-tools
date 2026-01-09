import * as vscode from "vscode";
import { FileExclusionManager } from "./fileExclusionManager";

let exclusionManager: FileExclusionManager | undefined;

/**
 * Registers commands for hiding/showing files in Explorer.
 *
 * IMPORTANT: VS Code does not provide an API to hide files in Explorer without modifying settings.
 * These commands modify the workspace "files.exclude" setting in .vscode/settings.json as a workaround.
 *
 * How it works:
 * 1. User configures patterns in workspace "files.exclude" (e.g., "node_modules": false)
 * 2. Hide command: Sets all values to true (hides files in Explorer)
 * 3. Show command: Sets all values to false (shows files in Explorer)
 * 4. Eye icon changes dynamically based on current state (eye-closed when hidden, eye when visible)
 */
export function registerExplorerFileVisibility(context: vscode.ExtensionContext): vscode.Disposable[] {
    exclusionManager = new FileExclusionManager(context);

    // Initialize context variable for dynamic icon
    exclusionManager.initialize();

    const hideCommand = vscode.commands.registerCommand("myDevTools.hideExplorerFiles", async () => {
        try {
            const patternCount = exclusionManager!.getPatternCount();

            if (patternCount === 0) {
                vscode.window.showWarningMessage(
                    'No patterns in files.exclude. Add patterns to Settings > Files: Exclude'
                );
                return;
            }

            await exclusionManager!.hideFiles();
            vscode.window.showInformationMessage(`Hiding ${patternCount} pattern(s) in Explorer`);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to hide files: ${errorMsg}`);
        }
    });

    const showCommand = vscode.commands.registerCommand("myDevTools.showExplorerFiles", async () => {
        try {
            const patternCount = exclusionManager!.getPatternCount();

            await exclusionManager!.showFiles();
            vscode.window.showInformationMessage(`Showing ${patternCount} pattern(s) in Explorer`);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to show files: ${errorMsg}`);
        }
    });

    return [hideCommand, showCommand];
}

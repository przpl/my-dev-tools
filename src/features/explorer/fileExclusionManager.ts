import * as vscode from "vscode";

/**
 * Manages the files.exclude workspace configuration to toggle file visibility in Explorer.
 *
 * NOTE: VS Code does not provide an API to hide files in Explorer without modifying the
 * "files.exclude" setting. This class modifies the workspace settings.json file as a workaround.
 *
 * Behavior:
 * - Toggle to HIDE: Sets all files.exclude values to true
 * - Toggle to SHOW: Sets all files.exclude values to false
 * - Detects state by checking if any pattern is true (hidden) or all are false (visible)
 */
export class FileExclusionManager {
    constructor(private context: vscode.ExtensionContext) {}

    /**
     * Get workspace-level files.exclude patterns only (not defaults).
     */
    private getWorkspaceExclusions(): Record<string, boolean> {
        const config = vscode.workspace.getConfiguration();
        const inspection = config.inspect<Record<string, boolean>>("files.exclude");

        // Return only workspace-level settings, or empty object if none exist
        return inspection?.workspaceValue || {};
    }

    /**
     * Check if files are currently hidden.
     * Returns true if at least one workspace pattern is set to true.
     */
    isHidden(): boolean {
        const exclusions = this.getWorkspaceExclusions();

        // If at least one pattern is true, files are hidden
        return Object.values(exclusions).some((value) => value === true);
    }

    /**
     * Hide files by setting all workspace files.exclude values to true.
     * ONLY modifies existing workspace patterns, does not add defaults.
     */
    async hideFiles(): Promise<void> {
        const config = vscode.workspace.getConfiguration();
        const workspaceExclusions = this.getWorkspaceExclusions();

        // Set all workspace patterns to true (don't add new ones)
        const hiddenExclusions: Record<string, boolean> = {};
        for (const pattern of Object.keys(workspaceExclusions)) {
            hiddenExclusions[pattern] = true;
        }

        // Update workspace configuration
        // This modifies .vscode/settings.json in the project
        await config.update("files.exclude", hiddenExclusions, vscode.ConfigurationTarget.Workspace);
        await this.updateContextVariable();
    }

    /**
     * Show files by setting all workspace files.exclude values to false.
     * ONLY modifies existing workspace patterns, does not add defaults.
     */
    async showFiles(): Promise<void> {
        const config = vscode.workspace.getConfiguration();
        const workspaceExclusions = this.getWorkspaceExclusions();

        // Set all workspace patterns to false (don't add new ones)
        const visibleExclusions: Record<string, boolean> = {};
        for (const pattern of Object.keys(workspaceExclusions)) {
            visibleExclusions[pattern] = false;
        }

        // Update workspace configuration
        await config.update("files.exclude", visibleExclusions, vscode.ConfigurationTarget.Workspace);
        await this.updateContextVariable();
    }

    /**
     * Get count of workspace patterns in files.exclude.
     */
    getPatternCount(): number {
        const exclusions = this.getWorkspaceExclusions();
        return Object.keys(exclusions).length;
    }

    /**
     * Check if any workspace patterns exist.
     */
    hasPatterns(): boolean {
        return this.getPatternCount() > 0;
    }

    /**
     * Update context variables for dynamic icon display and visibility.
     */
    private async updateContextVariable(): Promise<void> {
        const hasPatterns = this.hasPatterns();
        await vscode.commands.executeCommand("setContext", "myDevTools.explorerFilesHidden", hasPatterns && this.isHidden());
        await vscode.commands.executeCommand("setContext", "myDevTools.explorerPatternsExist", hasPatterns);
    }

    /**
     * Initialize context variables on activation.
     */
    async initialize(): Promise<void> {
        await this.updateContextVariable();
    }
}

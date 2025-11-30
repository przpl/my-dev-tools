import * as vscode from "vscode";

type NamingStrategy = "camelCase" | "PascalCase" | "snake_case" | "kebab-case";

/**
 * Centralized configuration manager for myDevTools settings.
 * Provides typed access to extension configuration.
 */
class ConfigManager {
    private get config() {
        return vscode.workspace.getConfiguration("myDevTools");
    }

    get enableRealTimePropsUpdate(): boolean {
        return this.config.get<boolean>("enableRealTimePropsUpdate", false);
    }

    set enableRealTimePropsUpdate(value: boolean) {
        this.config.update("enableRealTimePropsUpdate", value, true);
    }

    get autoRenameStrategy(): NamingStrategy {
        return this.config.get<NamingStrategy>("autoRenameStrategy", "kebab-case");
    }
}

export const Config = new ConfigManager();

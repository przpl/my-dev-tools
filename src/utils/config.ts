import * as vscode from "vscode";

type NamingStrategy = "camelCase" | "PascalCase" | "snake_case" | "kebab-case";

/** Paths whose diff is never worth a token: machine-generated, minified or build output. */
export const DEFAULT_COMMIT_MESSAGE_EXCLUDES = [
    "**/package-lock.json",
    "**/npm-shrinkwrap.json",
    "**/pnpm-lock.yaml",
    "**/yarn.lock",
    "**/bun.lockb",
    "**/bun.lock",
    "**/*.lock",
    "**/go.sum",
    "**/*.min.js",
    "**/*.min.css",
    "**/*.map",
    "**/*.svg",
    "**/__snapshots__/**",
    "**/dist/**",
    "**/build/**",
    "**/vendor/**",
];

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

    get openRouterModel(): string {
        return this.config.get<string>("openRouter.model", "openai/gpt-5.6-luna");
    }

    get openRouterBaseUrl(): string {
        return this.config.get<string>("openRouter.baseUrl", "https://openrouter.ai/api/v1");
    }

    get commitMessageMaxDiffCharacters(): number {
        return this.config.get<number>("commitMessage.maxDiffCharacters", 80000);
    }

    get commitMessageStripImportsAboveLines(): number {
        return this.config.get<number>("commitMessage.stripImportsAboveLines", 200);
    }

    get commitMessageSummarizeAddedScriptsAboveLines(): number {
        return this.config.get<number>("commitMessage.summarizeAddedScriptsAboveLines", 60);
    }

    get commitMessageOutlineAddedMarkdownAboveLines(): number {
        return this.config.get<number>("commitMessage.outlineAddedMarkdownAboveLines", 150);
    }

    get commitMessageMaxDiffLineLength(): number {
        return this.config.get<number>("commitMessage.maxDiffLineLength", 160);
    }

    get commitMessageExcludeGlobs(): string[] {
        return this.config.get<string[]>("commitMessage.excludeGlobs", DEFAULT_COMMIT_MESSAGE_EXCLUDES);
    }

    get commitMessageAdditionalInstructions(): string {
        return this.config.get<string>("commitMessage.additionalInstructions", "");
    }
}

export const Config = new ConfigManager();

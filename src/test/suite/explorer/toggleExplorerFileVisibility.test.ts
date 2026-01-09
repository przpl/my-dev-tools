import * as assert from "assert";
import * as vscode from "vscode";
import { FileExclusionManager } from "../../../features/explorer/fileExclusionManager";

type MockConfig = Record<string, Record<string, boolean>>;

suite("FileExclusionManager Tests", () => {
    let mockContext: vscode.ExtensionContext;
    let mockConfig: MockConfig;
    let configUpdateCalls: Array<{ key: string; value: any; target: vscode.ConfigurationTarget }>;

    setup(() => {
        // Reset state
        configUpdateCalls = [];

        // Mock ExtensionContext (minimal implementation)
        mockContext = {} as any;

        // Mock workspace configuration
        mockConfig = {
            "files.exclude": {
                "**/node_modules": false,
                "**/dist": false,
                "**/.git": false,
            },
        };

        vscode.workspace.getConfiguration = ((section?: string) => {
            return {
                get: <T>(key: string, defaultValue?: T): T => {
                    if (key === "files.exclude") {
                        return mockConfig[key] as T;
                    }
                    return defaultValue as T;
                },
                update: async (key: string, value: any, target: vscode.ConfigurationTarget): Promise<void> => {
                    configUpdateCalls.push({ key, value, target });
                    mockConfig[key] = value;
                },
                has: (key: string) => key in mockConfig,
                inspect: <T>(key: string) => {
                    if (key === "files.exclude") {
                        return {
                            key: key,
                            defaultValue: undefined,
                            globalValue: undefined,
                            workspaceValue: mockConfig[key] as T,
                            workspaceFolderValue: undefined,
                        };
                    }
                    return undefined;
                },
            } as any;
        }) as any;
    });

    test("isHidden should return false when all patterns are false", () => {
        mockConfig["files.exclude"] = {
            "**/node_modules": false,
            "**/dist": false,
        };

        const manager = new FileExclusionManager(mockContext);
        assert.strictEqual(manager.isHidden(), false);
    });

    test("isHidden should return true when at least one pattern is true", () => {
        mockConfig["files.exclude"] = {
            "**/node_modules": true,
            "**/dist": false,
        };

        const manager = new FileExclusionManager(mockContext);
        assert.strictEqual(manager.isHidden(), true);
    });

    test("isHidden should return true when all patterns are true", () => {
        mockConfig["files.exclude"] = {
            "**/node_modules": true,
            "**/dist": true,
        };

        const manager = new FileExclusionManager(mockContext);
        assert.strictEqual(manager.isHidden(), true);
    });

    test("hideFiles should set all patterns to true", async () => {
        mockConfig["files.exclude"] = {
            "**/node_modules": false,
            "**/dist": false,
            "**/.git": false,
        };

        const manager = new FileExclusionManager(mockContext);
        await manager.hideFiles();

        assert.strictEqual(mockConfig["files.exclude"]["**/node_modules"], true);
        assert.strictEqual(mockConfig["files.exclude"]["**/dist"], true);
        assert.strictEqual(mockConfig["files.exclude"]["**/.git"], true);
    });

    test("showFiles should set all patterns to false", async () => {
        mockConfig["files.exclude"] = {
            "**/node_modules": true,
            "**/dist": true,
            "**/.git": true,
        };

        const manager = new FileExclusionManager(mockContext);
        await manager.showFiles();

        assert.strictEqual(mockConfig["files.exclude"]["**/node_modules"], false);
        assert.strictEqual(mockConfig["files.exclude"]["**/dist"], false);
        assert.strictEqual(mockConfig["files.exclude"]["**/.git"], false);
    });

    test("hideFiles should update configuration with Workspace target", async () => {
        const manager = new FileExclusionManager(mockContext);
        await manager.hideFiles();

        const updateCall = configUpdateCalls.find((call) => call.key === "files.exclude");
        assert.ok(updateCall, "Configuration update should be called");
        assert.strictEqual(updateCall?.target, vscode.ConfigurationTarget.Workspace);
    });

    test("showFiles should update configuration with Workspace target", async () => {
        mockConfig["files.exclude"] = {
            "**/test": true,
        };

        const manager = new FileExclusionManager(mockContext);
        await manager.showFiles();

        const updateCall = configUpdateCalls.find((call) => call.key === "files.exclude");
        assert.ok(updateCall, "Configuration update should be called");
        assert.strictEqual(updateCall?.target, vscode.ConfigurationTarget.Workspace);
    });

    test("getPatternCount should return number of patterns", () => {
        mockConfig["files.exclude"] = {
            "**/node_modules": false,
            "**/dist": false,
            "**/.git": false,
        };

        const manager = new FileExclusionManager(mockContext);
        assert.strictEqual(manager.getPatternCount(), 3);
    });

    test("getPatternCount should return 0 for empty files.exclude", () => {
        mockConfig["files.exclude"] = {};

        const manager = new FileExclusionManager(mockContext);
        assert.strictEqual(manager.getPatternCount(), 0);
    });

    test("hideFiles then showFiles should toggle correctly", async () => {
        mockConfig["files.exclude"] = {
            "**/test": false,
        };

        const manager = new FileExclusionManager(mockContext);

        // Initially visible
        assert.strictEqual(manager.isHidden(), false);

        // Hide
        await manager.hideFiles();
        assert.strictEqual(manager.isHidden(), true);
        assert.strictEqual(mockConfig["files.exclude"]["**/test"], true);

        // Show
        await manager.showFiles();
        assert.strictEqual(manager.isHidden(), false);
        assert.strictEqual(mockConfig["files.exclude"]["**/test"], false);
    });

    test("should handle mixed true/false values correctly", async () => {
        mockConfig["files.exclude"] = {
            "**/node_modules": true,
            "**/dist": false,
            "**/.git": true,
        };

        const manager = new FileExclusionManager(mockContext);

        // Should be hidden because at least one is true
        assert.strictEqual(manager.isHidden(), true);

        // Show all
        await manager.showFiles();
        assert.strictEqual(mockConfig["files.exclude"]["**/node_modules"], false);
        assert.strictEqual(mockConfig["files.exclude"]["**/dist"], false);
        assert.strictEqual(mockConfig["files.exclude"]["**/.git"], false);

        // Hide all
        await manager.hideFiles();
        assert.strictEqual(mockConfig["files.exclude"]["**/node_modules"], true);
        assert.strictEqual(mockConfig["files.exclude"]["**/dist"], true);
        assert.strictEqual(mockConfig["files.exclude"]["**/.git"], true);
    });

    test("hasPatterns should return true when patterns exist", () => {
        mockConfig["files.exclude"] = {
            "**/node_modules": false,
            "**/dist": false,
        };

        const manager = new FileExclusionManager(mockContext);
        assert.strictEqual(manager.hasPatterns(), true);
    });

    test("hasPatterns should return false when no patterns exist", () => {
        mockConfig["files.exclude"] = {};

        const manager = new FileExclusionManager(mockContext);
        assert.strictEqual(manager.hasPatterns(), false);
    });

    test("initialize should set context variables correctly when patterns exist and hidden", async () => {
        mockConfig["files.exclude"] = {
            "**/test": true,
        };

        let contextCalls: Array<{ key: string; value: any }> = [];
        const originalExecuteCommand = vscode.commands.executeCommand;
        vscode.commands.executeCommand = async (command: string, ...args: any[]): Promise<any> => {
            if (command === "setContext") {
                contextCalls.push({ key: args[0], value: args[1] });
            }
            return undefined;
        };

        const manager = new FileExclusionManager(mockContext);
        await manager.initialize();

        assert.ok(contextCalls.find(c => c.key === "myDevTools.explorerFilesHidden" && c.value === true));
        assert.ok(contextCalls.find(c => c.key === "myDevTools.explorerPatternsExist" && c.value === true));

        vscode.commands.executeCommand = originalExecuteCommand;
    });

    test("initialize should set context variables correctly when patterns exist and visible", async () => {
        mockConfig["files.exclude"] = {
            "**/test": false,
        };

        let contextCalls: Array<{ key: string; value: any }> = [];
        const originalExecuteCommand = vscode.commands.executeCommand;
        vscode.commands.executeCommand = async (command: string, ...args: any[]): Promise<any> => {
            if (command === "setContext") {
                contextCalls.push({ key: args[0], value: args[1] });
            }
            return undefined;
        };

        const manager = new FileExclusionManager(mockContext);
        await manager.initialize();

        assert.ok(contextCalls.find(c => c.key === "myDevTools.explorerFilesHidden" && c.value === false));
        assert.ok(contextCalls.find(c => c.key === "myDevTools.explorerPatternsExist" && c.value === true));

        vscode.commands.executeCommand = originalExecuteCommand;
    });

    test("initialize should set context variables correctly when no patterns exist", async () => {
        mockConfig["files.exclude"] = {};

        let contextCalls: Array<{ key: string; value: any }> = [];
        const originalExecuteCommand = vscode.commands.executeCommand;
        vscode.commands.executeCommand = async (command: string, ...args: any[]): Promise<any> => {
            if (command === "setContext") {
                contextCalls.push({ key: args[0], value: args[1] });
            }
            return undefined;
        };

        const manager = new FileExclusionManager(mockContext);
        await manager.initialize();

        assert.ok(contextCalls.find(c => c.key === "myDevTools.explorerFilesHidden" && c.value === false));
        assert.ok(contextCalls.find(c => c.key === "myDevTools.explorerPatternsExist" && c.value === false));

        vscode.commands.executeCommand = originalExecuteCommand;
    });
});

suite("Explorer File Visibility Command Tests", () => {
    let infoMessage: string | undefined;
    let warningMessage: string | undefined;
    let errorMessage: string | undefined;
    let originalShowInformationMessage: any;
    let originalShowWarningMessage: any;
    let originalShowErrorMessage: any;
    let mockContext: vscode.ExtensionContext;
    let mockConfig: any;

    setup(() => {
        // Reset messages
        infoMessage = undefined;
        warningMessage = undefined;
        errorMessage = undefined;

        // Mock window methods
        originalShowInformationMessage = vscode.window.showInformationMessage;
        originalShowWarningMessage = vscode.window.showWarningMessage;
        originalShowErrorMessage = vscode.window.showErrorMessage;

        vscode.window.showInformationMessage = async (message: string) => {
            infoMessage = message;
            return undefined;
        };

        vscode.window.showWarningMessage = async (message: string) => {
            warningMessage = message;
            return undefined;
        };

        vscode.window.showErrorMessage = async (message: string) => {
            errorMessage = message;
            return undefined;
        };

        // Mock context
        mockContext = {} as any;

        // Mock configurations
        mockConfig = {
            "files.exclude": {
                "**/node_modules": false,
                "**/dist": false,
            },
        };

        vscode.workspace.getConfiguration = ((section?: string) => {
            return {
                get: <T>(key: string, defaultValue?: T): T => {
                    if (key === "files.exclude") {
                        return mockConfig[key] as T;
                    }
                    return defaultValue as T;
                },
                update: async (key: string, value: any): Promise<void> => {
                    mockConfig[key] = value;
                },
                has: (key: string) => key in mockConfig,
                inspect: <T>(key: string) => {
                    if (key === "files.exclude") {
                        return {
                            key: key,
                            defaultValue: undefined,
                            globalValue: undefined,
                            workspaceValue: mockConfig[key] as T,
                            workspaceFolderValue: undefined,
                        };
                    }
                    return undefined;
                },
            } as any;
        }) as any;
    });

    teardown(() => {
        // Restore original methods
        vscode.window.showInformationMessage = originalShowInformationMessage;
        vscode.window.showWarningMessage = originalShowWarningMessage;
        vscode.window.showErrorMessage = originalShowErrorMessage;
    });

    test("should show warning when files.exclude is empty", async () => {
        mockConfig["files.exclude"] = {};

        const manager = new FileExclusionManager(mockContext);
        const patternCount = manager.getPatternCount();

        if (patternCount === 0) {
            await vscode.window.showWarningMessage('No patterns in files.exclude. Add patterns to Settings > Files: Exclude');
        }

        assert.ok(warningMessage?.includes("No patterns"));
    });

    test("should show info message when hiding files", async () => {
        const manager = new FileExclusionManager(mockContext);
        const patternCount = manager.getPatternCount();

        await manager.hideFiles();
        await vscode.window.showInformationMessage(`Hiding ${patternCount} pattern(s) in Explorer`);

        assert.ok(infoMessage?.includes("Hiding"));
        assert.ok(infoMessage?.includes("2"));
    });

    test("should show info message when showing files", async () => {
        mockConfig["files.exclude"] = {
            "**/test": true,
        };

        const manager = new FileExclusionManager(mockContext);
        const patternCount = manager.getPatternCount();

        await manager.showFiles();
        await vscode.window.showInformationMessage(`Showing ${patternCount} pattern(s) in Explorer`);

        assert.ok(infoMessage?.includes("Showing"));
    });
});

import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { autoRename } from "../../features/renameFile";
import { delay } from "../helpers/vscodeStubs";

suite("RenameFile Tests", () => {
    let originalActiveTextEditor: vscode.TextEditor | undefined;
    let originalGetConfiguration: typeof vscode.workspace.getConfiguration;
    let tempDir: string;

    setup(async () => {
        // Store original methods
        originalActiveTextEditor = vscode.window.activeTextEditor;
        originalGetConfiguration = vscode.workspace.getConfiguration;

        // Create temporary directory for test files
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-test-"));

        // Mock configuration to return default values
        vscode.workspace.getConfiguration = () => {
            const mockConfig = {
                get: <T>(key: string, defaultValue?: T): T => {
                    if (key === "autoRenameStrategy") {
                        return "kebab-case" as T;
                    }
                    return defaultValue as T;
                },
                update: async () => true,
                has: () => true,
                inspect: () => undefined,
            };
            return mockConfig as any;
        };
    });

    teardown(async () => {
        // Close all editors so Windows releases its handles on the temp files
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");

        // Restore the real settings: the stub would otherwise follow Mocha into the next suite
        vscode.workspace.getConfiguration = originalGetConfiguration;

        // Clean up temporary files
        if (tempDir && fs.existsSync(tempDir)) {
            // VS Code disposes documents asynchronously after the tab closes, so on
            // Windows the directory can still be locked here. Retry, then give up
            // quietly - a leaked temp dir must not fail the test.
            try {
                fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
            } catch {
                // ignore
            }
        }

        // Restore original activeTextEditor property
        if (originalActiveTextEditor !== undefined) {
            Object.defineProperty(vscode.window, "activeTextEditor", {
                value: originalActiveTextEditor,
                configurable: true,
            });
        }
    });

    async function createTestFile(content: string, fileName: string = "test-file.ts"): Promise<void> {
        // Create a temporary file on disk with the test content
        const testFilePath = path.join(tempDir, fileName);
        fs.writeFileSync(testFilePath, content, "utf8");

        // Open the file in VS Code
        const uri = vscode.Uri.file(testFilePath);
        const testDocument = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(testDocument);
    }

    /**
     * Runs the rename and reports the name the file ended up with. A `WorkspaceEdit`'s file
     * operations have no public accessor - `entries()` returns text edits only - so the rename is
     * performed for real and read back off disk rather than out of a private field, which is
     * minified and renamed by any VS Code update.
     */
    async function captureRename(): Promise<string | undefined> {
        const before = new Set(fs.readdirSync(tempDir));

        await autoRename();

        // The editor follows the file to its new name a moment after the edit is applied; letting
        // that finish here keeps the workbench from complaining into a later test's output.
        await delay(100);

        return fs.readdirSync(tempDir).find(name => !before.has(name));
    }

    test("should show error when no active editor", async () => {
        // Close any active editor
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

        // Mock showErrorMessage to capture the call
        let errorMessage = "";
        const originalShowErrorMessage = vscode.window.showErrorMessage;
        vscode.window.showErrorMessage = async (message: string) => {
            errorMessage = message;
            return undefined;
        };

        await autoRename();

        // Restore original method
        vscode.window.showErrorMessage = originalShowErrorMessage;

        assert.strictEqual(errorMessage, "No active file to rename.", "Should show error when no active editor");
    });

    test("should show error when no exported symbols found", async () => {
        const codeWithNoExports = `const privateFunction = () => {
    console.log("This is not exported");
};

let privateVariable = "also not exported";`;

        await createTestFile(codeWithNoExports);

        let warningMessage = "";
        const originalShowWarningMessage = vscode.window.showWarningMessage;
        vscode.window.showWarningMessage = async (message: string) => {
            warningMessage = message;
            return undefined;
        };

        await autoRename();

        // Restore original method
        vscode.window.showWarningMessage = originalShowWarningMessage;

        assert.strictEqual(warningMessage, "No exported symbols found in the current file.", "Should show warning when no exports found");
    });

    test("should auto-rename with single exported function using kebab-case", async () => {
        const codeWithSingleExport = `export function MyTestFunction() {
    return "Hello World";
}`;

        await createTestFile(codeWithSingleExport, "old-name.ts");

        // Mock workspace.applyEdit to capture the rename operation
        const capturedNewFileName = await captureRename();

        assert.ok(capturedNewFileName, "Should perform rename operation");
        assert.strictEqual(capturedNewFileName, "my-test-function.ts", "Should rename to kebab-case");
    });

    test("should show quick pick for multiple exports and sort correctly", async () => {
        const codeWithMultipleExports = `export class UserService {
    getUser() { return {}; }
}

export function validateUser() {
    return true;
}

export interface UserData {
    id: string;
    name: string;
}`;

        await createTestFile(codeWithMultipleExports, "current-file.ts");

        let quickPickItems: vscode.QuickPickItem[] = [];
        const originalShowQuickPick = vscode.window.showQuickPick;
        vscode.window.showQuickPick = async <T extends vscode.QuickPickItem>(
            items: readonly T[] | Thenable<readonly T[]>,
            options?: vscode.QuickPickOptions
        ): Promise<T | undefined> => {
            const resolvedItems = await Promise.resolve(items);
            quickPickItems = [...resolvedItems] as vscode.QuickPickItem[];
            // Simulate user selecting the first item (UserService - class)
            return resolvedItems[0];
        };

        const capturedNewFileName = await captureRename();

        // Restore original method
        vscode.window.showQuickPick = originalShowQuickPick;

        // Verify quick pick was shown with correct items
        assert.strictEqual(quickPickItems.length, 3, "Should show 3 export options");

        // Verify sorting by type priority (class first, then function, then interface)
        assert.strictEqual(quickPickItems[0].label, "UserService", "Class should be first");
        assert.strictEqual(quickPickItems[0].description, "class", "Should show class type");
        assert.strictEqual(quickPickItems[1].label, "validateUser", "Function should be second");
        assert.strictEqual(quickPickItems[1].description, "function", "Should show function type");
        assert.strictEqual(quickPickItems[2].label, "UserData", "Interface should be third");
        assert.strictEqual(quickPickItems[2].description, "interface", "Should show interface type");

        // Verify rename operation
        assert.ok(capturedNewFileName, "Should perform rename operation");
        assert.strictEqual(capturedNewFileName, "user-service.ts", "Should rename to kebab-case based on selected class");
    });

    test("should use camelCase when configured", async () => {
        // Override the mock configuration for this specific test
        vscode.workspace.getConfiguration = () => {
            const mockConfig = {
                get: <T>(key: string, defaultValue?: T): T => {
                    if (key === "autoRenameStrategy") {
                        return "camelCase" as T;
                    }
                    return defaultValue as T;
                },
                update: async () => true,
                has: () => true,
                inspect: () => undefined,
            };
            return mockConfig as any;
        };

        const codeWithExport = `export class MyTestClass {
    doSomething() {}
}`;

        await createTestFile(codeWithExport, "old-name.ts");

        const capturedNewFileName = await captureRename();

        assert.ok(capturedNewFileName, "Should perform rename operation");
        assert.strictEqual(capturedNewFileName, "myTestClass.ts", "Should rename to camelCase");
    });

    test("should show info message when file name already matches", async () => {
        const codeWithExport = `export function myTestFunction() {
    return "test";
}`;

        await createTestFile(codeWithExport, "my-test-function.ts");

        let infoMessage = "";
        const originalShowInformationMessage = vscode.window.showInformationMessage;
        vscode.window.showInformationMessage = async (message: string) => {
            infoMessage = message;
            return undefined;
        };

        await autoRename();

        // Restore original method
        vscode.window.showInformationMessage = originalShowInformationMessage;

        assert.strictEqual(
            infoMessage,
            "File name already matches the selected symbol.",
            "Should show info when file name already matches"
        );
    });

    test("should handle mixed export types and sort correctly", async () => {
        const codeWithMixedExports = `export const myVariable = "test";

export enum Color {
    Red,
    Green,
    Blue
}

export type UserType = {
    id: string;
};

export interface UserInterface {
    name: string;
}

export function myFunction() {
    return true;
}

export class MyClass {
    method() {}
}`;

        await createTestFile(codeWithMixedExports, "mixed-exports.ts");

        let quickPickItems: vscode.QuickPickItem[] = [];
        const originalShowQuickPick = vscode.window.showQuickPick;
        vscode.window.showQuickPick = async <T extends vscode.QuickPickItem>(
            items: readonly T[] | Thenable<readonly T[]>,
            options?: vscode.QuickPickOptions
        ): Promise<T | undefined> => {
            const resolvedItems = await Promise.resolve(items);
            quickPickItems = [...resolvedItems] as vscode.QuickPickItem[];
            return undefined; // User cancels
        };

        await autoRename();

        // Restore original method
        vscode.window.showQuickPick = originalShowQuickPick;

        // Verify correct sorting order: class, function, interface, type, variable, enum
        assert.strictEqual(quickPickItems.length, 6, "Should show all 6 exports");
        assert.strictEqual(quickPickItems[0].description, "class", "Class should be first");
        assert.strictEqual(quickPickItems[1].description, "function", "Function should be second");
        assert.strictEqual(quickPickItems[2].description, "interface", "Interface should be third");
        assert.strictEqual(quickPickItems[3].description, "type", "Type should be fourth");
        assert.strictEqual(quickPickItems[4].description, "enum", "Enum should be fifth");
        assert.strictEqual(quickPickItems[5].description, "variable", "Variable should be sixth");
    });

    test("should use PascalCase when configured", async () => {
        // Override the mock configuration for this specific test
        vscode.workspace.getConfiguration = () => {
            const mockConfig = {
                get: <T>(key: string, defaultValue?: T): T => {
                    if (key === "autoRenameStrategy") {
                        return "PascalCase" as T;
                    }
                    return defaultValue as T;
                },
                update: async () => true,
                has: () => true,
                inspect: () => undefined,
            };
            return mockConfig as any;
        };

        const codeWithExport = `export function getUserData() {
    return {};
}`;

        await createTestFile(codeWithExport, "old-name.ts");

        const capturedNewFileName = await captureRename();

        assert.ok(capturedNewFileName, "Should perform rename operation");
        assert.strictEqual(capturedNewFileName, "GetUserData.ts", "Should rename to PascalCase");
    });

    test("should use snake_case when configured", async () => {
        // Override the mock configuration for this specific test
        vscode.workspace.getConfiguration = () => {
            const mockConfig = {
                get: <T>(key: string, defaultValue?: T): T => {
                    if (key === "autoRenameStrategy") {
                        return "snake_case" as T;
                    }
                    return defaultValue as T;
                },
                update: async () => true,
                has: () => true,
                inspect: () => undefined,
            };
            return mockConfig as any;
        };

        const codeWithExport = `export class UserProfileService {
    getProfile() {}
}`;

        await createTestFile(codeWithExport, "old-name.ts");

        const capturedNewFileName = await captureRename();

        assert.ok(capturedNewFileName, "Should perform rename operation");
        assert.strictEqual(capturedNewFileName, "user_profile_service.ts", "Should rename to snake_case");
    });

    test("should handle re-exported symbols", async () => {
        const codeWithReExport = `export { useState } from 'react';

export function useCustomHook() {
    return {};
}`;

        await createTestFile(codeWithReExport, "hooks.ts");

        let quickPickItems: vscode.QuickPickItem[] = [];
        const originalShowQuickPick = vscode.window.showQuickPick;
        vscode.window.showQuickPick = async <T extends vscode.QuickPickItem>(
            items: readonly T[] | Thenable<readonly T[]>,
        ): Promise<T | undefined> => {
            const resolvedItems = await Promise.resolve(items);
            quickPickItems = [...resolvedItems] as vscode.QuickPickItem[];
            return undefined; // User cancels
        };

        await autoRename();

        // Restore original method
        vscode.window.showQuickPick = originalShowQuickPick;

        // Should include both exported symbols
        assert.ok(quickPickItems.length >= 1, "Should show exported symbols");
        assert.ok(
            quickPickItems.some((item) => item.label === "useCustomHook"),
            "Should include useCustomHook in options"
        );
    });

    test("should handle exported arrow function as variable", async () => {
        const codeWithArrowFunction = `export const fetchUserData = async () => {
    return await fetch('/api/user');
};`;

        await createTestFile(codeWithArrowFunction, "api-utils.ts");

        const capturedNewFileName = await captureRename();

        assert.ok(capturedNewFileName, "Should perform rename operation for exported arrow function");
        assert.strictEqual(capturedNewFileName, "fetch-user-data.ts", "Should rename to kebab-case based on arrow function name");
    });
});

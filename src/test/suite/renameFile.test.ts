import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { autoRename } from "../../features/renameFile";

/**
 * Extracts the target filename from a WorkspaceEdit rename operation.
 * Accesses the internal structure to find rename file operations.
 */
function extractRenameTargetFilename(edit: vscode.WorkspaceEdit): string | undefined {
    const editAny = edit as any;

    // The internal structure uses minified property 'a' for the edits array
    const edits = editAny.a || editAny._edits;

    if (edits && Array.isArray(edits)) {
        for (const operation of edits) {
            // Rename operations have 'to' property with the target URI
            // The 'to' property has a 'path' with the file path
            if (operation.to && operation.to.path) {
                // Extract filename from the path (format: /c:/path/to/file.ts)
                const filePath = operation.to.path;
                return path.basename(filePath);
            }
        }
    }

    return undefined;
}

suite("RenameFile Tests", () => {
    let testEditor: vscode.TextEditor;
    let originalActiveTextEditor: vscode.TextEditor | undefined;
    let tempDir: string;
    let testFilePath: string | undefined;

    setup(async () => {
        // Store original methods
        originalActiveTextEditor = vscode.window.activeTextEditor;

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
        if (testEditor) {
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
        }

        // Clean up temporary files
        if (testFilePath && fs.existsSync(testFilePath)) {
            fs.unlinkSync(testFilePath);
        }
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
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
        testFilePath = path.join(tempDir, fileName);
        fs.writeFileSync(testFilePath, content, "utf8");

        // Open the file in VS Code
        const uri = vscode.Uri.file(testFilePath);
        const testDocument = await vscode.workspace.openTextDocument(uri);
        testEditor = await vscode.window.showTextDocument(testDocument);
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
        let capturedNewFileName: string | undefined;
        const originalApplyEdit = vscode.workspace.applyEdit;
        vscode.workspace.applyEdit = async (edit: vscode.WorkspaceEdit) => {
            capturedNewFileName = extractRenameTargetFilename(edit);
            return true;
        };

        await autoRename();

        // Restore original method
        vscode.workspace.applyEdit = originalApplyEdit;

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

        let capturedNewFileName: string | undefined;
        const originalApplyEdit = vscode.workspace.applyEdit;
        vscode.workspace.applyEdit = async (edit: vscode.WorkspaceEdit) => {
            capturedNewFileName = extractRenameTargetFilename(edit);
            return true;
        };

        await autoRename();

        // Restore original methods
        vscode.window.showQuickPick = originalShowQuickPick;
        vscode.workspace.applyEdit = originalApplyEdit;

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

        let capturedNewFileName: string | undefined;
        const originalApplyEdit = vscode.workspace.applyEdit;
        vscode.workspace.applyEdit = async (edit: vscode.WorkspaceEdit) => {
            capturedNewFileName = extractRenameTargetFilename(edit);
            return true;
        };

        await autoRename();

        // Restore original method
        vscode.workspace.applyEdit = originalApplyEdit;

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

        let capturedNewFileName: string | undefined;
        const originalApplyEdit = vscode.workspace.applyEdit;
        vscode.workspace.applyEdit = async (edit: vscode.WorkspaceEdit) => {
            capturedNewFileName = extractRenameTargetFilename(edit);
            return true;
        };

        await autoRename();

        // Restore original method
        vscode.workspace.applyEdit = originalApplyEdit;

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

        let capturedNewFileName: string | undefined;
        const originalApplyEdit = vscode.workspace.applyEdit;
        vscode.workspace.applyEdit = async (edit: vscode.WorkspaceEdit) => {
            capturedNewFileName = extractRenameTargetFilename(edit);
            return true;
        };

        await autoRename();

        // Restore original method
        vscode.workspace.applyEdit = originalApplyEdit;

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

        let capturedNewFileName: string | undefined;
        const originalApplyEdit = vscode.workspace.applyEdit;
        vscode.workspace.applyEdit = async (edit: vscode.WorkspaceEdit) => {
            capturedNewFileName = extractRenameTargetFilename(edit);
            return true;
        };

        await autoRename();

        // Restore original method
        vscode.workspace.applyEdit = originalApplyEdit;

        assert.ok(capturedNewFileName, "Should perform rename operation for exported arrow function");
        assert.strictEqual(capturedNewFileName, "fetch-user-data.ts", "Should rename to kebab-case based on arrow function name");
    });
});

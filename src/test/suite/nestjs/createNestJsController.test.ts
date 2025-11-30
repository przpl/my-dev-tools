import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { createNestJsController } from "../../../features/nestjs/createNestJsController";

suite("CreateNestJsController Tests", () => {
    let tempDir: string;

    setup(async () => {
        // Create temporary directory structure for test files
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-test-"));
    });

    teardown(async () => {
        // Close all editors
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");

        // Clean up temporary files
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    async function createFileStructure(structure: { [key: string]: string }): Promise<void> {
        for (const [relativePath, content] of Object.entries(structure)) {
            const fullPath = path.join(tempDir, relativePath);
            const dir = path.dirname(fullPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(fullPath, content, "utf8");
        }
    }

    test("should show error when no folder is selected", async () => {
        let errorMessage = "";
        const originalShowErrorMessage = vscode.window.showErrorMessage;
        vscode.window.showErrorMessage = async (message: string) => {
            errorMessage = message;
            return undefined;
        };

        // Call with undefined uri
        await createNestJsController(undefined as any);

        // Restore original method
        vscode.window.showErrorMessage = originalShowErrorMessage;

        assert.strictEqual(
            errorMessage,
            "Please select a folder to create the NestJS controller.",
            "Should show error when no folder selected"
        );
    });

    test("should show error when uri is a file not a directory", async () => {
        await createFileStructure({
            "src/app.module.ts": `@Module({}) export class AppModule {}`,
        });

        const fileUri = vscode.Uri.file(path.join(tempDir, "src/app.module.ts"));

        let errorMessage = "";
        const originalShowErrorMessage = vscode.window.showErrorMessage;
        vscode.window.showErrorMessage = async (message: string) => {
            errorMessage = message;
            return undefined;
        };

        await createNestJsController(fileUri);

        // Restore original method
        vscode.window.showErrorMessage = originalShowErrorMessage;

        assert.strictEqual(
            errorMessage,
            "Please select a folder to create the NestJS controller.",
            "Should show error when file is selected instead of folder"
        );
    });

    test("should show error when controller name is empty", async () => {
        await createFileStructure({
            "src/users/users.module.ts": `@Module({}) export class UsersModule {}`,
        });

        const folderUri = vscode.Uri.file(path.join(tempDir, "src/users"));

        // Mock showInputBox to return empty string
        const originalShowInputBox = vscode.window.showInputBox;
        vscode.window.showInputBox = async () => "";

        let errorMessage = "";
        const originalShowErrorMessage = vscode.window.showErrorMessage;
        vscode.window.showErrorMessage = async (message: string) => {
            errorMessage = message;
            return undefined;
        };

        await createNestJsController(folderUri);

        // Restore original methods
        vscode.window.showInputBox = originalShowInputBox;
        vscode.window.showErrorMessage = originalShowErrorMessage;

        assert.strictEqual(
            errorMessage,
            "Controller name cannot be empty.",
            "Should show error when controller name is empty"
        );
    });

    test("should show error when controller name is cancelled (undefined)", async () => {
        await createFileStructure({
            "src/users/users.module.ts": `@Module({}) export class UsersModule {}`,
        });

        const folderUri = vscode.Uri.file(path.join(tempDir, "src/users"));

        // Mock showInputBox to return undefined (user cancelled)
        const originalShowInputBox = vscode.window.showInputBox;
        vscode.window.showInputBox = async () => undefined;

        let errorMessage = "";
        const originalShowErrorMessage = vscode.window.showErrorMessage;
        vscode.window.showErrorMessage = async (message: string) => {
            errorMessage = message;
            return undefined;
        };

        await createNestJsController(folderUri);

        // Restore original methods
        vscode.window.showInputBox = originalShowInputBox;
        vscode.window.showErrorMessage = originalShowErrorMessage;

        assert.strictEqual(
            errorMessage,
            "Controller name cannot be empty.",
            "Should show error when controller name is cancelled"
        );
    });

    test("should create controller file with correct content", async () => {
        await createFileStructure({
            "src/users/users.module.ts": `import { Module } from "@nestjs/common";

@Module({
    controllers: [],
})
export class UsersModule {}`,
        });

        const folderUri = vscode.Uri.file(path.join(tempDir, "src/users"));

        // Mock showInputBox to return controller name
        const originalShowInputBox = vscode.window.showInputBox;
        vscode.window.showInputBox = async () => "Profile";

        await createNestJsController(folderUri);

        // Restore original method
        vscode.window.showInputBox = originalShowInputBox;

        // Check if controller file was created
        const controllerPath = path.join(tempDir, "src/users/profile.controller.ts");
        assert.ok(fs.existsSync(controllerPath), "Controller file should be created");

        // Check content
        const content = fs.readFileSync(controllerPath, "utf8");
        assert.ok(content.includes('@Controller("profile")'), "Should have correct @Controller decorator");
        assert.ok(content.includes("export class ProfileController"), "Should have correct class name");
        assert.ok(content.includes("public constructor() {}"), "Should have constructor");
    });

    test("should show error when controller file already exists", async () => {
        await createFileStructure({
            "src/users/users.module.ts": `@Module({}) export class UsersModule {}`,
            "src/users/profile.controller.ts": `// existing controller`,
        });

        const folderUri = vscode.Uri.file(path.join(tempDir, "src/users"));

        // Mock showInputBox to return controller name
        const originalShowInputBox = vscode.window.showInputBox;
        vscode.window.showInputBox = async () => "Profile";

        let errorMessage = "";
        const originalShowErrorMessage = vscode.window.showErrorMessage;
        vscode.window.showErrorMessage = async (message: string) => {
            errorMessage = message;
            return undefined;
        };

        await createNestJsController(folderUri);

        // Restore original methods
        vscode.window.showInputBox = originalShowInputBox;
        vscode.window.showErrorMessage = originalShowErrorMessage;

        assert.ok(
            errorMessage.includes("Controller file already exists"),
            `Should show error when controller exists, got: ${errorMessage}`
        );
    });

    test("should handle controller name with Controller suffix", async () => {
        await createFileStructure({
            "src/users/users.module.ts": `import { Module } from "@nestjs/common";

@Module({
    controllers: [],
})
export class UsersModule {}`,
        });

        const folderUri = vscode.Uri.file(path.join(tempDir, "src/users"));

        // Mock showInputBox to return controller name with suffix
        const originalShowInputBox = vscode.window.showInputBox;
        vscode.window.showInputBox = async () => "ProfileController";

        await createNestJsController(folderUri);

        // Restore original method
        vscode.window.showInputBox = originalShowInputBox;

        // Should still create profile.controller.ts, not profilecontroller.controller.ts
        const controllerPath = path.join(tempDir, "src/users/profile.controller.ts");
        assert.ok(fs.existsSync(controllerPath), "Controller file should be created without duplicate Controller suffix");

        const content = fs.readFileSync(controllerPath, "utf8");
        assert.ok(content.includes("ProfileController"), "Class should be named ProfileController");
    });

    test("should convert controller name to kebab-case for file name", async () => {
        await createFileStructure({
            "src/users/users.module.ts": `import { Module } from "@nestjs/common";

@Module({
    controllers: [],
})
export class UsersModule {}`,
        });

        const folderUri = vscode.Uri.file(path.join(tempDir, "src/users"));

        // Mock showInputBox to return controller name
        const originalShowInputBox = vscode.window.showInputBox;
        vscode.window.showInputBox = async () => "UserProfile";

        await createNestJsController(folderUri);

        // Restore original method
        vscode.window.showInputBox = originalShowInputBox;

        // Should create user-profile.controller.ts
        const controllerPath = path.join(tempDir, "src/users/user-profile.controller.ts");
        assert.ok(fs.existsSync(controllerPath), "Controller file should use kebab-case naming");

        const content = fs.readFileSync(controllerPath, "utf8");
        assert.ok(content.includes('@Controller("user-profile")'), "Slug should be kebab-case");
        assert.ok(content.includes("UserProfileController"), "Class should be PascalCase");
    });

    test("should show error when no module file found", async () => {
        // Create folder without module file
        const srcPath = path.join(tempDir, "src/users");
        fs.mkdirSync(srcPath, { recursive: true });

        const folderUri = vscode.Uri.file(srcPath);

        // Mock showInputBox to return controller name
        const originalShowInputBox = vscode.window.showInputBox;
        vscode.window.showInputBox = async () => "Profile";

        let errorMessage = "";
        const originalShowErrorMessage = vscode.window.showErrorMessage;
        vscode.window.showErrorMessage = async (message: string) => {
            errorMessage = message;
            return undefined;
        };

        await createNestJsController(folderUri);

        // Restore original methods
        vscode.window.showInputBox = originalShowInputBox;
        vscode.window.showErrorMessage = originalShowErrorMessage;

        assert.ok(
            errorMessage.includes("No NestJS module file"),
            `Should show error when no module found, got: ${errorMessage}`
        );
    });

    test("should handle lowercase input and convert to PascalCase", async () => {
        await createFileStructure({
            "src/users/users.module.ts": `import { Module } from "@nestjs/common";

@Module({
    controllers: [],
})
export class UsersModule {}`,
        });

        const folderUri = vscode.Uri.file(path.join(tempDir, "src/users"));

        // Mock showInputBox to return lowercase name
        const originalShowInputBox = vscode.window.showInputBox;
        vscode.window.showInputBox = async () => "profile";

        await createNestJsController(folderUri);

        // Restore original method
        vscode.window.showInputBox = originalShowInputBox;

        // Check if controller file was created with PascalCase class name
        const controllerPath = path.join(tempDir, "src/users/profile.controller.ts");
        assert.ok(fs.existsSync(controllerPath), "Controller file should be created");

        const content = fs.readFileSync(controllerPath, "utf8");
        assert.ok(content.includes("export class ProfileController"), "Class should be PascalCase");
    });

    // Note: Tests that require workspace folder context (like updating module files with new controllers)
    // cannot be reliably tested with temp directories outside the workspace.
    // The FileUtils.findNearest function uses vscode.workspace.getWorkspaceFolder which
    // requires the file to be within an open workspace folder.
});

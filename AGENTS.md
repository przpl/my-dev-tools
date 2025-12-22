# My Dev Tools

VS Code extension built with TypeScript and ts-morph for AST manipulation, providing development utilities for React component management, NestJS code generation, and intelligent file operations.

## Technology Stack

-   **Language:** TypeScript 5 with strict mode enabled
-   **Runtime:** VS Code Extension API
-   **AST Processing:** ts-morph for TypeScript code analysis and manipulation
-   **Utilities:** es-toolkit
-   **Testing:** Mocha with @vscode/test-electron for extension integration tests
-   **Build:** esbuild with bundling for production extension packaging

## Project Structure

-   Commands organized by domain in `src/features/[domain]/` with feature-specific modules
-   Utility functions in `src/utils/`
-   Extension activation in `src/extension.ts` with command registration and context subscriptions
-   Tests in `src/test/suite/` using Mocha with VS Code API mocking patterns
-   Configuration schema defined in `package.json` contributes section

## AST Manipulation Standards

-   Use ts-morph `Project` instances for TypeScript code analysis and transformation
-   Apply changes via VS Code WorkspaceEdit rather than direct file system writes

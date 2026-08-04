import * as assert from "assert";
import * as vscode from "vscode";

import { collectResourceUris } from "../../../features/git/autoStage";
import { resolveFilePath } from "../../../features/git/stageActiveFile";

/** The two parsers that read what VS Code hands the git commands: a URI, and a menu's arguments. */
suite("GitPaths Tests", () => {
    suite("resolveFilePath", () => {
        test("should read a file uri", () => {
            const uri = vscode.Uri.file("/repo/src/app.ts");

            assert.strictEqual(resolveFilePath(uri), uri.fsPath);
        });

        test("should read the path out of a git uri query", () => {
            // The original side of a diff. Without this the command no-ops whenever the left pane has focus.
            const uri = vscode.Uri.parse("git:/repo/src/app.ts").with({ query: JSON.stringify({ path: "/repo/src/app.ts", ref: "HEAD" }) });

            assert.strictEqual(resolveFilePath(uri), "/repo/src/app.ts");
        });

        test("should give up on a git uri whose query is not json", () => {
            assert.strictEqual(resolveFilePath(vscode.Uri.parse("git:/repo/src/app.ts").with({ query: "not json" })), undefined);
        });

        test("should give up on a git uri whose query carries no path", () => {
            const uri = vscode.Uri.parse("git:/repo/src/app.ts").with({ query: JSON.stringify({ ref: "HEAD" }) });

            assert.strictEqual(resolveFilePath(uri), undefined);
        });

        test("should give up on any other scheme", () => {
            assert.strictEqual(resolveFilePath(vscode.Uri.parse("untitled:Untitled-1")), undefined);
        });
    });

    suite("collectResourceUris", () => {
        const state = (fsPath: string): vscode.SourceControlResourceState => ({ resourceUri: vscode.Uri.file(fsPath) });

        function paths(...args: unknown[]): string[] {
            return collectResourceUris(args).map(uri => uri.fsPath);
        }

        test("should read a bare resource state", () => {
            assert.deepStrictEqual(paths(state("/repo/a.ts")), [vscode.Uri.file("/repo/a.ts").fsPath]);
        });

        test("should read a resource group", () => {
            const group = { resourceStates: [state("/repo/a.ts"), state("/repo/b.ts")] };

            assert.deepStrictEqual(paths(group), [vscode.Uri.file("/repo/a.ts").fsPath, vscode.Uri.file("/repo/b.ts").fsPath]);
        });

        test("should read a bare uri", () => {
            assert.deepStrictEqual(paths(vscode.Uri.file("/repo/a.ts")), [vscode.Uri.file("/repo/a.ts").fsPath]);
        });

        test("should walk into the array a multi-selection arrives in", () => {
            // The clicked resource first, then the whole selection as one argument.
            const selection = [state("/repo/a.ts"), state("/repo/b.ts")];

            assert.deepStrictEqual(paths(selection[0], selection), [
                vscode.Uri.file("/repo/a.ts").fsPath,
                vscode.Uri.file("/repo/a.ts").fsPath,
                vscode.Uri.file("/repo/b.ts").fsPath,
            ]);
        });

        test("should skip arguments that carry no resource", () => {
            assert.deepStrictEqual(paths(null, undefined, 42, "a string", true, state("/repo/a.ts")), [vscode.Uri.file("/repo/a.ts").fsPath]);
        });

        test("should pass duplicates through", () => {
            // Deduplication belongs to the caller that builds the selection, and it relies on seeing them.
            assert.deepStrictEqual(paths(state("/repo/a.ts"), state("/repo/a.ts")), [
                vscode.Uri.file("/repo/a.ts").fsPath,
                vscode.Uri.file("/repo/a.ts").fsPath,
            ]);
        });
    });
});

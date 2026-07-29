import * as assert from "assert";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { findAutoStageableFiles, findWhitespaceOnlyChanges } from "../../../features/git/autoStage";

function git(cwd: string, args: string[]): void {
    cp.execFileSync("git", args, { cwd, stdio: "pipe" });
}

function write(repo: string, relativePath: string, content: string): void {
    const target = path.join(repo, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
}

suite("AutoStage Tests", () => {
    let repo: string;

    setup(() => {
        repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vscode-ws-stage-")));

        git(repo, ["init", "-q", "."]);
        git(repo, ["config", "user.email", "test@example.com"]);
        git(repo, ["config", "user.name", "Test"]);
        // Keep the fixtures byte-exact so trailing-whitespace cases are not rewritten on checkout.
        git(repo, ["config", "core.autocrlf", "false"]);
    });

    teardown(() => {
        try {
            fs.rmSync(repo, { recursive: true, force: true });
        } catch {
            // Windows can hold locks on the git directory; leaving the temp folder behind is harmless.
        }
    });

    function commitAll(): void {
        git(repo, ["add", "-A"]);
        git(repo, ["commit", "-qm", "baseline"]);
    }

    test("detects re-indentation and spacing changes", async () => {
        write(repo, "formatted.ts", "function foo( x ) {\n  return x;\n}\n");
        commitAll();

        write(repo, "formatted.ts", "function foo(x) {\n    return  x;\n}\n");

        assert.deepStrictEqual(await findWhitespaceOnlyChanges(repo), ["formatted.ts"]);
    });

    test("detects added and removed blank lines", async () => {
        write(repo, "blanks.ts", "const a = 1;\n\n\nconst b = 2;\n");
        commitAll();

        write(repo, "blanks.ts", "const a = 1;\nconst b = 2;\n\n");

        assert.deepStrictEqual(await findWhitespaceOnlyChanges(repo), ["blanks.ts"]);
    });

    test("ignores files with real content changes", async () => {
        write(repo, "real.ts", "const a = 1;\n");
        commitAll();

        write(repo, "real.ts", "const  a  =  2;\n");

        assert.deepStrictEqual(await findWhitespaceOnlyChanges(repo), []);
    });

    test("ignores untracked, added and deleted files", async () => {
        write(repo, "kept.ts", "const kept = 1;\n");
        write(repo, "removed.ts", "const removed = 1;\n");
        write(repo, "blank-only.ts", "\n\n\n");
        commitAll();

        write(repo, "untracked.ts", "const untracked = 1;\n");
        fs.unlinkSync(path.join(repo, "removed.ts"));
        fs.unlinkSync(path.join(repo, "blank-only.ts"));

        assert.deepStrictEqual(await findWhitespaceOnlyChanges(repo), []);
    });

    test("ignores unchanged files", async () => {
        write(repo, "stable.ts", "const a = 1;\n");
        commitAll();

        assert.deepStrictEqual(await findWhitespaceOnlyChanges(repo), []);
    });

    test("returns forward-slash paths for files in subdirectories and with spaces in the name", async () => {
        write(repo, "src/nested/my file.ts", "const a = 1;\n");
        commitAll();

        write(repo, "src/nested/my file.ts", "const a  =  1;\n");

        assert.deepStrictEqual(await findWhitespaceOnlyChanges(repo), ["src/nested/my file.ts"]);
    });

    test("reports only the whitespace-only files in a mixed working tree", async () => {
        write(repo, "whitespace.ts", "const a = 1;\n");
        write(repo, "content.ts", "const b = 1;\n");
        write(repo, "untouched.ts", "const c = 1;\n");
        commitAll();

        write(repo, "whitespace.ts", "const a = 1;   \n");
        write(repo, "content.ts", "const b = 42;\n");

        assert.deepStrictEqual(await findWhitespaceOnlyChanges(repo), ["whitespace.ts"]);
    });

    test("still detects a file whose staged changes are already partially staged", async () => {
        write(repo, "partial.ts", "const a = 1;\nconst b = 2;\n");
        commitAll();

        write(repo, "partial.ts", "const a = 99;\nconst b = 2;\n");
        git(repo, ["add", "partial.ts"]);
        // Only the unstaged remainder is whitespace, which is exactly what the Changes group shows.
        write(repo, "partial.ts", "const a = 99;\nconst b  =  2;\n");

        assert.deepStrictEqual(await findWhitespaceOnlyChanges(repo), ["partial.ts"]);
    });

    test("collects the files every classification rule accepts", async () => {
        write(repo, "whitespace.ts", "const a = 1;\n");
        write(repo, "content.ts", "const b = 1;\n");
        commitAll();

        write(repo, "whitespace.ts", "const a = 1;   \n");
        write(repo, "content.ts", "const b = 42;\n");

        assert.deepStrictEqual(await findAutoStageableFiles(repo), ["whitespace.ts"]);
    });
});

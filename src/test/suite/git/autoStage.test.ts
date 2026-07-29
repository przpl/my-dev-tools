import * as assert from "assert";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { findAutoStageableFiles, findFormattingOnlyChanges, findWhitespaceOnlyChanges } from "../../../features/git/autoStage";

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
        write(repo, "wrapped.ts", "const c = veryLongFunctionName(firstArgument, secondArgument);\n");
        write(repo, "content.ts", "const b = 1;\n");
        commitAll();

        write(repo, "whitespace.ts", "const a = 1;   \n");
        write(repo, "wrapped.ts", "const c = veryLongFunctionName(\n    firstArgument,\n    secondArgument,\n);\n");
        write(repo, "content.ts", "const b = 42;\n");

        assert.deepStrictEqual(await findAutoStageableFiles(repo), ["whitespace.ts", "wrapped.ts"]);
    });

    suite("re-wrapped lines", () => {
        const SINGLE_LINE_JSX =
            "export function Page() {\n    return <PayloadLivePreview refresh={router.refresh} serverURL={getClientSideURL()} />;\n}\n";
        const WRAPPED_JSX =
            "export function Page() {\n" +
            "    return (\n" +
            "        <PayloadLivePreview\n" +
            "            refresh={router.refresh}\n" +
            "            serverURL={getClientSideURL()}\n" +
            "        />\n" +
            "    );\n" +
            "}\n";

        test("git's whitespace-insensitive diff cannot see through a re-wrap", async () => {
            write(repo, "page.tsx", SINGLE_LINE_JSX);
            commitAll();

            write(repo, "page.tsx", WRAPPED_JSX);

            // This is the bug the token comparison exists to cover.
            assert.deepStrictEqual(await findWhitespaceOnlyChanges(repo), []);
        });

        test("detects a re-wrap that only adds the parentheses a formatter needs", async () => {
            write(repo, "page.tsx", SINGLE_LINE_JSX);
            commitAll();

            write(repo, "page.tsx", WRAPPED_JSX);

            assert.deepStrictEqual(await findFormattingOnlyChanges(repo), ["page.tsx"]);
        });

        test("ignores a re-wrap that also changes the code", async () => {
            write(repo, "page.tsx", SINGLE_LINE_JSX);
            commitAll();

            write(repo, "page.tsx", WRAPPED_JSX.replace("refresh={router.refresh}", "refresh={() => {\n router.refresh();\n }}"));

            assert.deepStrictEqual(await findFormattingOnlyChanges(repo), []);
        });

        test("detects joining several lines back into one", async () => {
            write(repo, "join.ts", "const value = compute(\n    first,\n    second,\n);\n");
            commitAll();

            write(repo, "join.ts", "const value = compute(first, second);\n");

            assert.deepStrictEqual(await findFormattingOnlyChanges(repo), ["join.ts"]);
        });

        test("detects the trailing comma a formatter adds when it wraps an object literal", async () => {
            write(repo, "options.ts", "const options = { retries: 3, timeout: 1000 };\n");
            commitAll();

            write(repo, "options.ts", "const options = {\n    retries: 3,\n    timeout: 1000,\n};\n");

            assert.deepStrictEqual(await findFormattingOnlyChanges(repo), ["options.ts"]);
        });

        test("ignores an added array elision", async () => {
            write(repo, "sparse.ts", "const items = [first, second];\n");
            commitAll();

            write(repo, "sparse.ts", "const items = [\n    first,\n    second,\n    ,\n];\n");

            assert.deepStrictEqual(await findFormattingOnlyChanges(repo), []);
        });

        test("ignores a comma that becomes a sequence expression", async () => {
            write(repo, "sequence.ts", "handler(first, second);\n");
            commitAll();

            write(repo, "sequence.ts", "handler(first), second;\n");

            assert.deepStrictEqual(await findFormattingOnlyChanges(repo), []);
        });

        test("detects re-indented JSX children", async () => {
            write(repo, "children.tsx", "const a = (\n    <div>\n        Hello world\n    </div>\n);\n");
            commitAll();

            write(repo, "children.tsx", "const a = <div>Hello world</div>;\n");

            assert.deepStrictEqual(await findFormattingOnlyChanges(repo), ["children.tsx"]);
        });

        test("ignores parentheses that change how an expression associates", async () => {
            write(repo, "math.ts", "const total = (a + b) * c;\n");
            commitAll();

            write(repo, "math.ts", "const total = a + b * c;\n");

            assert.deepStrictEqual(await findFormattingOnlyChanges(repo), []);
        });

        test("ignores a deleted comment", async () => {
            write(repo, "commented.ts", "// explains the constant\nconst a = 1;\n");
            commitAll();

            write(repo, "commented.ts", "const a = 1;\n");

            assert.deepStrictEqual(await findFormattingOnlyChanges(repo), []);
        });

        test("ignores a changed declaration keyword", async () => {
            write(repo, "keyword.ts", "let a = 1;\n");
            commitAll();

            write(repo, "keyword.ts", "const a = 1;\n");

            assert.deepStrictEqual(await findFormattingOnlyChanges(repo), []);
        });

        test("ignores re-indentation inside a template literal", async () => {
            write(repo, "template.ts", "const query = `\n    SELECT 1\n`;\n");
            commitAll();

            write(repo, "template.ts", "const query = `\n        SELECT 1\n`;\n");

            assert.deepStrictEqual(await findFormattingOnlyChanges(repo), []);
        });

        test("ignores a file that no longer parses", async () => {
            write(repo, "broken.ts", "const a = 1;\n");
            commitAll();

            write(repo, "broken.ts", "const a = (;\n");

            assert.deepStrictEqual(await findFormattingOnlyChanges(repo), []);
        });

        test("ignores re-wrapped files it cannot parse", async () => {
            write(repo, "notes.md", "one two three\n");
            commitAll();

            write(repo, "notes.md", "one\ntwo\nthree\n");

            assert.deepStrictEqual(await findFormattingOnlyChanges(repo), []);
        });
    });
});

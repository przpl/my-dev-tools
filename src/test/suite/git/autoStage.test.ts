import * as assert from "assert";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { findAutoStageableFiles } from "../../../features/git/autoStage";

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

    /** Commits `before`, writes `after` over it and returns the files auto stage would pick up. */
    async function classify(file: string, before: string, after: string): Promise<string[]> {
        write(repo, file, before);
        commitAll();
        write(repo, file, after);

        return findAutoStageableFiles(repo);
    }

    async function assertDetected(file: string, before: string, after: string): Promise<void> {
        assert.deepStrictEqual(await classify(file, before, after), [file]);
    }

    async function assertIgnored(file: string, before: string, after: string): Promise<void> {
        assert.deepStrictEqual(await classify(file, before, after), []);
    }

    suite("layout", () => {
        test("detects re-indentation and spacing changes", async () => {
            await assertDetected("formatted.ts", "function foo( x ) {\n  return x;\n}\n", "function foo(x) {\n    return  x;\n}\n");
        });

        test("detects added and removed blank lines", async () => {
            await assertDetected("blanks.ts", "const a = 1;\n\n\nconst b = 2;\n", "const a = 1;\nconst b = 2;\n\n");
        });

        test("detects trailing whitespace being stripped", async () => {
            await assertDetected("trailing.ts", "const a = 1;   \nconst b = 2;\t\n", "const a = 1;\nconst b = 2;\n");
        });

        test("detects a missing newline at end of file being added", async () => {
            await assertDetected("eof.ts", "const a = 1;", "const a = 1;\n");
        });

        test("ignores files with real content changes", async () => {
            await assertIgnored("real.ts", "const a = 1;\n", "const  a  =  2;\n");
        });

        test("ignores unchanged files", async () => {
            write(repo, "stable.ts", "const a = 1;\n");
            commitAll();

            assert.deepStrictEqual(await findAutoStageableFiles(repo), []);
        });

        test("ignores untracked, added and deleted files", async () => {
            write(repo, "kept.ts", "const kept = 1;\n");
            write(repo, "removed.ts", "const removed = 1;\n");
            write(repo, "blank-only.ts", "\n\n\n");
            commitAll();

            write(repo, "untracked.ts", "const untracked = 1;\n");
            fs.unlinkSync(path.join(repo, "removed.ts"));
            fs.unlinkSync(path.join(repo, "blank-only.ts"));

            assert.deepStrictEqual(await findAutoStageableFiles(repo), []);
        });

        test("ignores a file with an unresolved merge conflict, which staging would mark resolved", async function () {
            // Three commits, two branch switches and a merge do not fit in the default timeout.
            this.timeout(20000);

            write(repo, "conflict.ts", "const a = 1;\n");
            write(repo, "cosmetic.ts", "const b = 1;\n");
            commitAll();

            git(repo, ["checkout", "-qb", "other"]);
            write(repo, "conflict.ts", "const a = 2;\n");
            commitAll();

            git(repo, ["checkout", "-q", "-"]);
            write(repo, "conflict.ts", "const a = 3;\n");
            commitAll();

            try {
                git(repo, ["merge", "other"]);
                assert.fail("the merge was expected to conflict");
            } catch (error) {
                assert.ok(!(error instanceof assert.AssertionError), "the merge was expected to conflict");
            }

            // The conflicted file is reported as modified as well as unmerged; the rest of the sweep still runs.
            write(repo, "cosmetic.ts", "const b   =   1;\n");

            assert.deepStrictEqual(await findAutoStageableFiles(repo), ["cosmetic.ts"]);
        });

        test("returns forward-slash paths for files in subdirectories and with spaces in the name", async () => {
            await assertDetected("src/nested/my file.ts", "const a = 1;\n", "const a  =  1;\n");
        });

        test("reports only the cosmetic files in a mixed working tree", async () => {
            write(repo, "whitespace.ts", "const a = 1;\n");
            write(repo, "wrapped.ts", "const c = veryLongFunctionName(firstArgument, secondArgument);\n");
            write(repo, "content.ts", "const b = 1;\n");
            write(repo, "untouched.ts", "const d = 1;\n");
            commitAll();

            write(repo, "whitespace.ts", "const a = 1;   \n");
            write(repo, "wrapped.ts", "const c = veryLongFunctionName(\n    firstArgument,\n    secondArgument,\n);\n");
            write(repo, "content.ts", "const b = 42;\n");

            assert.deepStrictEqual(await findAutoStageableFiles(repo), ["whitespace.ts", "wrapped.ts"]);
        });

        test("still detects a file whose changes are already partially staged", async () => {
            write(repo, "partial.ts", "const a = 1;\nconst b = 2;\n");
            commitAll();

            write(repo, "partial.ts", "const a = 99;\nconst b = 2;\n");
            git(repo, ["add", "partial.ts"]);
            // Only the unstaged remainder is whitespace, which is exactly what the Changes group shows.
            write(repo, "partial.ts", "const a = 99;\nconst b  =  2;\n");

            assert.deepStrictEqual(await findAutoStageableFiles(repo), ["partial.ts"]);
        });
    });

    suite("whitespace that is content", () => {
        test("ignores a space removed from inside a string", async () => {
            // `git diff --ignore-all-space` reports this file as unchanged; it is a different program.
            await assertIgnored("greeting.ts", 'const greeting = "hello world";\n', 'const greeting = "helloworld";\n');
        });

        test("ignores re-indentation inside a template literal", async () => {
            await assertIgnored("template.ts", "const query = `\n    SELECT 1\n`;\n", "const query = `\n        SELECT 1\n`;\n");
        });

        test("ignores a de-indented YAML key", async () => {
            await assertIgnored("config.yaml", "key:\n  nested: 1\n", "key:\nnested: 1\n");
        });

        test("ignores a stripped Markdown hard line break", async () => {
            await assertIgnored("notes.md", "line one  \nline two\n", "line one\nline two\n");
        });

        test("ignores a re-wrapped Markdown paragraph", async () => {
            await assertIgnored("notes.md", "one two three\n", "one\ntwo\nthree\n");
        });
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

        test("detects a re-wrap that only adds the parentheses a formatter needs", async () => {
            await assertDetected("page.tsx", SINGLE_LINE_JSX, WRAPPED_JSX);
        });

        test("ignores a re-wrap that also changes the code", async () => {
            const withHandler = WRAPPED_JSX.replace("refresh={router.refresh}", "refresh={() => {\n router.refresh();\n }}");

            await assertIgnored("page.tsx", SINGLE_LINE_JSX, withHandler);
        });

        test("detects joining several lines back into one", async () => {
            await assertDetected(
                "join.ts",
                "const value = compute(\n    first,\n    second,\n);\n",
                "const value = compute(first, second);\n",
            );
        });

        test("detects the trailing comma a formatter adds when it wraps an object literal", async () => {
            await assertDetected(
                "options.ts",
                "const options = { retries: 3, timeout: 1000 };\n",
                "const options = {\n    retries: 3,\n    timeout: 1000,\n};\n",
            );
        });

        test("detects re-indented JSX children", async () => {
            await assertDetected(
                "children.tsx",
                "const a = (\n    <div>\n        Hello world\n    </div>\n);\n",
                "const a = <div>Hello world</div>;\n",
            );
        });

        test("ignores an added array elision", async () => {
            await assertIgnored("sparse.ts", "const items = [first, second];\n", "const items = [\n    first,\n    second,\n    ,\n];\n");
        });

        test("ignores a comma that becomes a sequence expression", async () => {
            await assertIgnored("sequence.ts", "handler(first, second);\n", "handler(first), second;\n");
        });

        test("ignores parentheses that change how an expression associates", async () => {
            await assertIgnored("math.ts", "const total = (a + b) * c;\n", "const total = a + b * c;\n");
        });
    });

    suite("punctuation a formatter chooses", () => {
        test("detects semicolons being added", async () => {
            await assertDetected("semi.ts", "const a = 1\nconst b = 2\n", "const a = 1;\nconst b = 2;\n");
        });

        test("detects semicolons being removed", async () => {
            await assertDetected("no-semi.ts", "const a = 1;\nfoo();\n", "const a = 1\nfoo()\n");
        });

        test("ignores an added empty statement", async () => {
            await assertIgnored("empty.ts", "const a = 1;\n", "const a = 1;;\n");
        });

        test("detects arrow parameter parentheses being added", async () => {
            await assertDetected("arrow.ts", "const f = x => x + 1;\n", "const f = (x) => x + 1;\n");
        });
    });

    suite("literals", () => {
        test("detects a change of quote style", async () => {
            await assertDetected("quotes.ts", "const a = 'value';\n", 'const a = "value";\n');
        });

        test("detects re-quoting that drops an escape", async () => {
            await assertDetected("apostrophe.ts", "const a = 'it\\'s';\n", 'const a = "it\'s";\n');
        });

        test("ignores a rewritten escape sequence", async () => {
            await assertIgnored("escape.ts", 'const a = "\\u0041";\n', 'const a = "A";\n');
        });

        test("detects a change of quote style on a JSX attribute", async () => {
            await assertDetected("attribute.tsx", "const a = <div title='x' />;\n", 'const a = <div title="x" />;\n');
        });

        test("ignores a backslash dropped from a JSX attribute, where it is not an escape", async () => {
            await assertIgnored("escaped-attribute.tsx", "const a = <div title=\"it\\'s\" />;\n", "const a = <div title=\"it's\" />;\n");
        });

        test("ignores a changed string", async () => {
            await assertIgnored("text.ts", "const a = 'left';\n", 'const a = "right";\n');
        });

        test("detects numeric separators and hex case being normalized", async () => {
            await assertDetected("numbers.ts", "const a = 1_000;\nconst b = 0XFF;\n", "const a = 1000;\nconst b = 0xff;\n");
        });

        test("ignores a changed number", async () => {
            await assertIgnored("value.ts", "const a = 1000;\n", "const a = 1001;\n");
        });

        test("ignores a legacy octal literal being read as decimal", async () => {
            await assertIgnored("octal.js", "const a = 010;\n", "const a = 10;\n");
        });

        test("ignores a deleted comment", async () => {
            await assertIgnored("commented.ts", "// explains the constant\nconst a = 1;\n", "const a = 1;\n");
        });

        test("ignores a changed declaration keyword", async () => {
            await assertIgnored("keyword.ts", "let a = 1;\n", "const a = 1;\n");
        });

        test("ignores a file that no longer parses", async () => {
            await assertIgnored("broken.ts", "const a = 1;\n", "const a = (;\n");
        });
    });

    suite("imports and exports", () => {
        test("detects names being sorted inside import braces", async () => {
            await assertDetected(
                "sorted.ts",
                "import { useState, useEffect } from 'react';\n",
                "import { useEffect, useState } from 'react';\n",
            );
        });

        test("detects names being sorted inside export braces", async () => {
            await assertDetected("exports.ts", "export { beta, alpha };\n", "export { alpha, beta };\n");
        });

        test("detects import braces being re-wrapped and sorted at once", async () => {
            await assertDetected(
                "wrapped-import.ts",
                "import { zebra, alpha, mango } from './letters';\n",
                "import {\n    alpha,\n    mango,\n    zebra,\n} from './letters';\n",
            );
        });

        test("ignores a removed named import", async () => {
            await assertIgnored(
                "removed-import.ts",
                "import { useEffect, useState } from 'react';\n",
                "import { useState } from 'react';\n",
            );
        });

        test("ignores a renamed import binding", async () => {
            await assertIgnored(
                "renamed.ts",
                "import { useState } from 'react';\n",
                "import { useState as useLocalState } from 'react';\n",
            );
        });

        test("ignores reordered import declarations, whose evaluation order is observable", async () => {
            await assertIgnored(
                "reordered.ts",
                "import './polyfill';\nimport { config } from './config';\n",
                "import { config } from './config';\nimport './polyfill';\n",
            );
        });

        test("ignores a rewritten module specifier", async () => {
            await assertIgnored("specifier.ts", "import { a } from '../shared/a';\n", "import { a } from '@/shared/a';\n");
        });

        test("ignores a default import becoming a namespace import", async () => {
            await assertIgnored("namespace.ts", "import react from 'react';\n", "import * as react from 'react';\n");
        });
    });

    suite("JSON", () => {
        test("detects a re-indented document", async () => {
            await assertDetected(
                "data.json",
                '{\n  "a": 1,\n  "b": [2, 3]\n}\n',
                '{\n    "a": 1,\n    "b": [\n        2,\n        3\n    ]\n}\n',
            );
        });

        test("detects a document collapsed onto one line", async () => {
            await assertDetected("compact.json", '{\n    "a": 1\n}\n', '{ "a": 1 }\n');
        });

        test("ignores reordered keys", async () => {
            await assertIgnored("order.json", '{ "a": 1, "b": 2 }\n', '{ "b": 2, "a": 1 }\n');
        });

        test("ignores a changed value", async () => {
            await assertIgnored("value.json", '{ "a": 1 }\n', '{ "a": 2 }\n');
        });

        test("ignores a number respelled to the same double", async () => {
            await assertIgnored("number.json", '{ "a": 1.0 }\n', '{ "a": 1 }\n');
        });

        test("detects a re-indented document that carries comments", async () => {
            await assertDetected("tsconfig.json", '{\n  // a note\n  "a": 1\n}\n', '{\n    // a note\n    "a": 1\n}\n');
        });

        test("detects a re-indented block comment", async () => {
            await assertDetected("commented.jsonc", '{\n  /* a\n     note */\n  "a": 1\n}\n', '{\n  /* a note */\n  "a": 1\n}\n');
        });

        test("ignores a deleted comment", async () => {
            await assertIgnored("notes.json", '{\n  // a note\n  "a": 1\n}\n', '{\n  "a": 1\n}\n');
        });

        test("ignores a rewritten escape sequence", async () => {
            await assertIgnored("escape.json", '{ "a": "\\u0041" }\n', '{ "a": "A" }\n');
        });

        test("ignores text that is not JSON at all", async () => {
            await assertIgnored("broken.json", '{ "a": 1 }\n', "{ a: nope }\n");
        });

        test("ignores lock files", async () => {
            await assertIgnored("package-lock.json", '{\n  "a": 1\n}\n', '{ "a": 1 }\n');
        });
    });

    suite("stylesheets", () => {
        test("detects a rule being expanded over several lines", async () => {
            await assertDetected("main.css", ".a { color: red; }\n", ".a {\n    color: red;\n}\n");
        });

        test("detects a rule being collapsed onto one line", async () => {
            await assertDetected("compact.scss", ".a {\n    color: red;\n}\n", ".a { color: red; }\n");
        });

        test("detects a re-indented block comment", async () => {
            await assertDetected("commented.css", "/* a\n   note */\n.a { color: red; }\n", "/* a note */\n.a { color: red; }\n");
        });

        test("keeps the descendant combinator, which is whitespace with meaning", async () => {
            await assertIgnored("selector.css", ".a b { color: red; }\n", ".ab { color: red; }\n");
        });

        test("ignores a space removed from inside a string", async () => {
            await assertIgnored("content.css", '.a::after { content: "x  y"; }\n', '.a::after { content: "x y"; }\n');
        });

        test("ignores a changed declaration", async () => {
            await assertIgnored("changed.css", ".a { color: red; }\n", ".a { color: blue; }\n");
        });

        test("ignores a deleted line comment", async () => {
            await assertIgnored("notes.scss", "// a note\n.a { color: red; }\n", ".a { color: red; }\n");
        });

        test("keeps a url payload that contains a comment marker", async () => {
            await assertDetected(
                "url.css",
                ".a { background: url(//cdn.example.com/a.png); }\n",
                ".a {\n    background: url(//cdn.example.com/a.png);\n}\n",
            );
        });
    });
});

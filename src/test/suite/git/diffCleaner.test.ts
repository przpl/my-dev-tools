import * as assert from "assert";

import { cleanDiff, parseDiff, renderDiff } from "../../../features/git/diffCleaner";

const GENEROUS = { maxCharacters: 100000, stripImportsAboveLines: 100000 };

function clean(raw: string, overrides: Partial<typeof GENEROUS> & { formattingOnlyPaths?: Set<string> } = {}): string {
    return cleanDiff(raw, { ...GENEROUS, ...overrides });
}

suite("DiffCleaner Tests", () => {
    suite("structural noise", () => {
        test("should drop index lines and collapse the file header to one line", () => {
            const raw = [
                "diff --git a/src/app.ts b/src/app.ts",
                "index 1234567..89abcde 100644",
                "--- a/src/app.ts",
                "+++ b/src/app.ts",
                "@@ -1,3 +1,3 @@",
                " const a = 1;",
                "-const b = 2;",
                "+const b = 3;",
            ].join("\n");

            assert.strictEqual(clean(raw), ["--- src/app.ts", "@@", " const a = 1;", "-const b = 2;", "+const b = 3;"].join("\n"));
        });

        test("should keep the enclosing declaration from the hunk header and drop the line numbers", () => {
            const raw = [
                "diff --git a/src/app.ts b/src/app.ts",
                "index 1234567..89abcde 100644",
                "--- a/src/app.ts",
                "+++ b/src/app.ts",
                "@@ -140,7 +140,9 @@ export function quickCommit() {",
                "-    old();",
                "+    fresh();",
            ].join("\n");

            assert.ok(clean(raw).includes("@@ export function quickCommit() {"));
            assert.ok(!clean(raw).includes("-140,7"));
        });

        test("should drop the no-newline marker", () => {
            const raw = [
                "diff --git a/a.txt b/a.txt",
                "index 111..222 100644",
                "--- a/a.txt",
                "+++ b/a.txt",
                "@@ -1 +1 @@",
                "-one",
                "\\ No newline at end of file",
                "+two",
            ].join("\n");

            assert.ok(!clean(raw).includes("No newline"));
        });

        test("should mark an added file", () => {
            const raw = [
                "diff --git a/src/new.ts b/src/new.ts",
                "new file mode 100644",
                "index 0000000..abc1234",
                "--- /dev/null",
                "+++ b/src/new.ts",
                "@@ -0,0 +1,2 @@",
                "+const a = 1;",
                "+const b = 2;",
            ].join("\n");

            assert.ok(clean(raw).startsWith("+++ NEW src/new.ts"));
        });

        test("should mark a deleted file", () => {
            const raw = [
                "diff --git a/src/old.ts b/src/old.ts",
                "deleted file mode 100644",
                "index abc1234..0000000",
                "--- a/src/old.ts",
                "+++ /dev/null",
                "@@ -1,2 +0,0 @@",
                "-const a = 1;",
                "-const b = 2;",
            ].join("\n");

            assert.ok(clean(raw).startsWith("--- DELETED src/old.ts"));
        });

        test("should collapse a rename to one header", () => {
            const raw = [
                "diff --git a/src/old.ts b/src/new.ts",
                "similarity index 94%",
                "rename from src/old.ts",
                "rename to src/new.ts",
                "index abc1234..def5678 100644",
                "--- a/src/old.ts",
                "+++ b/src/new.ts",
                "@@ -1,2 +1,2 @@",
                "-const a = 1;",
                "+const a = 2;",
            ].join("\n");

            const cleaned = clean(raw);
            assert.ok(cleaned.startsWith("RENAMED src/old.ts -> src/new.ts"));
            assert.ok(!cleaned.includes("similarity index"));
        });

        test("should collapse a binary change to a note", () => {
            const raw = [
                "diff --git a/images/icon.png b/images/icon.png",
                "index abc1234..def5678 100644",
                "Binary files a/images/icon.png and b/images/icon.png differ",
            ].join("\n");

            assert.strictEqual(clean(raw), "--- images/icon.png\n(binary)");
        });

        test("should keep files separated by a blank line", () => {
            const raw = [
                "diff --git a/a.ts b/a.ts",
                "index 1..2 100644",
                "--- a/a.ts",
                "+++ b/a.ts",
                "@@ -1 +1 @@",
                "-a",
                "+b",
                "diff --git a/b.ts b/b.ts",
                "index 3..4 100644",
                "--- a/b.ts",
                "+++ b/b.ts",
                "@@ -1 +1 @@",
                "-c",
                "+d",
            ].join("\n");

            assert.strictEqual(clean(raw), ["--- a.ts", "@@", "-a", "+b", "", "--- b.ts", "@@", "-c", "+d"].join("\n"));
        });
    });

    suite("formatting-only files", () => {
        const raw = [
            "diff --git a/src/styled.ts b/src/styled.ts",
            "index 1234567..89abcde 100644",
            "--- a/src/styled.ts",
            "+++ b/src/styled.ts",
            "@@ -1,3 +1,4 @@",
            "-const a = {x: 1};",
            "+const a = {",
            "+    x: 1,",
            "+};",
            "diff --git a/src/real.ts b/src/real.ts",
            "index 1234567..89abcde 100644",
            "--- a/src/real.ts",
            "+++ b/src/real.ts",
            "@@ -1 +1 @@",
            "-const limit = 5;",
            "+const limit = 50;",
        ].join("\n");

        test("should replace the body of a reformatted file with a note", () => {
            const cleaned = clean(raw, { formattingOnlyPaths: new Set(["src/styled.ts"]) });

            assert.ok(cleaned.includes("--- src/styled.ts\n(formatting only)"));
            assert.ok(!cleaned.includes("x: 1,"));
        });

        test("should leave the real change untouched", () => {
            const cleaned = clean(raw, { formattingOnlyPaths: new Set(["src/styled.ts"]) });

            assert.ok(cleaned.includes("+const limit = 50;"));
        });
    });

    suite("import and re-export churn", () => {
        const importHunk = [
            "diff --git a/src/app.ts b/src/app.ts",
            "index 1234567..89abcde 100644",
            "--- a/src/app.ts",
            "+++ b/src/app.ts",
            "@@ -1,3 +1,3 @@",
            '-import { a } from "./a";',
            '+import { a, b } from "./a";',
            "@@ -40,3 +40,3 @@ function run() {",
            "-    return a();",
            "+    return b();",
        ].join("\n");

        test("should keep import hunks below the threshold", () => {
            assert.ok(clean(importHunk, { stripImportsAboveLines: 1000 }).includes('import { a, b } from "./a";'));
        });

        test("should drop import-only hunks above the threshold", () => {
            const cleaned = clean(importHunk, { stripImportsAboveLines: 0 });

            assert.ok(!cleaned.includes("import"));
            assert.ok(cleaned.includes("+    return b();"), "The real hunk must survive");
        });

        test("should drop a multi-line specifier list", () => {
            const raw = [
                "diff --git a/src/app.ts b/src/app.ts",
                "index 1..2 100644",
                "--- a/src/app.ts",
                "+++ b/src/app.ts",
                "@@ -1,5 +1,6 @@",
                "-import {",
                "-    alpha,",
                "-} from './lib';",
                "+import {",
                "+    alpha,",
                "+    beta,",
                "+} from './lib';",
                "@@ -30,1 +31,1 @@ function run() {",
                "-    return alpha;",
                "+    return beta;",
            ].join("\n");

            const cleaned = clean(raw, { stripImportsAboveLines: 0 });

            assert.ok(!cleaned.includes("alpha,"));
            assert.ok(cleaned.includes("+    return beta;"));
        });

        test("should keep a re-export list but never an exported declaration", () => {
            const raw = [
                "diff --git a/src/index.ts b/src/index.ts",
                "index 1..2 100644",
                "--- a/src/index.ts",
                "+++ b/src/index.ts",
                "@@ -1 +1,2 @@",
                '+export { helper } from "./helper";',
                "@@ -10 +11 @@",
                "-export const RETRY_LIMIT = 3;",
                "+export const RETRY_LIMIT = 5;",
            ].join("\n");

            const cleaned = clean(raw, { stripImportsAboveLines: 0 });

            assert.ok(!cleaned.includes("export { helper }"), "A re-export list is plumbing");
            assert.ok(cleaned.includes("+export const RETRY_LIMIT = 5;"), "An exported declaration is code");
        });

        test("should not strip imports from a file that is not a script", () => {
            const raw = [
                "diff --git a/docs/guide.md b/docs/guide.md",
                "index 1..2 100644",
                "--- a/docs/guide.md",
                "+++ b/docs/guide.md",
                "@@ -1 +1 @@",
                "-import this",
                "+import that",
            ].join("\n");

            assert.ok(clean(raw, { stripImportsAboveLines: 0 }).includes("+import that"));
        });

        test("should collapse a file left with nothing to a note", () => {
            const raw = [
                "diff --git a/src/barrel.ts b/src/barrel.ts",
                "index 1..2 100644",
                "--- a/src/barrel.ts",
                "+++ b/src/barrel.ts",
                "@@ -1 +1 @@",
                '-import { a } from "./a";',
                '+import { a } from "./b";',
                "diff --git a/src/real.ts b/src/real.ts",
                "index 3..4 100644",
                "--- a/src/real.ts",
                "+++ b/src/real.ts",
                "@@ -1 +1 @@",
                "-const limit = 5;",
                "+const limit = 50;",
            ].join("\n");

            assert.ok(clean(raw, { stripImportsAboveLines: 0 }).includes("--- src/barrel.ts\n(import/export changes only)"));
        });
    });

    suite("budget", () => {
        function bigDiff(files: number, linesPerFile: number): string {
            return Array.from({ length: files }, (_, fileIndex) =>
                [
                    `diff --git a/src/file${fileIndex}.ts b/src/file${fileIndex}.ts`,
                    "index 1234567..89abcde 100644",
                    `--- a/src/file${fileIndex}.ts`,
                    `+++ b/src/file${fileIndex}.ts`,
                    "@@ -1,10 +1,10 @@",
                    ...Array.from({ length: linesPerFile }, (_, line) => ` const context${line} = ${line};`),
                    ...Array.from({ length: linesPerFile }, (_, line) => `+const added${line} = ${line};`),
                ].join("\n")
            ).join("\n");
        }

        test("should drop context lines before truncating anything", () => {
            const cleaned = clean(bigDiff(2, 40), { maxCharacters: 3000 });

            assert.ok(!cleaned.includes(" const context0 = 0;"), "Context lines go first");
            assert.ok(cleaned.includes("+const added0 = 0;"), "Changed lines survive");
            assert.ok(!cleaned.includes("more changed lines omitted"), "Dropping context was enough");
        });

        test("should truncate per file and say how much was omitted", () => {
            const cleaned = clean(bigDiff(4, 60), { maxCharacters: 1500 });

            assert.ok(cleaned.length <= 2000, `Expected the result to be near the budget, got ${cleaned.length}`);
            assert.ok(/@@ \.\.\. \d+ more changed lines omitted/.test(cleaned), cleaned.slice(-300));
        });

        test("should still name every file when truncating", () => {
            const cleaned = clean(bigDiff(4, 60), { maxCharacters: 1500 });

            for (let i = 0; i < 4; i++) {
                assert.ok(cleaned.includes(`--- src/file${i}.ts`), `file${i} should still be listed`);
            }
        });
    });

    suite("fallback", () => {
        const raw = [
            "diff --git a/src/styled.ts b/src/styled.ts",
            "index 1234567..89abcde 100644",
            "--- a/src/styled.ts",
            "+++ b/src/styled.ts",
            "@@ -1,2 +1,3 @@",
            "-const a = {x: 1};",
            "+const a = {",
            "+    x: 1,",
            "+};",
        ].join("\n");

        test("should send the original diff when cleaning removed the whole change", () => {
            const cleaned = clean(raw, { formattingOnlyPaths: new Set(["src/styled.ts"]) });

            assert.ok(cleaned.includes("+    x: 1,"), "The only evidence of the change must survive");
            assert.ok(!cleaned.includes("(formatting only)"));
            assert.ok(!cleaned.includes("index 1234567"), "Metadata is still dropped");
        });

        test("should return an empty string for an empty diff", () => {
            assert.strictEqual(clean("   \n  "), "");
        });
    });

    suite("parseDiff", () => {
        test("should round-trip a path containing spaces", () => {
            const raw = [
                "diff --git a/a file with spaces.ts b/a file with spaces.ts",
                "index 1..2 100644",
                "--- a/a file with spaces.ts",
                "+++ b/a file with spaces.ts",
                "@@ -1 +1 @@",
                "-a",
                "+b",
            ].join("\n");

            assert.deepStrictEqual(
                parseDiff(raw).map(file => file.path),
                ["a file with spaces.ts"]
            );
        });

        test("should treat a bare empty line inside a hunk as a context line", () => {
            const raw = ["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -1,3 +1,3 @@", " const a = 1;", "", "-b", "+c"].join("\n");

            assert.strictEqual(parseDiff(raw)[0].hunks[0].lines.length, 4);
        });

        test("should render what it parsed", () => {
            const files = parseDiff(["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -1 +1 @@", "-a", "+b"].join("\n"));

            assert.strictEqual(renderDiff(files), "--- a.ts\n@@\n-a\n+b");
        });
    });
});

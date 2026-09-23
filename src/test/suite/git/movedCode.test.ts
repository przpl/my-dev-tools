import * as assert from "assert";

import { cleanDiff, parseDiff, type CleanDiffOptions } from "../../../features/git/diffCleaner";
import { detectMovedCode, findMovedBlocks } from "../../../features/git/movedCode";

/** A `-U0` diff of one file: removed lines first, then added ones, as git prints a replaced block. */
function fileDiff(path: string, removed: string[], added: string[]): string {
    return [
        `diff --git a/${path} b/${path}`,
        `--- a/${path}`,
        `+++ b/${path}`,
        "@@ -1 +1 @@",
        ...removed.map(line => `-${line}`),
        ...added.map(line => `+${line}`),
    ].join("\n");
}

function newFileDiff(path: string, added: string[]): string {
    return [`diff --git a/${path} b/${path}`, "new file mode 100644", "--- /dev/null", `+++ b/${path}`, "@@ -0,0 +1 @@", ...added.map(line => `+${line}`)].join("\n");
}

const FUNCTION = [
    "export function normalizeScope(scope: string): string {",
    "    const trimmed = scope.trim().toLowerCase();",
    "",
    "    if (trimmed.length === 0) {",
    "        return DEFAULT_SCOPE;",
    "    }",
    "",
    "    return trimmed.replace(/\\s+/g, \"-\");",
    "}",
];

function detect(...diffs: string[]) {
    return detectMovedCode(parseDiff(diffs.join("\n")));
}

suite("MovedCode Tests", () => {
    test("should report a function extracted into a new file", () => {
        const moves = detect(fileDiff("src/a.ts", FUNCTION, ["import { normalizeScope } from \"./scope\";"]), newFileDiff("src/scope.ts", FUNCTION));

        // Blank lines and the lone closing braces are not counted.
        assert.deepStrictEqual(moves, [{ from: "src/a.ts", to: "src/scope.ts", lines: 5 }]);
    });

    test("should match a block whose indentation changed", () => {
        const indented = FUNCTION.map(line => (line ? `    ${line}` : line));
        const moves = detect(fileDiff("src/a.ts", FUNCTION, []), fileDiff("src/b.ts", [], indented));

        assert.strictEqual(moves[0]?.lines, 5);
    });

    test("should ignore a move within one file", () => {
        assert.deepStrictEqual(detect(fileDiff("src/a.ts", FUNCTION, FUNCTION)), []);
    });

    test("should ignore a coincidental overlap of a line or two", () => {
        const removed = ["const result = compute(input);", "return result;"];
        const moves = detect(fileDiff("src/a.ts", removed, []), fileDiff("src/b.ts", [], removed));

        assert.deepStrictEqual(moves, []);
    });

    test("should not count import lines as moved code", () => {
        const imports = [
            "import { alpha } from \"./alpha\";",
            "import { beta } from \"./beta\";",
            "import { gamma } from \"./gamma\";",
            "import { delta } from \"./delta\";",
            "import { epsilon } from \"./epsilon\";",
            "import { zeta } from \"./zeta\";",
        ];

        assert.deepStrictEqual(detect(fileDiff("src/a.ts", imports, []), fileDiff("src/b.ts", [], imports)), []);
    });

    test("should claim each added line once when two files lose the same block", () => {
        const moves = detect(fileDiff("src/a.ts", FUNCTION, []), fileDiff("src/b.ts", FUNCTION, []), newFileDiff("src/scope.ts", FUNCTION));

        assert.strictEqual(moves.length, 1, JSON.stringify(moves));
        assert.strictEqual(moves[0].to, "src/scope.ts");
    });

    suite("collapsing", () => {
        const OPTIONS: CleanDiffOptions = {
            maxCharacters: 100000,
            stripImportsAboveLines: 100000,
            summarizeAddedScriptsAboveLines: 0,
            outlineAddedMarkdownAboveLines: 0,
            maxLineLength: 0,
        };

        function collapse(raw: string, overrides: Partial<CleanDiffOptions> = {}): string {
            return cleanDiff(raw, { ...OPTIONS, ...overrides, movedBlocks: findMovedBlocks(parseDiff(raw)) });
        }

        test("should send each half of a move as one line, braces and blank lines included", () => {
            const raw = [
                fileDiff("src/a.ts", ["const kept = 1;", ...FUNCTION], ["import { normalizeScope } from \"./scope\";"]),
                newFileDiff("src/scope.ts", FUNCTION),
            ].join("\n");

            assert.strictEqual(
                collapse(raw),
                [
                    "--- src/a.ts",
                    "@@",
                    "-const kept = 1;",
                    "-[9 lines moved to src/scope.ts]",
                    "-  export function normalizeScope(scope: string): string {",
                    "+import { normalizeScope } from \"./scope\";",
                    "",
                    "+++ NEW src/scope.ts",
                    "@@",
                    "+[9 lines moved from src/a.ts]",
                ].join("\n")
            );
        });

        test("should name each top-level declaration of a moved block, up to a few", () => {
            const functions = ["alpha", "beta", "gamma", "delta"].flatMap(name => [`export function ${name}(value: number): number {`, `    return value + ${name.length};`, "}", ""]);
            const raw = [fileDiff("src/a.ts", functions, []), newFileDiff("src/math.ts", functions)].join("\n");

            const cleaned = collapse(raw);

            const outline = ["alpha", "beta", "gamma"].map(name => `-  export function ${name}(value: number): number {`);
            assert.ok(cleaned.includes(`-[16 lines moved to src/math.ts]\n${outline.join("\n")}\n`), cleaned);
            assert.ok(!cleaned.includes("delta"), cleaned);
            assert.ok(!cleaned.includes("return value"), cleaned);
        });

        test("should keep the lines around a move that did not move", () => {
            const raw = [fileDiff("src/a.ts", FUNCTION, []), fileDiff("src/b.ts", [], ["const before = 0;", ...FUNCTION, "const after = 2;"])].join("\n");

            const cleaned = collapse(raw);

            assert.ok(cleaned.includes("--- src/b.ts\n@@\n+const before = 0;\n+[9 lines moved from src/a.ts]\n+const after = 2;"), cleaned);
        });

        test("should leave a summarized new file as its summary", () => {
            const raw = [fileDiff("src/a.ts", FUNCTION, []), newFileDiff("src/scope.ts", FUNCTION)].join("\n");

            const cleaned = collapse(raw, { summarizeAddedScriptsAboveLines: 5 });

            assert.ok(cleaned.includes("-[9 lines moved to src/scope.ts]"), cleaned);
            assert.ok(cleaned.includes("new file, declarations only"), cleaned);
            assert.ok(!cleaned.includes("moved from"), cleaned);
        });

        test("should ignore blocks found in a different diff", () => {
            const moved = [fileDiff("src/a.ts", FUNCTION, []), newFileDiff("src/scope.ts", FUNCTION)].join("\n");
            const other = [fileDiff("src/x.ts", FUNCTION, []), newFileDiff("src/y.ts", FUNCTION)].join("\n");

            const cleaned = cleanDiff(other, { ...OPTIONS, movedBlocks: findMovedBlocks(parseDiff(moved)) });

            assert.ok(!cleaned.includes("moved"), cleaned);
        });
    });
});

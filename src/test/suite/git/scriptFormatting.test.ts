import * as assert from "assert";

import { isScriptFile, isScriptFormattingOnlyChange } from "../../../features/git/scriptFormatting";

/**
 * The comparison itself, without a repository in the way. Auto Stage is the only feature that
 * mutates git state without asking, so the cases that matter here are the ones where two files
 * differ by punctuation alone and are still different programs.
 */
suite("ScriptFormatting Tests", () => {
    function assertFormattingOnly(before: string, after: string, file = "file.ts"): void {
        assert.strictEqual(isScriptFormattingOnlyChange(file, before, after), true);
    }

    function assertRealChange(before: string, after: string, file = "file.ts"): void {
        assert.strictEqual(isScriptFormattingOnlyChange(file, before, after), false);
    }

    suite("automatic semicolon insertion", () => {
        // Dropping the semicolons is what makes these look identical to the token comparison: only
        // the structural check can tell one call expression from two statements.
        test("should reject a semicolon that turns a call into two statements", () => {
            assertRealChange("const a = b\n(c)\n", "const a = b;\n(c)\n");
        });

        test("should reject a semicolon that turns an element access into two statements", () => {
            assertRealChange("const a = b\n[c]\n", "const a = b;\n[c]\n");
        });

        test("should reject a semicolon that turns a tagged template into two statements", () => {
            assertRealChange("const a = b\n`c`\n", "const a = b;\n`c`\n");
        });

        test("should accept a semicolon that ends a statement either way", () => {
            assertFormattingOnly("const a = b\nconst c = d\n", "const a = b;\nconst c = d;\n");
        });
    });

    suite("comments", () => {
        test("should reject a deleted trailing comment", () => {
            // The last comment in a file hangs off the end-of-file token, which carries nothing else.
            assertRealChange("const a = 1;\n// why a is one\n", "const a = 1;\n");
        });

        test("should accept a re-indented block comment", () => {
            assertFormattingOnly("/*\n * Note.\n */\nconst a = 1;\n", "/*\n     * Note.\n     */\nconst a = 1;\n");
        });
    });

    suite("numeric literals", () => {
        // Pinned rather than argued for: `normalizeNumericLiteral` runs both sides through `Number`,
        // so a re-spelled literal auto-stages. Changing that should be a decision, not a surprise.
        test("should accept an exponent being expanded", () => {
            assertFormattingOnly("const a = 1e3;\n", "const a = 1000;\n");
        });

        test("should accept a leading zero being added", () => {
            assertFormattingOnly("const a = .5;\n", "const a = 0.5;\n");
        });

        test("should reject a different value", () => {
            assertRealChange("const a = 1000;\n", "const a = 1001;\n");
        });
    });

    suite("isScriptFile", () => {
        test("should accept the extensions that have a parser here", () => {
            for (const file of ["a.ts", "a.tsx", "a.js", "a.jsx", "a.mjs", "a.cjs"]) {
                assert.strictEqual(isScriptFile(file), true, file);
            }
        });

        test("should reject a file it cannot parse", () => {
            assert.strictEqual(isScriptFile("readme.md"), false);
        });
    });
});

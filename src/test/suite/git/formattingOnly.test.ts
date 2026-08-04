import * as assert from "assert";

import { isFormattingOnlyChange, isSupportedFile } from "../../../features/git/formattingOnly";

/**
 * The routing layer. Its job is a safety property rather than a comparison: a format with no scanner
 * here can never be called cosmetic, however the two versions of it happen to differ.
 */
suite("FormattingOnly Tests", () => {
    suite("unsupported formats", () => {
        const unsupported = ["notes.md", "config.yaml", "script.py", "Makefile"];

        test("should never classify a change as formatting only", () => {
            for (const file of unsupported) {
                // Identical content included: whitespace is content in all of these, so even a file
                // that only gained indentation has to go through review.
                assert.strictEqual(isFormattingOnlyChange(file, "a:\n  b\n", "a:\n    b\n"), false, file);
                assert.strictEqual(isFormattingOnlyChange(file, "same\n", "same\n"), false, file);
            }
        });

        test("should not report the format as supported", () => {
            for (const file of unsupported) {
                assert.strictEqual(isSupportedFile(file), false, file);
            }
        });

        test("should report every format it can route", () => {
            for (const file of ["a.ts", "a.tsx", "a.js", "a.jsx", "a.mjs", "a.cjs", "a.json", "a.jsonc", "a.css", "a.scss", "a.less"]) {
                assert.strictEqual(isSupportedFile(file), true, file);
            }
        });
    });

    suite("routing", () => {
        test("should reach the script comparison", () => {
            assert.strictEqual(isFormattingOnlyChange("a.ts", "const a = {b: 1};\n", "const a = {\n    b: 1,\n};\n"), true);
        });

        test("should reach the json comparison", () => {
            assert.strictEqual(isFormattingOnlyChange("a.json", '{"a": [1, 2]}\n', '{\n    "a": [\n        1,\n        2\n    ]\n}\n'), true);
        });

        test("should reach the style comparison", () => {
            assert.strictEqual(isFormattingOnlyChange("a.css", ".a { color: red; }\n", ".a {\n    color: red;\n}\n"), true);
        });
    });

    test("should treat a pure line ending change as formatting only", () => {
        // Line endings are normalized before the comparison, so `Convert EOL to LF` auto-stages.
        assert.strictEqual(isFormattingOnlyChange("a.ts", "const a = 1;\r\nconst b = 2;\r\n", "const a = 1;\nconst b = 2;\n"), true);
    });

    test("should refuse to compare input above the size limit", () => {
        // 2 MB. A checked-in bundle is not worth seconds of parsing to classify.
        const huge = `const a = "${"x".repeat(2 * 1024 * 1024)}";\n`;

        assert.strictEqual(isFormattingOnlyChange("a.ts", huge, huge), false);
        assert.strictEqual(isFormattingOnlyChange("a.ts", "const a = 1;\n", huge), false);
    });
});

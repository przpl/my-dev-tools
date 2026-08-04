import * as assert from "assert";

import { isStyleFormattingOnlyChange } from "../../../features/git/styleFormatting";

suite("StyleFormatting Tests", () => {
    test("should reject whitespace inserted before a pseudo class", () => {
        // `a :hover` matches a hovered descendant of `a`, `a:hover` matches a hovered `a`. The rule
        // the scanner exists to respect: whitespace is never dropped next to `:`.
        assert.strictEqual(isStyleFormattingOnlyChange("a :hover { color: red; }", "a:hover { color: red; }"), false);
    });

    test("should accept the same selector laid out differently", () => {
        assert.strictEqual(isStyleFormattingOnlyChange("a:hover { color: red; }", "a:hover {\n    color: red;\n}\n"), true);
    });

    test("should reject an unterminated string", () => {
        assert.strictEqual(isStyleFormattingOnlyChange('a { content: "x; }', 'a { content: "x"; }'), false);
    });

    test("should reject an unterminated block comment", () => {
        assert.strictEqual(isStyleFormattingOnlyChange("/* note\na { color: red; }", "a { color: red; }"), false);
    });
});

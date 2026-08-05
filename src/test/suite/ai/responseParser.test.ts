import * as assert from "assert";

import { parseFileBlocks, ResponseError, stripFence } from "../../../features/ai/responseParser";

/**
 * Everything here is a shape a model actually produces when told not to. The parser's job is to be
 * unsurprised by the fence, and to refuse a path that would write outside the workspace.
 */
suite("Response Parser Tests", () => {
    suite("stripFence", () => {
        test("should remove a fence wrapping the whole reply", () => {
            assert.strictEqual(stripFence("```ts\nconst a = 1;\n```"), "const a = 1;");
            assert.strictEqual(stripFence("```\nplain\n```"), "plain");
        });

        test("should leave a reply that is not fenced alone", () => {
            assert.strictEqual(stripFence("const a = 1;\n"), "const a = 1;");
        });

        test("should keep the fences inside a generated Markdown file", () => {
            const markdown = "# Title\n\n```ts\nconst a = 1;\n```\n\nDone.";

            assert.strictEqual(stripFence(markdown), markdown);
        });

        test("should keep the code fences of a fenced Markdown reply", () => {
            assert.strictEqual(stripFence("```md\n# Title\n\n```ts\nconst a = 1;\n```\n```"), "# Title\n\n```ts\nconst a = 1;\n```");
        });
    });

    suite("parseFileBlocks", () => {
        test("should read one block", () => {
            const files = parseFileBlocks('<file path="src/date.test.ts">\nimport { test } from "node:test";\n</file>');

            assert.deepStrictEqual(files, [{ path: "src/date.test.ts", content: 'import { test } from "node:test";' }]);
        });

        test("should read several blocks and the prose between them", () => {
            const reply = ['<file path="a.ts">\nexport const a = 1;\n</file>', "", '<file path="b.ts">\nexport const b = 2;\n</file>'].join("\n");

            assert.deepStrictEqual(
                parseFileBlocks(reply).map(file => file.path),
                ["a.ts", "b.ts"]
            );
        });

        test("should unwrap a fence the model put inside the block", () => {
            const files = parseFileBlocks('<file path="a.ts">\n```ts\nexport const a = 1;\n```\n</file>');

            assert.strictEqual(files[0].content, "export const a = 1;");
        });

        test("should normalise a Windows path and a leading ./", () => {
            assert.strictEqual(parseFileBlocks('<file path=".\\src\\a.ts">\nx\n</file>')[0].path, "src/a.ts");
        });

        test("should refuse a path that leaves the workspace", () => {
            assert.throws(() => parseFileBlocks('<file path="../outside.ts">\nx\n</file>'), ResponseError);
            assert.throws(() => parseFileBlocks('<file path="/etc/passwd">\nx\n</file>'), ResponseError);
            assert.throws(() => parseFileBlocks('<file path="C:/Windows/system.ini">\nx\n</file>'), ResponseError);
        });

        test("should say so when the model answered with prose instead of files", () => {
            assert.throws(() => parseFileBlocks("Sure! Here are some tests you could write."), /nothing to write/);
        });
    });
});

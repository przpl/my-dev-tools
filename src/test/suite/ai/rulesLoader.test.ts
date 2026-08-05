import * as assert from "assert";
import * as vscode from "vscode";

import { loadRules, parseFrontmatter } from "../../../features/ai/rulesLoader";
import { createTempDir, removeTempDir, writeFile } from "../../helpers/tempDir";

/**
 * The rule files belong to another tool, so this suite is written against the format as it is found
 * on disk — a `paths` block sequence, a body wrapped in a pseudo-XML tag — rather than against a
 * format that would have been convenient.
 */

const TYPESCRIPT_RULE = `---
paths:
    - "**/*.ts"
    - "**/*.tsx"
---

<typescript_instructions>

- Prefer \`unknown\` to \`any\`
  </typescript_instructions>
`;

const ALWAYS_RULE = `---
paths:
    - "**/*"
---

<engineering_instructions>
- Delete code rather than comment it out
</engineering_instructions>
`;

const PAGE_RULE = `---
paths:
    - "app/**/page.tsx"
    - "app/**/layout.tsx"
---

<nextjs_page_layout_instructions>
- Suffix page components \`Page\`
</nextjs_page_layout_instructions>
`;

const TESTING_RULE = `---
paths:
    - "**/*.test.ts"
---

<testing_instructions>
- One behaviour per test
</testing_instructions>
`;

suite("Rules Loader Tests", () => {
    let directory: string;
    let folder: vscode.WorkspaceFolder;
    let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

    setup(() => {
        directory = createTempDir("ai-rules");
        folder = { uri: vscode.Uri.file(directory), name: "temp", index: 0 };

        originalGetConfiguration = vscode.workspace.getConfiguration;
        vscode.workspace.getConfiguration = (() => ({
            get: (key: string, fallback: unknown) => (key === "ai.rulesDirectory" ? ".claude/rules" : fallback),
        })) as unknown as typeof vscode.workspace.getConfiguration;

        writeFile(directory, ".claude/rules/typescript.md", TYPESCRIPT_RULE);
        writeFile(directory, ".claude/rules/engineering.md", ALWAYS_RULE);
        writeFile(directory, ".claude/rules/nextjs-page-layout.project.md", PAGE_RULE);
        writeFile(directory, ".claude/rules/testing.md", TESTING_RULE);
        writeFile(directory, ".claude/rules/not-a-rule.txt", "ignored");
    });

    teardown(() => {
        vscode.workspace.getConfiguration = originalGetConfiguration;
        removeTempDir(directory);
    });

    async function namesFor(relativePath: string, options: { always?: string[]; matchPaths?: boolean } = {}): Promise<string[]> {
        return (await loadRules(folder, { relativePath, ...options })).map(rule => rule.name);
    }

    suite("frontmatter", () => {
        test("should read the block sequence the rule files use", () => {
            assert.deepStrictEqual(parseFrontmatter(TYPESCRIPT_RULE).paths, ["**/*.ts", "**/*.tsx"]);
        });

        test("should keep the body without the frontmatter", () => {
            const { body } = parseFrontmatter(TYPESCRIPT_RULE);

            assert.ok(body.startsWith("<typescript_instructions>"), body);
            assert.ok(!body.includes("paths:"));
        });

        test("should read an inline array too", () => {
            assert.deepStrictEqual(parseFrontmatter(`---\npaths: ["**/*.md"]\n---\nbody`).paths, ["**/*.md"]);
        });

        test("should treat a file without frontmatter as one without restrictions", () => {
            const parsed = parseFrontmatter("# Just a document\n");

            assert.strictEqual(parsed.paths, undefined);
            assert.strictEqual(parsed.body, "# Just a document");
        });

        test("should not mistake a following key for a path", () => {
            assert.deepStrictEqual(parseFrontmatter(`---\npaths:\n    - "**/*.ts"\ndescription: hello\n---\nbody`).paths, ["**/*.ts"]);
        });
    });

    suite("selection", () => {
        test("should attach the rules whose paths match the edited file", async () => {
            assert.deepStrictEqual(await namesFor("src/button.tsx"), ["engineering.md", "typescript.md"]);
        });

        test("should attach a path-scoped rule only inside its path", async () => {
            assert.ok((await namesFor("app/blog/page.tsx")).includes("nextjs-page-layout.project.md"));
            assert.ok(!(await namesFor("components/page.tsx")).includes("nextjs-page-layout.project.md"));
        });

        test("should attach an always-on rule to any file", async () => {
            assert.deepStrictEqual(await namesFor("README.md"), ["engineering.md"]);
        });

        test("should ignore anything that is not Markdown", async () => {
            assert.ok(!(await namesFor("src/button.tsx")).includes("not-a-rule.txt"));
        });

        test("should attach a named rule the edited file would not have matched", async () => {
            const names = await namesFor("src/button.ts", { always: ["testing.md"] });

            assert.ok(names.includes("testing.md"), "a write-tests command wants the testing rules whatever it is editing");
        });

        test("should attach only the named rules when the command opted out", async () => {
            assert.deepStrictEqual(await namesFor("src/button.ts", { always: ["testing.md"], matchPaths: false }), ["testing.md"]);
        });

        test("should treat a missing rules directory as no rules", async () => {
            const bare = createTempDir("ai-rules-bare");

            try {
                const rules = await loadRules({ uri: vscode.Uri.file(bare), name: "bare", index: 0 }, { relativePath: "a.ts" });
                assert.deepStrictEqual(rules, []);
            } finally {
                removeTempDir(bare);
            }
        });
    });
});

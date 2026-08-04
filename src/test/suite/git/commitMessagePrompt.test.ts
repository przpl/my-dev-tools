import * as assert from "assert";

import type { ChangedFile } from "../../../features/git/collectDiff";
import { COMMIT_MESSAGE_SPEC, buildSystemPrompt, buildUserPrompt, sanitizeCommitMessage } from "../../../features/git/commitMessagePrompt";

function file(overrides: Partial<ChangedFile> = {}): ChangedFile {
    return { status: "M", path: "src/app.ts", excluded: false, ...overrides };
}

suite("CommitMessagePrompt Tests", () => {
    suite("sanitizeCommitMessage", () => {
        test("should strip a fence with a language tag", () => {
            assert.strictEqual(sanitizeCommitMessage("```text\nfeat: add a thing\n```"), "feat: add a thing");
        });

        test("should strip a fence without a language tag", () => {
            assert.strictEqual(sanitizeCommitMessage("```\nfeat: add a thing\n```"), "feat: add a thing");
        });

        test("should keep the body of a fenced multi-line message", () => {
            assert.strictEqual(sanitizeCommitMessage("```\nfeat: add a thing\n\n- because\n```"), "feat: add a thing\n\n- because");
        });

        test("should strip the quotes around a single-line message", () => {
            assert.strictEqual(sanitizeCommitMessage('"feat: add a thing"'), "feat: add a thing");
        });

        test("should leave a multi-line message that happens to open and close with a quote", () => {
            // Only a whole-message wrapper is a model artefact; over several lines those quotes are content.
            const message = '"feat: add a thing\n\n- the flag is spelled "on""';
            assert.strictEqual(sanitizeCommitMessage(message), message);
        });

        test("should leave a lone quote alone", () => {
            assert.strictEqual(sanitizeCommitMessage('"'), '"');
        });

        test("should normalize line endings and trim", () => {
            assert.strictEqual(sanitizeCommitMessage("  feat: add a thing\r\n\r\n- because  \r\n  "), "feat: add a thing\n\n- because");
        });
    });

    suite("buildUserPrompt", () => {
        const base = { files: [file()], diff: "@@\n+const a = 1;\n" };

        test("should omit the branch section when there is no branch", () => {
            assert.ok(!buildUserPrompt(base).includes("Branch:"));
            assert.ok(buildUserPrompt({ ...base, branch: "feature/x" }).includes("Branch: feature/x"));
        });

        test("should omit the hint section when the hint is blank", () => {
            assert.ok(!buildUserPrompt({ ...base, hint: "   \n  " }).includes("The author started typing"));
            assert.ok(buildUserPrompt({ ...base, hint: " drop the cache " }).includes("drop the cache"));
        });

        test("should name the previous path of a rename", () => {
            const prompt = buildUserPrompt({ ...base, files: [file({ status: "R", path: "src/b.ts", previousPath: "src/a.ts" })] });

            assert.ok(prompt.includes("R  src/b.ts (from src/a.ts)"), prompt);
        });

        test("should mark a file left out of the diff", () => {
            const prompt = buildUserPrompt({ ...base, files: [file({ path: "yarn.lock", excluded: true })] });

            assert.ok(prompt.includes("yarn.lock   [excluded from diff]"), prompt);
        });

        test("should carry the diff", () => {
            assert.ok(buildUserPrompt(base).includes("Diff:\n@@\n+const a = 1;\n"));
        });
    });

    suite("buildSystemPrompt", () => {
        test("should always carry the specification", () => {
            assert.ok(buildSystemPrompt("").includes(COMMIT_MESSAGE_SPEC));
        });

        test("should append project instructions only when there are any", () => {
            assert.ok(!buildSystemPrompt("  \n ").includes("Additional project instructions"));

            const withExtra = buildSystemPrompt("  Always mention the ticket.  ");
            assert.ok(withExtra.includes("## Additional project instructions\n\nAlways mention the ticket."), withExtra);
        });
    });
});

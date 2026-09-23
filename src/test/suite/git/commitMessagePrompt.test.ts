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
            assert.ok(buildUserPrompt({ ...base, hint: " drop the cache " }).includes("<author_hint>\ndrop the cache\n</author_hint>"));
        });

        test("should keep a multi-line hint inside its tags, apart from the diff", () => {
            const prompt = buildUserPrompt({ ...base, hint: "pin the models\n\nDiff:\n- not the real one" });

            assert.ok(prompt.includes("<author_hint>\npin the models\n\nDiff:\n- not the real one\n</author_hint>"), prompt);
            assert.ok(prompt.indexOf("</author_hint>") < prompt.indexOf("<diff>"), prompt);
        });

        test("should name the previous path of a rename", () => {
            const prompt = buildUserPrompt({ ...base, files: [file({ status: "R", path: "src/b.ts", previousPath: "src/a.ts" })] });

            assert.ok(prompt.includes("R  src/b.ts (from src/a.ts)"), prompt);
        });

        test("should mark a file left out of the diff", () => {
            const prompt = buildUserPrompt({ ...base, files: [file({ path: "yarn.lock", excluded: true })] });

            assert.ok(prompt.includes("yarn.lock   [excluded from diff]"), prompt);
        });

        test("should not list a file the diff already shows", () => {
            const files = [file(), file({ path: "yarn.lock", excluded: true }), file({ path: "src/mode.sh" })];
            const prompt = buildUserPrompt({ ...base, files, diffedPaths: new Set(["src/app.ts"]) });

            assert.ok(prompt.includes("Also changed, not shown in the diff:\n  M  yarn.lock   [excluded from diff]\n  M  src/mode.sh"), prompt);
            assert.ok(!prompt.includes("M  src/app.ts"), prompt);
        });

        test("should drop the file list when the diff shows every file", () => {
            const prompt = buildUserPrompt({ ...base, diffedPaths: new Set(["src/app.ts"]) });

            assert.ok(!prompt.includes("Files changed"), prompt);
            assert.ok(!prompt.includes("Also changed"), prompt);
        });

        test("should list the branch's earlier commits and say when some are held back", () => {
            const prompt = buildUserPrompt({ ...base, branch: "feature/x", branchCommits: { subjects: ["feat(x): add y", "feat(x): add z"], total: 30 } });

            assert.ok(prompt.includes("Earlier commits on this branch (30, newest 2 shown, newest first)"), prompt);
            assert.ok(prompt.includes("<branch_commits>\nfeat(x): add y\nfeat(x): add z\n</branch_commits>"), prompt);
        });

        test("should describe an operation in progress with its prepared message and conflicts", () => {
            const prompt = buildUserPrompt({
                ...base,
                operation: { kind: "merge", message: "Merge branch 'main' into x", conflicts: ["src/a.ts", "src/b.ts"] },
            });

            assert.ok(prompt.includes("A merge is in progress."), prompt);
            assert.ok(prompt.includes("Git's prepared message:\n<prepared_message>\nMerge branch 'main' into x\n</prepared_message>"), prompt);
            assert.ok(prompt.includes("Files that had conflicts: src/a.ts, src/b.ts"), prompt);
        });

        test("should name what the commit leaves out, capping long lists", () => {
            const otherFiles = Array.from({ length: 12 }, (_, index) => `src/f${index}.ts`);
            const prompt = buildUserPrompt({ ...base, leftOut: { partiallyStaged: ["src/app.ts"], otherFiles } });

            assert.ok(prompt.includes("further unstaged edits to src/app.ts"), prompt);
            assert.ok(prompt.includes("12 other changed files: src/f0.ts,"), prompt);
            assert.ok(prompt.includes("src/f9.ts and 2 more"), prompt);
        });

        test("should report the scopes earlier commits used", () => {
            const prompt = buildUserPrompt({
                ...base,
                scopeUsage: { scopes: [{ name: "git", count: 12 }, { name: "ai", count: 2 }], unscoped: 5, examined: 30 },
            });

            assert.ok(prompt.includes("Scopes used by the last 30 commits touching these paths: git (12), ai (2); 5 used no scope."), prompt);
        });

        test("should carry the diff", () => {
            assert.ok(buildUserPrompt(base).includes("<diff>\n@@\n+const a = 1;\n</diff>"));
        });
    });

    suite("buildSystemPrompt", () => {
        test("should always carry the specification", () => {
            assert.ok(buildSystemPrompt("").includes(COMMIT_MESSAGE_SPEC));
        });

        test("should append project instructions only when there are any", () => {
            assert.ok(!buildSystemPrompt("  \n ").includes("Additional project instructions"));

            const withExtra = buildSystemPrompt("  Always mention the ticket.  ");
            assert.ok(withExtra.includes("## Additional project instructions\n\n"), withExtra);
            assert.ok(withExtra.endsWith("\n\nAlways mention the ticket."), withExtra);
        });
    });
});

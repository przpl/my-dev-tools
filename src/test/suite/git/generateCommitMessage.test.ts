import * as assert from "assert";

import { buildCommitContext, generateCommitMessage, NothingToDescribeError } from "../../../features/git/commitContext";
import { COMMIT_MESSAGE_SPEC } from "../../../features/git/commitMessagePrompt";
import { OpenRouterClient, setOpenRouter, type ChatMessage } from "../../../services/openRouter";
import { commitAll, createTempRepo, git, removeTempRepo, writeFile } from "../../helpers/tempRepo";
import { fakeSecrets } from "../../helpers/vscodeStubs";

/**
 * The join: `resolveScope` -> `collectDiff` -> `cleanDiff` -> the prompts -> `chat` ->
 * `sanitizeCommitMessage`. Each half has its own suite; what nothing else covers is that a real
 * repository arrives at the model as the prompt the specification describes.
 */

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

suite("GenerateCommitMessage Tests", () => {
    let repo: string;
    let originalFetch: typeof globalThis.fetch;
    let originalEnvKey: string | undefined;
    let requests: { url: string; init: RequestInit }[];

    setup(() => {
        repo = createTempRepo("generate-message");

        originalFetch = globalThis.fetch;
        originalEnvKey = process.env.OPENROUTER_API_KEY;
        process.env.OPENROUTER_API_KEY = "test-key";
        requests = [];

        // The pipeline runs in this process, whose copy of the module has no client yet.
        setOpenRouter(new OpenRouterClient(fakeSecrets()));
    });

    teardown(() => {
        globalThis.fetch = originalFetch;
        setOpenRouter(undefined);

        if (originalEnvKey === undefined) {
            delete process.env.OPENROUTER_API_KEY;
        } else {
            process.env.OPENROUTER_API_KEY = originalEnvKey;
        }

        removeTempRepo(repo);
    });

    function respondWith(reply: string): void {
        globalThis.fetch = (async (url: string, init: RequestInit) => {
            requests.push({ url: String(url), init });
            return jsonResponse(200, { choices: [{ message: { content: reply } }] });
        }) as typeof globalThis.fetch;
    }

    function write(relativePath: string, content: string): void {
        writeFile(repo, relativePath, content);
    }

    function sentMessages(): ChatMessage[] {
        assert.strictEqual(requests.length, 1, "Expected exactly one request");
        const body = JSON.parse(String(requests[0].init.body)) as { messages: ChatMessage[] };
        return body.messages;
    }

    function sent(role: ChatMessage["role"]): string {
        const message = sentMessages().find(entry => entry.role === role);
        assert.ok(message, `No ${role} message was sent`);
        return message.content;
    }

    test("should send the branch, the file list and the real diff", async () => {
        write("src/app.ts", "const limit = 5;\n");
        commitAll(repo);
        git(repo, ["checkout", "-q", "-b", "feature/limits"]);
        write("src/app.ts", "const limit = 50;\n");

        respondWith("fix(app): raise the limit");

        await generateCommitMessage(repo);

        const user = sent("user");
        assert.ok(user.includes("Branch: feature/limits"), user);
        // The diff header already names the file, so it is not listed a second time.
        assert.ok(user.includes("--- src/app.ts"), user);
        assert.ok(!user.includes("Files changed:"), user);
        assert.ok(user.includes("-const limit = 5;"), user);
        assert.ok(user.includes("+const limit = 50;"), user);

        assert.ok(sent("system").includes(COMMIT_MESSAGE_SPEC));
    });

    test("should leave a trunk branch out of the prompt", async () => {
        write("src/app.ts", "const limit = 5;\n");
        commitAll(repo);
        git(repo, ["checkout", "-q", "-B", "main"]);
        write("src/app.ts", "const limit = 50;\n");

        const context = await buildCommitContext(repo);

        assert.strictEqual(context.branch, undefined);
    });

    test("should leave a detached HEAD out of the prompt", async () => {
        write("src/app.ts", "const limit = 5;\n");
        commitAll(repo);
        git(repo, ["checkout", "-q", "--detach"]);
        write("src/app.ts", "const limit = 50;\n");

        const context = await buildCommitContext(repo);

        assert.strictEqual(context.branch, undefined);
    });

    test("should describe the target branch rather than the checked-out one", async () => {
        write("src/app.ts", "const limit = 5;\n");
        commitAll(repo);
        git(repo, ["checkout", "-q", "-b", "feature/checked-out"]);
        write("src/app.ts", "const limit = 50;\n");

        const context = await buildCommitContext(repo, { targetBranch: "fix/limits" });

        assert.strictEqual(context.branch, "fix/limits");
    });

    test("should return the reply sanitized", async () => {
        write("src/app.ts", "const limit = 5;\n");
        commitAll(repo);
        write("src/app.ts", "const limit = 50;\n");

        respondWith("```\nfix(app): raise the limit\n```");

        assert.strictEqual(await generateCommitMessage(repo), "fix(app): raise the limit");
    });

    test("should refuse to describe a clean repository", async () => {
        write("src/app.ts", "const limit = 5;\n");
        commitAll(repo);

        // Callers branch on the class, not on the message.
        await assert.rejects(buildCommitContext(repo), NothingToDescribeError);
    });

    test("should send a reformatted file as a note rather than as its diff", async () => {
        write("src/styled.ts", "const a = {x: 1};\n");
        // A change worth describing beside it: a commit that is nothing but reformats keeps its diff,
        // because then the diff is the only evidence of what happened.
        write("src/app.ts", "const limit = 5;\n");
        commitAll(repo);
        write("src/styled.ts", "const a = {\n    x: 1,\n};\n");
        write("src/app.ts", "const limit = 50;\n");

        respondWith("style(app): reformat");

        await generateCommitMessage(repo);

        const user = sent("user");
        assert.ok(user.includes("--- src/styled.ts\n(formatting only)"), user);
        assert.ok(!user.includes("+    x: 1,"), user);
    });

    suite("repository context", () => {
        /** A `main` with one commit, and a branch off it that already has two of its own. */
        function branchWithHistory(): void {
            git(repo, ["checkout", "-q", "-B", "main"]);
            write("src/app.ts", "const limit = 5;\n");
            commitAll(repo, "chore: baseline on main");
            git(repo, ["checkout", "-q", "-b", "feature/limits"]);
            write("src/app.ts", "const limit = 10;\n");
            commitAll(repo, "feat(app): make the limit configurable");
            write("src/app.ts", "const limit = 20;\n");
            commitAll(repo, "test(app): cover the limit");
        }

        test("should send the commits the branch has beyond its base, newest first", async () => {
            branchWithHistory();
            write("src/app.ts", "const limit = 50;\n");

            const context = await buildCommitContext(repo);

            assert.deepStrictEqual(context.branchCommits, { subjects: ["test(app): cover the limit", "feat(app): make the limit configurable"], total: 2 });
        });

        test("should leave out merges from the base", async () => {
            branchWithHistory();
            git(repo, ["checkout", "-q", "main"]);
            write("src/other.ts", "export const other = 1;\n");
            commitAll(repo, "feat: unrelated work on main");
            git(repo, ["checkout", "-q", "feature/limits"]);
            git(repo, ["merge", "-q", "--no-edit", "--no-ff", "main"]);
            write("src/app.ts", "const limit = 50;\n");

            const context = await buildCommitContext(repo);

            assert.strictEqual(context.branchCommits?.total, 2);
            assert.ok(!context.branchCommits?.subjects.some(subject => subject.includes("unrelated")));
        });

        test("should send no history on main", async () => {
            branchWithHistory();
            git(repo, ["checkout", "-q", "main"]);
            write("src/app.ts", "const limit = 50;\n");

            const context = await buildCommitContext(repo);

            assert.strictEqual(context.branchCommits, undefined);
        });

        test("should read the history of the target branch, not the checked-out one", async () => {
            branchWithHistory();
            git(repo, ["checkout", "-q", "main"]);
            git(repo, ["branch", "fix/other"]);
            write("src/app.ts", "const limit = 50;\n");

            const context = await buildCommitContext(repo, { paths: ["src/app.ts"], targetBranch: "feature/limits" });

            assert.strictEqual(context.branch, "feature/limits");
            assert.strictEqual(context.branchCommits?.total, 2);
        });

        test("should report a conflicted merge with git's prepared message", async () => {
            branchWithHistory();
            git(repo, ["checkout", "-q", "main"]);
            write("src/app.ts", "const limit = 99;\n");
            commitAll(repo, "fix(app): lower the ceiling");
            git(repo, ["checkout", "-q", "feature/limits"]);
            assert.throws(() => git(repo, ["merge", "-q", "main"]));
            write("src/app.ts", "const limit = 50;\n");
            git(repo, ["add", "src/app.ts"]);

            const context = await buildCommitContext(repo);

            assert.strictEqual(context.operation?.kind, "merge");
            assert.ok(context.operation?.message?.startsWith("Merge branch 'main' into feature/limits"), context.operation?.message);
            assert.deepStrictEqual(context.operation?.conflicts, ["src/app.ts"]);
        });

        test("should report a cherry-pick and keep the branch of a rebase", async () => {
            branchWithHistory();
            git(repo, ["checkout", "-q", "main"]);
            write("src/app.ts", "const limit = 99;\n");
            commitAll(repo, "fix(app): lower the ceiling");
            git(repo, ["checkout", "-q", "feature/limits"]);
            assert.throws(() => git(repo, ["cherry-pick", "main"]));
            write("src/app.ts", "const limit = 50;\n");
            git(repo, ["add", "src/app.ts"]);

            const picked = await buildCommitContext(repo);
            assert.strictEqual(picked.operation?.kind, "cherry-pick");
            assert.ok(picked.operation?.message?.startsWith("fix(app): lower the ceiling"), picked.operation?.message);

            git(repo, ["cherry-pick", "--abort"]);
            assert.throws(() => git(repo, ["rebase", "main"]));
            write("src/app.ts", "const limit = 50;\n");
            git(repo, ["add", "src/app.ts"]);

            const rebased = await buildCommitContext(repo);
            assert.strictEqual(rebased.operation?.kind, "rebase");
            // HEAD is detached mid-rebase; the branch comes from the rebase state instead.
            assert.strictEqual(rebased.branch, "feature/limits");

            git(repo, ["rebase", "--abort"]);
        });

        test("should name unstaged edits the commit leaves behind", async () => {
            write("src/app.ts", "const limit = 5;\n");
            write("src/other.ts", "const other = 1;\n");
            commitAll(repo);
            write("src/app.ts", "const limit = 50;\n");
            git(repo, ["add", "src/app.ts"]);
            write("src/app.ts", "const limit = 500;\n");
            write("src/other.ts", "const other = 2;\n");

            const context = await buildCommitContext(repo);

            assert.deepStrictEqual(context.leftOut, { partiallyStaged: ["src/app.ts"], otherFiles: ["src/other.ts"] });
        });

        test("should name the files a Quick Commit leaves behind", async () => {
            write("src/app.ts", "const limit = 5;\n");
            write("src/other.ts", "const other = 1;\n");
            commitAll(repo);
            write("src/app.ts", "const limit = 50;\n");
            write("src/other.ts", "const other = 2;\n");

            const context = await buildCommitContext(repo, { paths: ["src/app.ts"] });

            assert.deepStrictEqual(context.leftOut, { partiallyStaged: [], otherFiles: ["src/other.ts"] });
        });

        test("should report nothing left out when every change is described", async () => {
            write("src/app.ts", "const limit = 5;\n");
            commitAll(repo);
            write("src/app.ts", "const limit = 50;\n");

            const context = await buildCommitContext(repo);

            assert.strictEqual(context.leftOut, undefined);
        });

        test("should report the scopes used by earlier commits to the same files", async () => {
            write("src/git/a.ts", "export const a = 1;\n");
            write("src/other.ts", "export const other = 1;\n");
            commitAll(repo, "feat(git): add a");
            write("src/git/a.ts", "export const a = 2;\n");
            commitAll(repo, "fix(git): correct a");
            write("src/git/a.ts", "export const a = 3;\n");
            commitAll(repo, "refactor: tidy a");
            write("src/other.ts", "export const other = 2;\n");
            commitAll(repo, "feat(other): unrelated");
            write("src/git/a.ts", "export const a = 4;\n");
            // A new file has no history of its own; its directory stands in for it.
            write("src/git/b.ts", "export const b = 1;\n");

            const context = await buildCommitContext(repo);

            assert.deepStrictEqual(context.scopeUsage, { scopes: [{ name: "git", count: 2 }], unscoped: 1, examined: 3 });
        });

        test("should report code moved into a new file, and the size of each change", async () => {
            const helper = [
                "export function normalizeScope(scope: string): string {",
                "    const trimmed = scope.trim().toLowerCase();",
                "    if (trimmed.length === 0) {",
                "        return \"default\";",
                "    }",
                "    return trimmed.replace(/\\s+/g, \"-\");",
                "}",
            ];
            write("src/app.ts", ["export const limit = 5;", ...helper, ""].join("\n"));
            commitAll(repo);
            write("src/app.ts", "export const limit = 5;\n");
            write("src/scope.ts", [...helper, ""].join("\n"));

            respondWith("refactor(app): extract scope normalization");
            await generateCommitMessage(repo);

            const user = sent("user");
            // The size is the change as written; the body is only the move.
            assert.ok(user.includes("--- src/app.ts [+0 -7]\n"), user);
            // Only the source keeps an outline: enough to name what moved, and only once.
            assert.ok(user.includes("\n-[7 lines moved to src/scope.ts]\n-  export function normalizeScope(scope: string): string {"), user);
            assert.ok(user.includes("+++ NEW src/scope.ts [+7 -0]\n@@\n+[7 lines moved from src/app.ts]"), user);
            assert.strictEqual(user.split("normalizeScope").length, 2, user);
            assert.ok(!user.includes("trimmed.replace"), user);
        });

        test("should still list a file the diff does not show", async () => {
            write("src/app.ts", "const limit = 5;\n");
            commitAll(repo);
            write("src/app.ts", "const limit = 50;\n");
            write("package-lock.json", "{}\n");

            respondWith("chore: raise the limit");
            await generateCommitMessage(repo);

            const user = sent("user");
            assert.ok(user.includes("Also changed, not shown in the diff:\n  ?  package-lock.json   [excluded from diff]"), user);
        });
    });
});

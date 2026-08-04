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
        assert.ok(user.includes("M  src/app.ts"), user);
        assert.ok(user.includes("-const limit = 5;"), user);
        assert.ok(user.includes("+const limit = 50;"), user);

        assert.ok(sent("system").includes(COMMIT_MESSAGE_SPEC));
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
});

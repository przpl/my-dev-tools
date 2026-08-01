import * as assert from "assert";
import * as vscode from "vscode";

import { OpenRouterClient, OpenRouterError } from "../../../services/openRouter";

/** A SecretStorage backed by a Map, so nothing touches the real keychain. */
function fakeSecrets(initial?: string): vscode.SecretStorage {
    const store = new Map<string, string>();
    if (initial !== undefined) {
        store.set("myDevTools.openRouter.apiKey", initial);
    }

    return {
        keys: async () => [...store.keys()],
        get: async key => store.get(key),
        store: async (key, value) => void store.set(key, value),
        delete: async key => void store.delete(key),
        onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event,
    };
}

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

suite("OpenRouter Tests", () => {
    let originalFetch: typeof globalThis.fetch;
    let originalEnvKey: string | undefined;
    let requests: { url: string; init: RequestInit }[];

    setup(() => {
        originalFetch = globalThis.fetch;
        originalEnvKey = process.env.OPENROUTER_API_KEY;
        delete process.env.OPENROUTER_API_KEY;
        requests = [];
    });

    teardown(() => {
        globalThis.fetch = originalFetch;
        if (originalEnvKey === undefined) {
            delete process.env.OPENROUTER_API_KEY;
        } else {
            process.env.OPENROUTER_API_KEY = originalEnvKey;
        }
    });

    function respondWith(response: Response | (() => Promise<Response>)): void {
        globalThis.fetch = (async (url: string, init: RequestInit) => {
            requests.push({ url: String(url), init });
            return typeof response === "function" ? response() : response;
        }) as typeof globalThis.fetch;
    }

    function client(key = "test-key"): OpenRouterClient {
        return new OpenRouterClient(fakeSecrets(key));
    }

    const ask = { messages: [{ role: "user" as const, content: "hello" }] };

    test("should send the key, the model and the messages", async () => {
        respondWith(jsonResponse(200, { choices: [{ message: { content: "feat: add a thing" } }] }));

        const reply = await client().chat({ ...ask, model: "test/model" });

        assert.strictEqual(reply, "feat: add a thing");
        assert.strictEqual(requests.length, 1);
        assert.ok(requests[0].url.endsWith("/chat/completions"), requests[0].url);

        const headers = requests[0].init.headers as Record<string, string>;
        assert.strictEqual(headers["Authorization"], "Bearer test-key");
        assert.strictEqual(headers["X-Title"], "My Dev Tools");

        const body = JSON.parse(String(requests[0].init.body));
        assert.strictEqual(body.model, "test/model");
        assert.deepStrictEqual(body.messages, ask.messages);
    });

    test("should trim the reply", async () => {
        respondWith(jsonResponse(200, { choices: [{ message: { content: "  fix: trim me  \n" } }] }));

        assert.strictEqual(await client().chat(ask), "fix: trim me");
    });

    test("should fall back to the environment when no key is stored", async () => {
        process.env.OPENROUTER_API_KEY = "from-env";
        respondWith(jsonResponse(200, { choices: [{ message: { content: "ok" } }] }));

        await new OpenRouterClient(fakeSecrets()).chat(ask);

        assert.strictEqual((requests[0].init.headers as Record<string, string>)["Authorization"], "Bearer from-env");
    });

    test("should explain a rejected key instead of dumping the status", async () => {
        respondWith(jsonResponse(401, { error: { message: "No auth credentials found" } }));

        await assert.rejects(client().chat(ask), (error: OpenRouterError) => {
            assert.strictEqual(error.status, 401);
            assert.ok(error.message.includes("Set OpenRouter API Key"), error.message);
            return true;
        });
    });

    test("should explain exhausted credits", async () => {
        respondWith(jsonResponse(402, {}));

        await assert.rejects(client().chat(ask), /insufficient credits/i);
    });

    test("should explain rate limiting", async () => {
        respondWith(jsonResponse(429, {}));

        await assert.rejects(client().chat(ask), /rate limiting/i);
    });

    test("should surface the provider message for an unmapped status", async () => {
        respondWith(jsonResponse(503, { error: { message: "upstream provider is down" } }));

        await assert.rejects(client().chat(ask), /upstream provider is down/);
    });

    test("should treat an error body in a 200 as a failure", async () => {
        respondWith(jsonResponse(200, { error: { message: "context length exceeded", code: 400 } }));

        await assert.rejects(client().chat(ask), /context length exceeded/);
    });

    test("should reject an empty completion", async () => {
        respondWith(jsonResponse(200, { choices: [{ message: { content: "   " } }] }));

        await assert.rejects(client().chat(ask), /empty response/i);
    });

    test("should report an unreachable host rather than leaking the fetch error type", async () => {
        respondWith(() => Promise.reject(new TypeError("fetch failed")));

        await assert.rejects(client().chat(ask), (error: OpenRouterError) => {
            assert.ok(error instanceof OpenRouterError);
            assert.ok(error.message.includes("Could not reach OpenRouter"), error.message);
            return true;
        });
    });

    test("should abort when the caller cancels", async () => {
        const source = new vscode.CancellationTokenSource();

        respondWith(
            () =>
                new Promise<Response>((_resolve, reject) => {
                    source.cancel();
                    setTimeout(() => reject(new DOMException("This operation was aborted", "AbortError")), 0);
                })
        );

        await assert.rejects(client().chat(ask, source.token), /cancelled or timed out/);
    });

    test("should not call the API when there is no key to use", async () => {
        respondWith(jsonResponse(200, { choices: [{ message: { content: "never" } }] }));

        const originalShowInputBox = vscode.window.showInputBox;
        vscode.window.showInputBox = async () => undefined;

        try {
            await assert.rejects(new OpenRouterClient(fakeSecrets()).chat(ask), /No OpenRouter API key/);
            assert.strictEqual(requests.length, 0);
        } finally {
            vscode.window.showInputBox = originalShowInputBox;
        }
    });

    test("should store and clear the key", async () => {
        const secrets = fakeSecrets();
        const openRouter = new OpenRouterClient(secrets);

        const originalShowInputBox = vscode.window.showInputBox;
        vscode.window.showInputBox = async () => "  entered-key  ";

        try {
            assert.strictEqual(await openRouter.promptForApiKey(), "entered-key");
            assert.strictEqual(await openRouter.getApiKey(), "entered-key");

            await openRouter.clearApiKey();
            assert.strictEqual(await openRouter.getApiKey(), undefined);
        } finally {
            vscode.window.showInputBox = originalShowInputBox;
        }
    });
});

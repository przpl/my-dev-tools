import * as vscode from "vscode";

import { Config } from "../utils/config";

/**
 * Minimal OpenRouter client over the REST API. Deliberately not the official SDK: the whole feature
 * is one POST, and a VS Code extension pays for every dependency in download size.
 */

const SECRET_KEY = "myDevTools.openRouter.apiKey";
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Which key a request is billed to. OpenRouter's activity panel groups spend by model, by API key
 * and by nothing else, so a feature that deserves its own line in that report needs its own key.
 * Every scope falls back to the default one, which keeps a single shared key the zero-setup case.
 */
export type ApiKeyScope = "default" | "commitMessage" | "aiCommands";

/**
 * Drives the scope picker and the per-scope palette commands, so a new scope is added here and in
 * the manifest and nowhere else. The manifest tests fail if those two lists drift apart.
 */
export const API_KEY_SCOPES: { scope: ApiKeyScope; label: string; detail: string; setCommand: string }[] = [
    {
        scope: "default",
        label: "Shared key",
        detail: "Used by every feature that has no key of its own",
        setCommand: "myDevTools.setOpenRouterApiKey.shared",
    },
    {
        scope: "commitMessage",
        label: "Commit messages",
        detail: "Bills Generate Commit Message separately",
        setCommand: "myDevTools.setOpenRouterApiKey.commitMessage",
    },
    {
        scope: "aiCommands",
        label: "AI commands",
        detail: "Bills Run AI Command separately",
        setCommand: "myDevTools.setOpenRouterApiKey.aiCommands",
    },
];

function secretKeyFor(scope: ApiKeyScope): string {
    return scope === "default" ? SECRET_KEY : `${SECRET_KEY}.${scope}`;
}

/** OpenRouter attributes requests to the app that sent them via these two headers. */
const APP_URL = "https://github.com/przpl/my-dev-tools";
const APP_TITLE = "My Dev Tools";

export interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

export interface ChatRequest {
    messages: ChatMessage[];
    /** Defaults to the `myDevTools.openRouter.model` setting. */
    model?: string;
    temperature?: number;
    maxTokens?: number;
    /** Overrides {@link REQUEST_TIMEOUT_MS}; a whole-file rewrite needs longer than a commit message. */
    timeoutMs?: number;
    /** Which key to bill, so the call shows up under that key in OpenRouter's activity panel. */
    keyScope?: ApiKeyScope;
}

/** What the call cost, as OpenRouter reports it. Every field is absent on gateways that omit `usage`. */
export interface ChatUsage {
    /** Total charged to the account, in USD. */
    cost?: number;
    promptTokens?: number;
    completionTokens?: number;
}

export interface ChatResult {
    content: string;
    usage?: ChatUsage;
}

export class OpenRouterError extends Error {
    constructor(
        message: string,
        readonly status?: number
    ) {
        super(message);
        this.name = "OpenRouterError";
    }
}

/** Shapes we read out of a response body. Everything is optional: error payloads share the envelope. */
interface ChatResponseBody {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string; code?: number };
    usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number };
}

/** Only the fields that are actually numbers survive, so a partial `usage` cannot report a fake $0. */
function readUsage(body: ChatResponseBody | undefined): ChatUsage | undefined {
    const usage = body?.usage;
    if (!usage) {
        return undefined;
    }

    const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

    return {
        cost: number(usage.cost),
        promptTokens: number(usage.prompt_tokens),
        completionTokens: number(usage.completion_tokens),
    };
}

function describeFailure(status: number, body: ChatResponseBody | undefined): string {
    const detail = body?.error?.message?.trim();

    switch (status) {
        case 401:
            return "OpenRouter rejected the API key. Run 'Set OpenRouter API Key' to enter a new one.";
        case 402:
            return "OpenRouter reports insufficient credits for this request.";
        case 429:
            return "OpenRouter is rate limiting this key. Wait a moment and try again.";
        default:
            return detail || `OpenRouter request failed with status ${status}.`;
    }
}

export class OpenRouterClient {
    constructor(private readonly secrets: vscode.SecretStorage) {}

    /**
     * The key this scope should bill: its own if one was set, otherwise the shared key, otherwise the
     * environment so CI and scratch profiles need no setup.
     */
    async getApiKey(scope: ApiKeyScope = "default"): Promise<string | undefined> {
        if (scope !== "default") {
            const scoped = await this.secrets.get(secretKeyFor(scope));
            if (scoped) {
                return scoped;
            }
        }

        const shared = await this.secrets.get(SECRET_KEY);
        return shared || process.env.OPENROUTER_API_KEY || undefined;
    }

    /** Whether this scope has a key of its own, as opposed to falling through to the shared one. */
    async hasStoredKey(scope: ApiKeyScope): Promise<boolean> {
        return Boolean(await this.secrets.get(secretKeyFor(scope)));
    }

    async promptForApiKey(scope: ApiKeyScope = "default"): Promise<string | undefined> {
        const label = API_KEY_SCOPES.find(entry => entry.scope === scope)?.label ?? "Shared key";

        const key = await vscode.window.showInputBox({
            title: `OpenRouter API Key — ${label}`,
            prompt: "Paste an API key from https://openrouter.ai/keys",
            password: true,
            ignoreFocusOut: true,
            validateInput: value => (value.trim().length === 0 ? "The key cannot be empty" : null),
        });

        if (!key) {
            return undefined;
        }

        await this.secrets.store(secretKeyFor(scope), key.trim());
        return key.trim();
    }

    /**
     * Returns the key to bill, asking for one if nothing resolves. The prompt is always for the shared
     * key: a first-run user wants one key that works, not a decision about cost attribution.
     */
    async requireApiKey(scope: ApiKeyScope = "default"): Promise<string | undefined> {
        return (await this.getApiKey(scope)) ?? (await this.promptForApiKey());
    }

    async clearApiKey(scope: ApiKeyScope = "default"): Promise<void> {
        await this.secrets.delete(secretKeyFor(scope));
    }

    /** The reply text alone, for callers that have no use for what it cost. */
    async chat(request: ChatRequest, token?: vscode.CancellationToken): Promise<string> {
        return (await this.complete(request, token)).content;
    }

    async complete(request: ChatRequest, token?: vscode.CancellationToken): Promise<ChatResult> {
        const apiKey = await this.requireApiKey(request.keyScope ?? "default");
        if (!apiKey) {
            throw new OpenRouterError("No OpenRouter API key is configured.");
        }

        const controller = new AbortController();
        const cancellation = token?.onCancellationRequested(() => controller.abort());
        const timeout = AbortSignal.timeout(request.timeoutMs ?? REQUEST_TIMEOUT_MS);

        try {
            return await this.post(apiKey, request, AbortSignal.any([controller.signal, timeout]));
        } finally {
            cancellation?.dispose();
        }
    }

    private async post(apiKey: string, request: ChatRequest, signal: AbortSignal): Promise<ChatResult> {
        let response: Response;

        try {
            response = await fetch(`${Config.openRouterBaseUrl.replace(/\/+$/, "")}/chat/completions`, {
                method: "POST",
                signal,
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": APP_URL,
                    "X-Title": APP_TITLE,
                },
                body: JSON.stringify({
                    model: request.model ?? Config.openRouterModel,
                    messages: request.messages,
                    temperature: request.temperature,
                    max_tokens: request.maxTokens,
                }),
            });
        } catch (error) {
            if (signal.aborted) {
                throw new OpenRouterError("The OpenRouter request was cancelled or timed out.");
            }
            throw new OpenRouterError(`Could not reach OpenRouter: ${error instanceof Error ? error.message : String(error)}`);
        }

        // A body is not guaranteed to be JSON on gateway errors, so parsing has to be allowed to fail.
        let body: ChatResponseBody | undefined;
        try {
            body = (await response.json()) as ChatResponseBody;
        } catch {
            body = undefined;
        }

        if (!response.ok) {
            throw new OpenRouterError(describeFailure(response.status, body), response.status);
        }

        // OpenRouter also reports upstream provider failures inside a 200 response.
        if (body?.error) {
            throw new OpenRouterError(body.error.message?.trim() || "OpenRouter returned an error.", body.error.code);
        }

        const content = body?.choices?.[0]?.message?.content?.trim();
        if (!content) {
            throw new OpenRouterError("OpenRouter returned an empty response.");
        }

        return { content, usage: readUsage(body) };
    }
}

let client: OpenRouterClient | undefined;

export function getOpenRouter(): OpenRouterClient {
    if (!client) {
        throw new Error("The OpenRouter client was used before the extension finished activating.");
    }
    return client;
}

/**
 * Installs the shared client. Tests use it to reach the generation pipeline, which runs in the test
 * process rather than in the activated extension and so has a client of its own to fill in.
 */
export function setOpenRouter(next: OpenRouterClient | undefined): void {
    client = next;
}

/**
 * Asks which key to act on. The picker states what is set and what merely inherits, because the
 * difference is invisible otherwise and decides which key an OpenRouter invoice line belongs to.
 */
async function pickScope(openRouter: OpenRouterClient, title: string): Promise<ApiKeyScope | undefined> {
    const items = await Promise.all(
        API_KEY_SCOPES.map(async ({ scope, label, detail }) => {
            const stored = await openRouter.hasStoredKey(scope);
            const description = stored ? "set" : scope === "default" ? "not set" : "using the shared key";
            return { scope, label, detail, description };
        })
    );

    const picked = await vscode.window.showQuickPick(items, {
        title,
        placeHolder: "A feature with its own key gets its own line in OpenRouter's activity panel",
    });

    return picked?.scope;
}

/** Creates the shared client and registers the commands that manage its API keys. */
export function initOpenRouter(context: vscode.ExtensionContext): vscode.Disposable[] {
    const openRouter = new OpenRouterClient(context.secrets);
    setOpenRouter(openRouter);

    /** Always overwrites: the box starts empty, so there is nothing to edit and nothing to leak. */
    const saveKeyFor = async (scope: ApiKeyScope) => {
        if (await openRouter.promptForApiKey(scope)) {
            vscode.window.showInformationMessage(`OpenRouter API key saved for ${scopeLabel(scope)}.`);
        }
    };

    return [
        vscode.commands.registerCommand("myDevTools.setOpenRouterApiKey", async () => {
            const scope = await pickScope(openRouter, "Set OpenRouter API Key");
            if (scope) {
                await saveKeyFor(scope);
            }
        }),
        // One command per scope as well, so replacing a specific key is a single palette entry.
        ...API_KEY_SCOPES.map(({ scope, setCommand }) => vscode.commands.registerCommand(setCommand, () => saveKeyFor(scope))),
        vscode.commands.registerCommand("myDevTools.clearOpenRouterApiKey", async () => {
            const scope = await pickScope(openRouter, "Clear OpenRouter API Key");
            if (!scope) {
                return;
            }

            await openRouter.clearApiKey(scope);
            const fallback = scope === "default" ? "" : " It falls back to the shared key again.";
            vscode.window.showInformationMessage(`OpenRouter API key cleared for ${scopeLabel(scope)}.${fallback}`);
        }),
    ];
}

function scopeLabel(scope: ApiKeyScope): string {
    return API_KEY_SCOPES.find(entry => entry.scope === scope)?.label ?? scope;
}

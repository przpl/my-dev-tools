import * as vscode from "vscode";

import { Config } from "../utils/config";

/**
 * Minimal OpenRouter client over the REST API. Deliberately not the official SDK: the whole feature
 * is one POST, and a VS Code extension pays for every dependency in download size.
 */

const SECRET_KEY = "myDevTools.openRouter.apiKey";
const REQUEST_TIMEOUT_MS = 60_000;

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

    /** The stored key, falling back to the environment so CI and scratch profiles need no setup. */
    async getApiKey(): Promise<string | undefined> {
        const stored = await this.secrets.get(SECRET_KEY);
        return stored || process.env.OPENROUTER_API_KEY || undefined;
    }

    async promptForApiKey(): Promise<string | undefined> {
        const key = await vscode.window.showInputBox({
            title: "OpenRouter API Key",
            prompt: "Paste an API key from https://openrouter.ai/keys",
            password: true,
            ignoreFocusOut: true,
            validateInput: value => (value.trim().length === 0 ? "The key cannot be empty" : null),
        });

        if (!key) {
            return undefined;
        }

        await this.secrets.store(SECRET_KEY, key.trim());
        return key.trim();
    }

    /** Returns the stored key, asking for one if none is set yet. */
    async requireApiKey(): Promise<string | undefined> {
        return (await this.getApiKey()) ?? (await this.promptForApiKey());
    }

    async clearApiKey(): Promise<void> {
        await this.secrets.delete(SECRET_KEY);
    }

    async chat(request: ChatRequest, token?: vscode.CancellationToken): Promise<string> {
        const apiKey = await this.requireApiKey();
        if (!apiKey) {
            throw new OpenRouterError("No OpenRouter API key is configured.");
        }

        const controller = new AbortController();
        const cancellation = token?.onCancellationRequested(() => controller.abort());

        try {
            return await this.post(apiKey, request, AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]));
        } finally {
            cancellation?.dispose();
        }
    }

    private async post(apiKey: string, request: ChatRequest, signal: AbortSignal): Promise<string> {
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

        return content;
    }
}

let client: OpenRouterClient | undefined;

export function getOpenRouter(): OpenRouterClient {
    if (!client) {
        throw new Error("The OpenRouter client was used before the extension finished activating.");
    }
    return client;
}

/** Creates the shared client and registers the commands that manage its API key. */
export function initOpenRouter(context: vscode.ExtensionContext): vscode.Disposable[] {
    client = new OpenRouterClient(context.secrets);
    const openRouter = client;

    return [
        vscode.commands.registerCommand("myDevTools.setOpenRouterApiKey", async () => {
            if (await openRouter.promptForApiKey()) {
                vscode.window.showInformationMessage("OpenRouter API key saved.");
            }
        }),
        vscode.commands.registerCommand("myDevTools.clearOpenRouterApiKey", async () => {
            await openRouter.clearApiKey();
            vscode.window.showInformationMessage("OpenRouter API key cleared.");
        }),
    ];
}

import * as path from "node:path";
import * as vscode from "vscode";

import { getOpenRouter, type ChatUsage } from "../../services/openRouter";
import { Config } from "../../utils/config";
import { FileUtils } from "../../utils/fileUtils";
import { matchesAnyGlob } from "../../utils/globUtils";
import { loadAiCommands } from "./aiCommandRegistry";
import type { AiCommand } from "./aiCommandTypes";
import { applyChanges, openCreatedFiles } from "./applyResult";
import { buildPrompt, resolveCommand, type ContextFile, type PromptSelection, type PromptTarget } from "./promptBuilder";
import { parseFileBlocks, stripFence } from "./responseParser";
import { reviewChanges, type ProposedChange } from "./resultReview";
import { loadRules } from "./rulesLoader";
import type { VariableContext } from "./variables";

/**
 * Runs one user-defined command against the active editor: pick it, answer its questions, send the
 * file, review the result, apply it. Nothing about any particular command lives here — the whole
 * catalogue comes from the user's JSON.
 */

/** How many files a `contextFiles` glob may attach, so a careless `**\/*.ts` cannot empty a wallet. */
const MAX_CONTEXT_FILES = 5;

interface CommandItem extends vscode.QuickPickItem {
    command?: AiCommand;
}

function toItems(commands: AiCommand[]): CommandItem[] {
    return commands.map(command => ({
        label: command.title,
        description: command.source === "settings" ? "$(gear) settings" : undefined,
        detail: command.description,
        command,
    }));
}

async function pickCommand(commands: AiCommand[], relativePath: string): Promise<AiCommand | undefined> {
    const matching = commands.filter(command => matchesAnyGlob(relativePath, command.globs));
    const hidden = commands.length - matching.length;

    const items: CommandItem[] =
        hidden > 0
            ? [
                  ...toItems(matching),
                  { label: "$(list-unordered) Show all commands", detail: `${hidden} more do not apply to ${path.basename(relativePath)}` },
              ]
            : toItems(matching);

    const picked = await vscode.window.showQuickPick(items, {
        title: "Run AI Command",
        placeHolder: `Commands for ${path.basename(relativePath)}`,
        matchOnDescription: true,
        matchOnDetail: true,
    });

    if (!picked) {
        return undefined;
    }

    if (picked.command) {
        return picked.command;
    }

    return (await vscode.window.showQuickPick(toItems(commands), { title: "Run AI Command", placeHolder: "All commands" }))?.command;
}

/** Asks the command's questions in order. Undefined means the user cancelled a required one. */
async function askInputs(command: AiCommand): Promise<Record<string, string> | undefined> {
    const answers: Record<string, string> = {};

    for (const input of command.inputs) {
        const answer =
            input.type === "pick"
                ? await vscode.window.showQuickPick(input.options ?? [], {
                      title: command.title,
                      placeHolder: input.label,
                      ignoreFocusOut: true,
                  })
                : await vscode.window.showInputBox({
                      title: command.title,
                      prompt: input.label,
                      value: input.default,
                      placeHolder: input.placeholder,
                      ignoreFocusOut: true,
                      validateInput: value => (input.required && value.trim() === "" ? "This answer is required" : null),
                  });

        if (answer === undefined) {
            if (input.required) {
                return undefined;
            }

            answers[input.id] = "";
            continue;
        }

        answers[input.id] = answer;
    }

    return answers;
}

function relativeTo(folder: vscode.WorkspaceFolder, uri: vscode.Uri): string {
    return path.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/g, "/");
}

function buildVariableContext(
    folder: vscode.WorkspaceFolder,
    document: vscode.TextDocument,
    selectionText: string,
    inputs: Record<string, string>
): VariableContext {
    const file = document.uri.fsPath;

    return {
        file,
        relativeFile: relativeTo(folder, document.uri),
        fileBasename: path.basename(file),
        fileBasenameNoExtension: path.basename(file, path.extname(file)),
        fileDirname: path.dirname(file),
        languageId: document.languageId,
        workspaceFolder: folder.uri.fsPath,
        selection: selectionText,
        inputs,
    };
}

/**
 * The selection as coordinates the model can use, with an empty text standing for a bare caret.
 * A selection made by picking whole lines ends at column 1 of the line *after* the last one it
 * covers, so the end is pulled back onto the last selected character: reporting a line the user did
 * not select is how an off-by-one reaches the model as fact.
 */
function describeEditorSelection(editor: vscode.TextEditor): PromptSelection {
    const { start, end, isEmpty } = editor.selection;

    if (isEmpty) {
        const caret = { line: start.line + 1, column: start.character + 1 };
        return { text: "", start: caret, end: caret };
    }

    const lastLine = end.character === 0 && end.line > start.line ? end.line - 1 : end.line;
    const lastColumn = lastLine === end.line ? end.character : editor.document.lineAt(lastLine).text.length;

    return {
        text: editor.document.getText(editor.selection),
        start: { line: start.line + 1, column: start.character + 1 },
        end: { line: lastLine + 1, column: Math.max(lastColumn, 1) },
    };
}

async function collectContextFiles(folder: vscode.WorkspaceFolder, command: AiCommand, exclude: vscode.Uri): Promise<ContextFile[]> {
    if (!command.contextFiles?.length) {
        return [];
    }

    const found = new Map<string, vscode.Uri>();

    for (const glob of command.contextFiles) {
        const matches = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, glob), "**/node_modules/**", MAX_CONTEXT_FILES);

        for (const uri of matches) {
            if (uri.toString() !== exclude.toString() && found.size < MAX_CONTEXT_FILES) {
                found.set(uri.toString(), uri);
            }
        }
    }

    const files: ContextFile[] = [];

    for (const uri of found.values()) {
        const text = await FileUtils.readTextIfExists(uri);
        if (text !== undefined && text.length <= Config.aiMaxFileCharacters) {
            files.push({ relativePath: relativeTo(folder, uri), text });
        }
    }

    return files;
}

/** Model replies always use `\n`; a CRLF file must not be silently converted by an edit. */
function matchEol(text: string, eol: vscode.EndOfLine): string {
    const normalized = text.replace(/\r\n/g, "\n");
    return eol === vscode.EndOfLine.CRLF ? normalized.replace(/\n/g, "\r\n") : normalized;
}

/** Keeps the file's final newline, which models drop about as often as they keep it. */
function matchTrailingNewline(proposed: string, original: string, eol: vscode.EndOfLine): string {
    if (original === "" || !/\r?\n$/.test(original) || /\r?\n$/.test(proposed)) {
        return proposed;
    }

    return proposed + (eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n");
}

function replaced(document: vscode.TextDocument, range: vscode.Range, text: string): string {
    const full = document.getText();
    return full.slice(0, document.offsetAt(range.start)) + text + full.slice(document.offsetAt(range.end));
}

function formatCost(cost: number): string {
    if (cost < 0.0001) {
        return "<$0.0001";
    }

    return `$${cost.toFixed(cost < 1 ? 4 : 2)}`;
}

/**
 * What the run cost, reported as soon as the reply lands rather than after the review: the time
 * spent reading a diff is the user's, not the task's.
 */
function reportCost(command: AiCommand, elapsedMs: number, usage: ChatUsage | undefined): void {
    const parts = [`${(elapsedMs / 1000).toFixed(1)} s`];

    if (usage?.cost) {
        parts.push(formatCost(usage.cost));
    }
    if (usage?.promptTokens !== undefined && usage.completionTokens !== undefined) {
        parts.push(`${usage.promptTokens.toLocaleString()} → ${usage.completionTokens.toLocaleString()} tokens`);
    }

    vscode.window.showInformationMessage(`${command.title} · ${parts.join(" · ")}`);
}

/** Turns the reply into whole-file proposals, which is what a diff can be shown for. */
async function toChanges(
    reply: string,
    command: AiCommand,
    folder: vscode.WorkspaceFolder,
    document: vscode.TextDocument,
    range: vscode.Range | undefined
): Promise<ProposedChange[]> {
    const relativePath = relativeTo(folder, document.uri);
    const original = document.getText();

    if (command.output === "files") {
        const files = parseFileBlocks(reply);

        return Promise.all(
            files.map(async file => {
                const uri = vscode.Uri.joinPath(folder.uri, ...file.path.split("/"));
                const existing = await FileUtils.readTextIfExists(uri);
                const content = matchEol(file.content, document.eol);

                // A new file gets the final newline every linter wants; an existing one keeps whatever it had.
                const reference = existing ?? "\n";

                return {
                    uri,
                    relativePath: file.path,
                    original: existing ?? "",
                    proposed: matchTrailingNewline(content, reference, document.eol),
                    isNew: existing === undefined,
                };
            })
        );
    }

    const text = matchEol(stripFence(reply), document.eol);

    if (command.output === "replaceFile" || !range) {
        return [
            {
                uri: document.uri,
                relativePath,
                original,
                proposed: matchTrailingNewline(text, original, document.eol),
                isNew: false,
            },
        ];
    }

    const newline = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    const replacement = command.output === "insertBelow" ? document.getText(range) + newline + text : text;

    return [
        {
            uri: document.uri,
            relativePath,
            original,
            proposed: replaced(document, range, replacement),
            partial: { range, text: replacement },
            isNew: false,
        },
    ];
}

export async function runAiCommand(args?: { id?: string }): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage("Run AI Command: open a file first.");
        return;
    }

    const document = editor.document;
    const folder = FileUtils.resolveWorkspaceFolder(document.uri);
    if (!folder) {
        vscode.window.showErrorMessage("Run AI Command: this file does not belong to an open workspace folder.");
        return;
    }

    const { commands, problems } = await loadAiCommands(document.uri);
    if (problems.length > 0) {
        vscode.window.showWarningMessage(`Some AI commands were skipped. ${problems.join(" ")}`);
    }

    if (commands.length === 0) {
        const create = await vscode.window.showInformationMessage(
            "No AI commands are defined yet. They live in the workspace commands file or in the 'myDevTools.ai.commands' setting.",
            "Create commands file"
        );

        if (create) {
            await vscode.commands.executeCommand("myDevTools.editAiCommands");
        }
        return;
    }

    const relativePath = relativeTo(folder, document.uri);
    const definition = args?.id ? commands.find(command => command.id === args.id) : await pickCommand(commands, relativePath);

    if (!definition) {
        if (args?.id) {
            // Palette entries outlive the catalogue they were synced from, so a stale one lands here.
            vscode.window.showErrorMessage(
                `Run AI Command: no command with the id "${args.id}" is defined here. If it belongs to another project, run "AI: Sync Commands to Palette" to bring the palette back in step.`
            );
        }
        return;
    }

    const hasSelection = !editor.selection.isEmpty;
    const selectionText = hasSelection ? document.getText(editor.selection) : "";

    /**
     * With nothing selected there is nothing to target, so the command operates on the whole file.
     * Both halves have to move together: asking the model for a replacement snippet and then
     * treating the reply as a whole file would overwrite the file with a fragment.
     */
    const runnable: AiCommand = {
        ...definition,
        selection: definition.selection === "target" && !hasSelection ? "context" : definition.selection,
        output: definition.output === "replaceSelection" && !hasSelection ? "replaceFile" : definition.output,
    };

    const targetsSelection = runnable.selection === "target";
    const payload = targetsSelection ? selectionText : document.getText();

    if (payload.length > Config.aiMaxFileCharacters) {
        vscode.window.showErrorMessage(
            `Run AI Command: ${targetsSelection ? "the selection" : path.basename(relativePath)} is ${payload.length.toLocaleString()} characters, over the ${Config.aiMaxFileCharacters.toLocaleString()} allowed by 'myDevTools.ai.maxFileCharacters'.`
        );
        return;
    }

    const answers = await askInputs(runnable);
    if (!answers) {
        return;
    }

    const variables = buildVariableContext(folder, document, selectionText, answers);
    const command = resolveCommand(runnable, variables);

    const target: PromptTarget = {
        relativePath,
        languageId: document.languageId,
        text: document.getText(),
        selection: describeEditorSelection(editor),
    };

    const rules =
        command.rules || command.ruleFiles?.length
            ? await loadRules(folder, { relativePath, always: command.ruleFiles, matchPaths: command.rules })
            : [];

    const { system, user } = buildPrompt(command, target, {
        rules,
        contextFiles: await collectContextFiles(folder, command, document.uri),
        answers,
        newFilePathHint: command.newFilePath ? relativeTo(folder, vscode.Uri.file(resolveHint(command.newFilePath, variables))) : undefined,
    });

    // Held onto so the catch can tell a cancelled request, which is not news, from a failed one.
    let cancellation: vscode.CancellationToken | undefined;
    const started = Date.now();

    try {
        const result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: command.title, cancellable: true },
            async (_progress, token) => {
                cancellation = token;

                return await getOpenRouter().complete(
                    {
                        messages: [
                            { role: "system", content: system },
                            { role: "user", content: user },
                        ],
                        model: command.model ?? (Config.aiModel || undefined),
                        temperature: command.temperature ?? 0.2,
                        maxTokens: command.maxTokens,
                        timeoutMs: Config.aiRequestTimeoutSeconds * 1000,
                        keyScope: "aiCommands",
                    },
                    token
                );
            }
        );

        if (cancellation?.isCancellationRequested) {
            return;
        }

        reportCost(command, Date.now() - started, result.usage);

        if (command.output === "clipboard") {
            await vscode.env.clipboard.writeText(stripFence(result.content));
            vscode.window.showInformationMessage(`${command.title}: the result is on the clipboard.`);
            return;
        }

        // `insertBelow` uses the range even when it is empty: that range is the cursor.
        const editsRange = command.output === "insertBelow" || (command.output === "replaceSelection" && hasSelection);
        const changes = await toChanges(result.content, command, folder, document, editsRange ? editor.selection : undefined);
        const accepted = await reviewChanges(changes, command.title);

        if (accepted.length === 0) {
            return;
        }

        if (await applyChanges(accepted)) {
            await openCreatedFiles(accepted);
        } else {
            vscode.window.showErrorMessage(`${command.title}: the workspace rejected the edit.`);
        }
    } catch (error) {
        if (cancellation?.isCancellationRequested) {
            return;
        }

        vscode.window.showErrorMessage(`${command.title} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/** `newFilePath` is a real path template, so it is resolved before being made workspace-relative. */
function resolveHint(template: string, variables: VariableContext): string {
    const resolved = template.replace(/\$\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (original, name: string) => {
        const value = variables[name as keyof VariableContext];
        return typeof value === "string" ? value : original;
    });

    return path.isAbsolute(resolved) ? resolved : path.join(variables.workspaceFolder, resolved);
}

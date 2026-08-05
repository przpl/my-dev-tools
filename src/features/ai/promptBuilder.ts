import type { AiCommand, OutputMode } from "./aiCommandTypes";
import type { Rule } from "./rulesLoader";
import { resolveVariables, type VariableContext } from "./variables";

/**
 * Turns a command plus the editor's state into the two messages sent to the model. Deliberately
 * free of the `vscode` namespace: everything it needs arrives as plain data, which is what lets the
 * prompt be asserted on in a test rather than eyeballed in a log.
 *
 * The document is fenced in XML-ish tags rather than markdown fences because half the commands
 * operate on Markdown, where fences nest badly. When the whole file is sent, the selection is
 * described by its coordinates rather than quoted or marked up: quoting sends the same text twice,
 * and a marker injected into content the model must return almost verbatim is a marker that comes
 * back in the file.
 */

/** One-based line and column, as the editor's status bar shows them. */
export interface PromptPosition {
    line: number;
    column: number;
}

export interface PromptSelection {
    /** Empty when nothing is selected, in which case `start` and `end` are both the caret. */
    text: string;
    start: PromptPosition;
    /** Inclusive: the last selected character, not the one after it. */
    end: PromptPosition;
}

export interface PromptTarget {
    relativePath: string;
    languageId: string;
    text: string;
    selection?: PromptSelection;
}

export interface ContextFile {
    relativePath: string;
    text: string;
}

export interface PromptOptions {
    rules?: Rule[];
    contextFiles?: ContextFile[];
    /** Answers to the command's questions, keyed by input id. */
    answers?: Record<string, string>;
    /** Already-resolved `newFilePath`, passed to the model as a suggestion. */
    newFilePathHint?: string;
}

export interface BuiltPrompt {
    system: string;
    user: string;
}

const BASE_INSTRUCTIONS = [
    "You are an automated editing assistant running inside VS Code, working on one file of the user's project.",
    "",
    "- Carry out the task exactly, and change nothing the task did not ask you to change.",
    "- Match the surrounding code: its indentation, quoting, naming and import style.",
    "- Never explain yourself, apologise, or add commentary outside the output described below.",
    "- Never wrap your answer in a markdown code fence.",
].join("\n");

const OUTPUT_INSTRUCTIONS: Record<OutputMode, string> = {
    replaceFile: [
        "Reply with the complete new contents of the file and nothing else.",
        "The reply replaces the file verbatim, so an abbreviated file, a diff, or a placeholder such as",
        '"// ...rest unchanged..." destroys the user\'s work. If the task needs no change, reply with the file exactly as given.',
    ].join("\n"),
    replaceSelection: [
        "Reply with the replacement for the selected text and nothing else.",
        "Do not repeat the rest of the file, and keep the same leading indentation the selection has.",
    ].join("\n"),
    insertBelow: [
        "Reply with the text to insert on a new line below the selection, and nothing else.",
        "Do not repeat the selection or the rest of the file.",
    ].join("\n"),
    clipboard: "Reply with the requested text and nothing else.",
    files: [
        "Reply with one or more file blocks and nothing else:",
        "",
        '<file path="relative/path/from/the/workspace/root.ts">',
        "the complete contents of the file",
        "</file>",
        "",
        "Paths are relative to the workspace root and use forward slashes. Write each file out in full;",
        "a partial file cannot be saved. Existing files at those paths are overwritten.",
    ].join("\n"),
};

function block(tag: string, body: string, attributes = ""): string {
    return `<${tag}${attributes}>\n${body}\n</${tag}>`;
}

function at(position: PromptPosition): string {
    return `${position.line}:${position.column}`;
}

/**
 * Where the selection is, without saying what it is: its text is already in the `<file>` block, and
 * sending it twice both costs tokens and invites the model to treat the copy as the thing to edit.
 * Coordinates are enough for the cases that need them — renaming what is selected, extracting it,
 * documenting it — and a bare caret is worth reporting for the same reason: it is what a task
 * saying "this function" refers to.
 */
function describeSelection(selection: PromptSelection): string {
    if (selection.text === "") {
        return (
            `<cursor at="${at(selection.start)}" />\n\n` +
            `Nothing is selected. The caret sits at line ${selection.start.line}, column ${selection.start.column} of the file above ` +
            '(both counted from 1). Resolve anything the task leaves implicit — "this function", "the symbol here" — against that position.'
        );
    }

    const attributes = ` start="${at(selection.start)}" end="${at(selection.end)}" characters="${selection.text.length}"`;

    return (
        `<selection${attributes} />\n\n` +
        `The user has selected line ${selection.start.line}, column ${selection.start.column} through line ${selection.end.line}, ` +
        `column ${selection.end.column} of the file above, inclusive, both counted from 1. That text is already part of the file ` +
        "above and is not repeated here. The task is about that range; the rest of the file is context for it."
    );
}

export function buildSystemPrompt(command: AiCommand, options: PromptOptions = {}): string {
    const parts = [BASE_INSTRUCTIONS, OUTPUT_INSTRUCTIONS[command.output]];

    if (command.output === "files" && options.newFilePathHint) {
        parts.push(
            `Suggested location for the file this task produces: \`${options.newFilePathHint}\`.`,
            "Use it unless the project's own conventions clearly call for somewhere else."
        );
    }

    if (command.system?.trim()) {
        parts.push(command.system.trim());
    }

    return parts.join("\n\n");
}

export function buildUserPrompt(command: AiCommand, target: PromptTarget, options: PromptOptions = {}): string {
    const parts = [block("task", command.prompt.trim())];

    const answers = command.inputs
        .map(input => ({ input, value: (options.answers?.[input.id] ?? "").trim() }))
        .filter(entry => entry.value !== "")
        .map(entry => `- ${entry.input.label}: ${entry.value}`);

    if (answers.length > 0) {
        parts.push(block("answers", answers.join("\n")));
    }

    if (options.rules?.length) {
        const rules = options.rules.map(rule => block("rule", rule.body, ` name="${rule.name}"`)).join("\n\n");
        parts.push(`${block("project_rules", rules)}\n\nThese rules are how this project writes code. Follow them.`);
    }

    if (options.contextFiles?.length) {
        const files = options.contextFiles.map(file => block("file", file.text, ` path="${file.relativePath}"`)).join("\n\n");
        parts.push(`${block("context_files", files)}\n\nThese files are context only. Do not rewrite them.`);
    }

    if (command.selection === "target" && target.selection?.text) {
        const { start, end } = target.selection;
        const attributes = ` path="${target.relativePath}" language="${target.languageId}" start="${at(start)}" end="${at(end)}"`;
        parts.push(block("selected_text", target.selection.text, attributes));
    } else {
        parts.push(block("file", target.text, ` path="${target.relativePath}" language="${target.languageId}"`));

        if (command.selection === "context" && target.selection) {
            parts.push(describeSelection(target.selection));
        }
    }

    return parts.join("\n\n");
}

export function buildPrompt(command: AiCommand, target: PromptTarget, options: PromptOptions = {}): BuiltPrompt {
    return { system: buildSystemPrompt(command, options), user: buildUserPrompt(command, target, options) };
}

/** Resolves every placeholder in the command's text fields against the run's context. */
export function resolveCommand(command: AiCommand, context: VariableContext): AiCommand {
    return {
        ...command,
        prompt: resolveVariables(command.prompt, context),
        system: command.system ? resolveVariables(command.system, context) : undefined,
    };
}

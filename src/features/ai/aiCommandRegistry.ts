import { parse as parseJsonc, printParseErrorCode, type ParseError } from "jsonc-parser";
import * as vscode from "vscode";

import { Config } from "../../utils/config";
import { FileUtils } from "../../utils/fileUtils";
import type { AiCommand, AiCommandInput, InputType, OutputMode, SelectionMode } from "./aiCommandTypes";

/**
 * Loads the command catalogue from the two places it can live and merges them: settings hold the
 * commands that make sense anywhere ("fix grammar"), the workspace file holds the ones that only
 * make sense here ("add props"). The file wins on a shared id, so a project can shadow a global
 * command without the user having to remember which of the two they edited last.
 *
 * A malformed definition is *reported*, never thrown: one typo should cost one command, not the
 * whole catalogue.
 */

const SELECTION_MODES: SelectionMode[] = ["ignore", "context", "target"];
const OUTPUT_MODES: OutputMode[] = ["replaceFile", "replaceSelection", "files", "insertBelow", "clipboard"];
const INPUT_TYPES: InputType[] = ["text", "pick"];

export interface LoadedCommands {
    commands: AiCommand[];
    /** One line per rejected definition, ready to show as a single warning. */
    problems: string[];
}

class DefinitionError extends Error {}

function fail(message: string): never {
    throw new DefinitionError(message);
}

/** A prompt is a string or, so long JSON prompts stay readable, an array of lines. */
function readText(value: unknown, field: string): string | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }

    if (typeof value === "string") {
        return value;
    }

    if (Array.isArray(value) && value.every(line => typeof line === "string")) {
        return value.join("\n");
    }

    fail(`"${field}" must be a string or an array of strings`);
}

function readStringArray(value: unknown, field: string): string[] | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }

    if (!Array.isArray(value) || !value.every(entry => typeof entry === "string")) {
        fail(`"${field}" must be an array of strings`);
    }

    return value.length > 0 ? (value as string[]) : undefined;
}

function readEnum<T extends string>(value: unknown, allowed: T[], field: string, fallback: T): T {
    if (value === undefined || value === null) {
        return fallback;
    }

    if (typeof value !== "string" || !allowed.includes(value as T)) {
        fail(`"${field}" must be one of ${allowed.map(entry => `"${entry}"`).join(", ")}`);
    }

    return value as T;
}

function readNumber(value: unknown, field: string): number | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }

    if (typeof value !== "number" || !Number.isFinite(value)) {
        fail(`"${field}" must be a number`);
    }

    return value;
}

function readInputs(value: unknown): AiCommandInput[] {
    if (value === undefined || value === null) {
        return [];
    }

    if (!Array.isArray(value)) {
        fail(`"inputs" must be an array`);
    }

    return value.map((raw, index) => {
        const entry = raw as Record<string, unknown>;
        const field = `inputs[${index}]`;

        if (typeof entry?.id !== "string" || entry.id.trim() === "") {
            fail(`${field} needs an "id"`);
        }
        if (typeof entry.label !== "string" || entry.label.trim() === "") {
            fail(`${field} needs a "label"`);
        }

        const type = readEnum(entry.type, INPUT_TYPES, `${field}.type`, "text");
        const options = readStringArray(entry.options, `${field}.options`);

        if (type === "pick" && !options) {
            fail(`${field} is a pick and needs "options"`);
        }

        return {
            id: entry.id,
            label: entry.label,
            type,
            required: entry.required === true,
            options,
            default: typeof entry.default === "string" ? entry.default : undefined,
            placeholder: typeof entry.placeholder === "string" ? entry.placeholder : undefined,
        };
    });
}

/** Validates one definition into a command, or explains in one line why it cannot be one. */
export function parseAiCommand(raw: unknown, source: AiCommand["source"]): AiCommand | string {
    const entry = raw as Record<string, unknown>;

    try {
        if (typeof entry?.id !== "string" || entry.id.trim() === "") {
            fail(`a command needs an "id"`);
        }
        if (typeof entry.title !== "string" || entry.title.trim() === "") {
            fail(`needs a "title"`);
        }

        const prompt = readText(entry.prompt, "prompt");
        if (!prompt?.trim()) {
            fail(`needs a "prompt"`);
        }

        const selection = readEnum(entry.selection, SELECTION_MODES, "selection", "context");
        const output = readEnum(entry.output, OUTPUT_MODES, "output", selection === "target" ? "replaceSelection" : "replaceFile");

        if (output === "files" && selection === "target") {
            fail(`"output": "files" cannot be combined with "selection": "target", which replaces the selection`);
        }

        return {
            id: entry.id.trim(),
            title: entry.title.trim(),
            description: typeof entry.description === "string" ? entry.description : undefined,
            prompt,
            system: readText(entry.system, "system"),
            globs: readStringArray(entry.globs, "globs"),
            selection,
            output,
            newFilePath: typeof entry.newFilePath === "string" ? entry.newFilePath : undefined,
            inputs: readInputs(entry.inputs),
            rules: entry.rules !== false,
            ruleFiles: readStringArray(entry.ruleFiles, "ruleFiles"),
            contextFiles: readStringArray(entry.contextFiles, "contextFiles"),
            model: typeof entry.model === "string" && entry.model.trim() !== "" ? entry.model.trim() : undefined,
            temperature: readNumber(entry.temperature, "temperature"),
            maxTokens: readNumber(entry.maxTokens, "maxTokens"),
            source,
        };
    } catch (error) {
        const name = typeof entry?.id === "string" ? entry.id : "<unnamed>";
        return `${source === "file" ? "Commands file" : "Settings"}: "${name}" ${error instanceof DefinitionError ? error.message : String(error)}`;
    }
}

function parseAll(definitions: unknown[], source: AiCommand["source"], into: LoadedCommands): void {
    for (const definition of definitions) {
        const parsed = parseAiCommand(definition, source);

        if (typeof parsed === "string") {
            into.problems.push(parsed);
            continue;
        }

        // The file is parsed last, so it replaces rather than duplicates a settings command's id.
        const existing = into.commands.findIndex(command => command.id === parsed.id);
        if (existing === -1) {
            into.commands.push(parsed);
        } else {
            into.commands[existing] = parsed;
        }
    }
}

/** The workspace file's path, whether or not it exists yet. */
export function aiCommandsFileUri(folder: vscode.WorkspaceFolder): vscode.Uri {
    return vscode.Uri.joinPath(folder.uri, ...Config.aiCommandsFile.split(/[\\/]/).filter(segment => segment !== ""));
}

/** The definitions in the workspace file. Comments and trailing commas are allowed. */
export async function readCommandsFile(folder: vscode.WorkspaceFolder, into: LoadedCommands): Promise<void> {
    const uri = aiCommandsFileUri(folder);
    const text = await FileUtils.readTextIfExists(uri);

    if (text === undefined) {
        return;
    }

    const errors: ParseError[] = [];
    const parsed = parseJsonc(text, errors, { allowTrailingComma: true }) as { commands?: unknown };

    if (errors.length > 0) {
        into.problems.push(`${Config.aiCommandsFile} is not valid JSON: ${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset}`);
        return;
    }

    if (parsed === undefined || parsed === null) {
        return;
    }

    if (!Array.isArray(parsed.commands)) {
        into.problems.push(`${Config.aiCommandsFile} must be an object with a "commands" array`);
        return;
    }

    parseAll(parsed.commands, "file", into);
}

/**
 * Settings first, then the workspace file belonging to the edited document. Read fresh on every
 * run: this extension keeps no configuration listeners, and a catalogue is cheap to rebuild.
 */
export async function loadAiCommands(documentUri?: vscode.Uri): Promise<LoadedCommands> {
    const loaded: LoadedCommands = { commands: [], problems: [] };

    parseAll(Config.aiCommands, "settings", loaded);

    const folder = FileUtils.resolveWorkspaceFolder(documentUri);
    if (folder) {
        await readCommandsFile(folder, loaded);
    }

    return loaded;
}

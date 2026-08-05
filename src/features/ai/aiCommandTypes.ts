/**
 * The shape of a user-defined AI command. Nothing here is hardcoded: every command comes from
 * `myDevTools.ai.commands` or the workspace's commands file, and this is the contract between the
 * JSON they write (mirrored in `schemas/ai-commands.schema.json`) and the runner.
 */

/** How the editor's selection reaches the model, and what comes back changed. */
export type SelectionMode =
    /** The selection is never mentioned. */
    | "ignore"
    /** The whole file is sent, the selected range is pointed at by its coordinates, and the whole file is rewritten. */
    | "context"
    /** Only the selected text is sent and replaced. Falls back to the whole file when nothing is selected. */
    | "target";

export type OutputMode = "replaceFile" | "replaceSelection" | "files" | "insertBelow" | "clipboard";

export type InputType = "text" | "pick";

export interface AiCommandInput {
    id: string;
    label: string;
    type: InputType;
    required: boolean;
    options?: string[];
    default?: string;
    placeholder?: string;
}

export interface AiCommand {
    id: string;
    title: string;
    description?: string;
    prompt: string;
    system?: string;
    globs?: string[];
    selection: SelectionMode;
    output: OutputMode;
    newFilePath?: string;
    inputs: AiCommandInput[];
    rules: boolean;
    ruleFiles?: string[];
    contextFiles?: string[];
    model?: string;
    temperature?: number;
    maxTokens?: number;
    /** Where the definition came from, so a duplicate id can explain which one won. */
    source: "settings" | "file";
}

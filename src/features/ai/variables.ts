/**
 * The placeholders a command's `prompt`, `system` and `newFilePath` can use. The names follow VS
 * Code's own variable syntax, so a command author can reuse what they already know from
 * `tasks.json`. An unknown variable is deliberately left in place rather than blanked: a typo that
 * reaches the model as literal `${inupt:x}` is one the user can see and fix.
 */

export interface VariableContext {
    /** Absolute path of the edited file. */
    file: string;
    /** Workspace-relative path, forward slashes. */
    relativeFile: string;
    fileBasename: string;
    fileBasenameNoExtension: string;
    fileDirname: string;
    languageId: string;
    workspaceFolder: string;
    selection: string;
    /** Answers to the command's questions, keyed by input id. */
    inputs: Record<string, string>;
}

const PLACEHOLDER = /\$\{([a-zA-Z][a-zA-Z0-9]*)(?::([^}]*))?\}/g;

export function resolveVariables(template: string, context: VariableContext): string {
    return template.replace(PLACEHOLDER, (original, name: string, argument: string | undefined) => {
        if (name === "input") {
            return argument !== undefined && argument in context.inputs ? context.inputs[argument] : original;
        }

        if (argument !== undefined) {
            return original;
        }

        const value = context[name as keyof VariableContext];
        return typeof value === "string" ? value : original;
    });
}

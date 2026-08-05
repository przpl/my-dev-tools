import * as assert from "assert";
import * as vscode from "vscode";

import { loadAiCommands, parseAiCommand, readCommandsFile, type LoadedCommands } from "../../../features/ai/aiCommandRegistry";
import type { AiCommand } from "../../../features/ai/aiCommandTypes";
import { createTempDir, removeTempDir, writeFile } from "../../helpers/tempDir";

/**
 * The catalogue is user-written JSON, so the two things worth pinning down are that a typo costs one
 * command rather than all of them, and that a project can shadow a global command by reusing its id.
 */

function command(raw: unknown): AiCommand {
    const parsed = parseAiCommand(raw, "settings");
    assert.ok(typeof parsed !== "string", `expected a command, got: ${parsed}`);
    return parsed;
}

function problem(raw: unknown): string {
    const parsed = parseAiCommand(raw, "settings");
    assert.ok(typeof parsed === "string", "expected the definition to be rejected");
    return parsed;
}

const minimal = { id: "shorten", title: "Make it shorter", prompt: "Shorten this." };

suite("AI Command Registry Tests", () => {
    let directory: string;
    let folder: vscode.WorkspaceFolder;
    let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

    setup(() => {
        directory = createTempDir("ai-commands");
        folder = { uri: vscode.Uri.file(directory), name: "temp", index: 0 };
        originalGetConfiguration = vscode.workspace.getConfiguration;
    });

    teardown(() => {
        vscode.workspace.getConfiguration = originalGetConfiguration;
        removeTempDir(directory);
    });

    /** Config reads the section fresh on every access, so the whole section is stubbed at once. */
    function stubSettings(values: Record<string, unknown>): void {
        vscode.workspace.getConfiguration = (() => ({
            get: (key: string, fallback: unknown) => (key in values ? values[key] : fallback),
        })) as unknown as typeof vscode.workspace.getConfiguration;
    }

    function empty(): LoadedCommands {
        return { commands: [], problems: [] };
    }

    suite("parsing", () => {
        test("should fill in the defaults a minimal command relies on", () => {
            const parsed = command(minimal);

            assert.strictEqual(parsed.selection, "context");
            assert.strictEqual(parsed.output, "replaceFile", "a context command rewrites the file it was given");
            assert.strictEqual(parsed.rules, true, "rules are attached unless the command opts out");
            assert.deepStrictEqual(parsed.inputs, []);
            assert.strictEqual(parsed.globs, undefined, "no globs means the command is offered everywhere");
        });

        test("should default a selection-targeting command to replacing the selection", () => {
            assert.strictEqual(command({ ...minimal, selection: "target" }).output, "replaceSelection");
        });

        test("should join an array prompt into lines", () => {
            assert.strictEqual(command({ ...minimal, prompt: ["first", "second"] }).prompt, "first\nsecond");
        });

        test("should reject a command that cannot be run", () => {
            assert.match(problem({ title: "No id", prompt: "x" }), /needs an "id"/);
            assert.match(problem({ id: "a", prompt: "x" }), /needs a "title"/);
            assert.match(problem({ id: "a", title: "A" }), /needs a "prompt"/);
            assert.match(problem({ ...minimal, selection: "sideways" }), /"selection" must be one of/);
            assert.match(problem({ ...minimal, globs: [1, 2] }), /"globs" must be an array of strings/);
        });

        test("should name the offending command so the warning is actionable", () => {
            assert.match(problem({ id: "broken", title: "Broken" }), /Settings: "broken" needs a "prompt"/);
        });

        test("should reject a combination that has no meaning", () => {
            assert.match(problem({ ...minimal, selection: "target", output: "files" }), /cannot be combined/);
        });

        test("should require a pick to have something to pick from", () => {
            assert.match(problem({ ...minimal, inputs: [{ id: "f", label: "Framework", type: "pick" }] }), /needs "options"/);
            assert.strictEqual(command({ ...minimal, inputs: [{ id: "f", label: "F", type: "pick", options: ["a"] }] }).inputs.length, 1);
        });

        test("should treat an optional question as optional", () => {
            const parsed = command({ ...minimal, inputs: [{ id: "note", label: "Note" }] });

            assert.strictEqual(parsed.inputs[0].required, false);
            assert.strictEqual(parsed.inputs[0].type, "text");
        });
    });

    suite("loading", () => {
        test("should read the workspace file, comments and all", async () => {
            writeFile(
                directory,
                ".vscode/ai-commands.json",
                `{
                    // The project's own commands.
                    "commands": [
                        { "id": "add-props", "title": "Add props", "prompt": "Add them.", "globs": ["**/*.tsx"] },
                    ]
                }`
            );

            const loaded = empty();
            await readCommandsFile(folder, loaded);

            assert.deepStrictEqual(loaded.problems, []);
            assert.strictEqual(loaded.commands.length, 1);
            assert.strictEqual(loaded.commands[0].source, "file");
            assert.deepStrictEqual(loaded.commands[0].globs, ["**/*.tsx"]);
        });

        test("should let the workspace file shadow a settings command of the same id", async () => {
            writeFile(directory, ".vscode/ai-commands.json", JSON.stringify({ commands: [{ ...minimal, title: "Project version" }] }));

            const loaded: LoadedCommands = { commands: [command(minimal)], problems: [] };
            await readCommandsFile(folder, loaded);

            assert.strictEqual(loaded.commands.length, 1, "the id is shadowed, not duplicated");
            assert.strictEqual(loaded.commands[0].title, "Project version");
            assert.strictEqual(loaded.commands[0].source, "file");
        });

        test("should keep the good commands when one of them is malformed", async () => {
            writeFile(
                directory,
                ".vscode/ai-commands.json",
                JSON.stringify({ commands: [minimal, { id: "broken", title: "Broken" }, { ...minimal, id: "second" }] })
            );

            const loaded = empty();
            await readCommandsFile(folder, loaded);

            assert.deepStrictEqual(
                loaded.commands.map(entry => entry.id),
                ["shorten", "second"]
            );
            assert.strictEqual(loaded.problems.length, 1);
        });

        test("should report unparseable JSON rather than throwing", async () => {
            writeFile(directory, ".vscode/ai-commands.json", "{ this is not json");

            const loaded = empty();
            await readCommandsFile(folder, loaded);

            assert.strictEqual(loaded.commands.length, 0);
            assert.match(loaded.problems[0], /not valid JSON/);
        });

        test("should say so when the file has no commands array", async () => {
            writeFile(directory, ".vscode/ai-commands.json", JSON.stringify({ command: [] }));

            const loaded = empty();
            await readCommandsFile(folder, loaded);

            assert.match(loaded.problems[0], /"commands" array/);
        });

        test("should be silent when there is no file", async () => {
            const loaded = empty();
            await readCommandsFile(folder, loaded);

            assert.deepStrictEqual(loaded, empty());
        });

        test("should load the commands defined in settings", async () => {
            stubSettings({ "ai.commands": [minimal], "ai.commandsFile": ".vscode/ai-commands.json" });

            const loaded = await loadAiCommands();

            assert.strictEqual(loaded.commands.length, 1);
            assert.strictEqual(loaded.commands[0].source, "settings");
        });
    });
});

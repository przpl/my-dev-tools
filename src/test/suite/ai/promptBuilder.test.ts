import * as assert from "assert";

import { parseAiCommand } from "../../../features/ai/aiCommandRegistry";
import type { AiCommand } from "../../../features/ai/aiCommandTypes";
import { buildPrompt, resolveCommand, type PromptTarget } from "../../../features/ai/promptBuilder";
import { resolveVariables, type VariableContext } from "../../../features/ai/variables";

/**
 * The prompt is the feature: everything else moves text around. These assertions are on what the
 * model is and is not told, which is the part that cannot be noticed from the outside until it is
 * already wrong.
 */

function command(raw: Record<string, unknown>): AiCommand {
    const parsed = parseAiCommand({ id: "c", title: "Command", prompt: "Do the thing.", ...raw }, "file");
    assert.ok(typeof parsed !== "string", `expected a command, got: ${parsed}`);
    return parsed;
}

const variables: VariableContext = {
    file: "D:/project/src/date.ts",
    relativeFile: "src/date.ts",
    fileBasename: "date.ts",
    fileBasenameNoExtension: "date",
    fileDirname: "D:/project/src",
    languageId: "typescript",
    workspaceFolder: "D:/project",
    selection: "const a = 1;",
    inputs: { framework: "vitest" },
};

const target: PromptTarget = {
    relativePath: "src/date.ts",
    languageId: "typescript",
    text: "export function format() {\n    return 1;\n}\n",
    selection: { text: "    return 1;", start: { line: 2, column: 1 }, end: { line: 2, column: 13 } },
};

/** How many times the model is shown a piece of text, which is the point of the selection tests. */
function occurrences(haystack: string, needle: string): number {
    return haystack.split(needle).length - 1;
}

suite("Prompt Builder Tests", () => {
    suite("variables", () => {
        test("should substitute answers and file variables", () => {
            assert.strictEqual(
                resolveVariables("Test ${fileBasename} with ${input:framework} in ${fileDirname}", variables),
                "Test date.ts with vitest in D:/project/src"
            );
        });

        test("should leave an unknown variable visible rather than blanking it", () => {
            assert.strictEqual(resolveVariables("${inupt:framework} ${nonsense}", variables), "${inupt:framework} ${nonsense}");
        });

        test("should substitute an unanswered optional question with nothing", () => {
            assert.strictEqual(resolveVariables("Focus: ${input:focus}", { ...variables, inputs: { focus: "" } }), "Focus: ");
        });

        test("should resolve the command's prompt and system text", () => {
            const resolved = resolveCommand(command({ prompt: "Test ${fileBasename}", system: "In ${languageId}" }), variables);

            assert.strictEqual(resolved.prompt, "Test date.ts");
            assert.strictEqual(resolved.system, "In typescript");
        });
    });

    suite("system prompt", () => {
        test("should tell a whole-file command that an abbreviated answer destroys the file", () => {
            const { system } = buildPrompt(command({}), target);

            assert.match(system, /complete new contents of the file/);
            assert.match(system, /rest unchanged/);
        });

        test("should describe the file block protocol for a file-producing command", () => {
            const { system } = buildPrompt(command({ output: "files" }), target, { newFilePathHint: "src/date.test.ts" });

            assert.match(system, /<file path="relative\/path/);
            assert.match(system, /Suggested location.*src\/date\.test\.ts/);
        });

        test("should append the command's own system text", () => {
            assert.match(buildPrompt(command({ system: "Never use classes." }), target).system, /Never use classes\./);
        });
    });

    suite("user prompt", () => {
        test("should send the whole file with the selection given as coordinates", () => {
            const { user } = buildPrompt(command({ selection: "context" }), target);

            assert.match(user, /<file path="src\/date\.ts" language="typescript">/);
            assert.match(user, /<selection start="2:1" end="2:13" characters="13" \/>/);
            assert.match(user, /line 2, column 1 through line 2, column 13/);
        });

        test("should not send the selected text twice", () => {
            const { user } = buildPrompt(command({ selection: "context" }), target);

            assert.strictEqual(occurrences(user, "    return 1;"), 1, `the selection is quoted beside the file it is already in:\n${user}`);
        });

        test("should report a bare caret as the position the task is implicitly about", () => {
            const caret = { ...target, selection: { text: "", start: { line: 2, column: 5 }, end: { line: 2, column: 5 } } };
            const { user } = buildPrompt(command({ selection: "context" }), caret);

            assert.match(user, /<cursor at="2:5" \/>/);
            assert.match(user, /Nothing is selected/);
        });

        test("should send only the selection when the command targets it", () => {
            const { user } = buildPrompt(command({ selection: "target" }), target);

            assert.match(user, /<selected_text path="src\/date\.ts" language="typescript" start="2:1" end="2:13">/);
            assert.ok(!user.includes("export function format"), "the rest of the file is not the model's business here");
        });

        test("should fall back to the whole file when a targeting command has nothing selected", () => {
            const caret = { ...target, selection: { text: "", start: { line: 1, column: 1 }, end: { line: 1, column: 1 } } };
            const { user } = buildPrompt(command({ selection: "target" }), caret);

            assert.ok(!user.includes("<selected_text"), "there is no selected text to send");
            assert.match(user, /<file path="src\/date\.ts"/);
        });

        test("should never mention the selection when the command ignores it", () => {
            const { user } = buildPrompt(command({ selection: "ignore" }), target);

            assert.ok(!user.includes("<selection") && !user.includes("<cursor"), user);
            assert.match(user, /<file path="src\/date\.ts"/);
        });

        test("should include the answers under the labels they were asked with", () => {
            const withInputs = command({ inputs: [{ id: "framework", label: "Test framework" }] });
            const { user } = buildPrompt(withInputs, target, { answers: { framework: "vitest" } });

            assert.match(user, /- Test framework: vitest/);
        });

        test("should leave out a question that went unanswered", () => {
            const withInputs = command({ inputs: [{ id: "focus", label: "Focus" }] });
            const { user } = buildPrompt(withInputs, target, { answers: { focus: "  " } });

            assert.ok(!user.includes("<answers>"), user);
        });

        test("should attach the rules as instructions to follow", () => {
            const { user } = buildPrompt(command({}), target, { rules: [{ name: "typescript.md", body: "- Prefer unknown" }] });

            assert.match(user, /<rule name="typescript\.md">/);
            assert.match(user, /Follow them/);
        });

        test("should mark context files as reference rather than work", () => {
            const { user } = buildPrompt(command({}), target, { contextFiles: [{ relativePath: "src/other.test.ts", text: "test()" }] });

            assert.match(user, /<context_files>/);
            assert.match(user, /Do not rewrite them/);
        });
    });
});

import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

import { COMMIT_EDITOR_FILE_NAME } from "../../features/git/commitMessageEditor";
import { DEFAULT_COMMIT_MESSAGE_EXCLUDES } from "../../utils/config";

/**
 * The manifest is a contract no other test can see: a command missing from `contributes` is invisible
 * in the palette, one missing from `extension.ts` is a dead menu item, and a setting whose declared
 * default disagrees with the code fallback silently ships the declared one.
 */

interface Manifest {
    contributes: {
        commands: { command: string }[];
        configuration: { properties: Record<string, { default?: unknown }> };
        languages: { filenames?: string[] }[];
        menus: Record<string, { command?: string; when?: string }[]>;
        keybindings: { command: string; when?: string }[];
    };
}

const EXTENSION_ID = "przpl.my-dev-tools";

/** Every `config.get` in `config.ts`, as the key it reads and the fallback it passes. */
function readCodeDefaults(extensionPath: string): Map<string, unknown> {
    const source = fs.readFileSync(path.join(extensionPath, "src", "utils", "config.ts"), "utf8");
    const defaults = new Map<string, unknown>();

    for (const [, key, literal] of source.matchAll(/this\.config\.get<[^>]*>\("([^"]+)",\s*([\s\S]*?)\);/g)) {
        // The one fallback that is not a literal; it is exported so this test can compare it.
        defaults.set(`myDevTools.${key}`, literal === "DEFAULT_COMMIT_MESSAGE_EXCLUDES" ? DEFAULT_COMMIT_MESSAGE_EXCLUDES : JSON.parse(literal));
    }

    return defaults;
}

suite("Manifest Tests", () => {
    let extension: vscode.Extension<unknown>;
    let manifest: Manifest;

    suiteSetup(async () => {
        const found = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(found, `${EXTENSION_ID} is not loaded`);

        await found.activate();
        extension = found;
        manifest = found.packageJSON as Manifest;
    });

    function contributedCommands(): string[] {
        return manifest.contributes.commands.map(entry => entry.command);
    }

    async function registeredCommands(): Promise<string[]> {
        return (await vscode.commands.getCommands(true)).filter(command => command.startsWith("myDevTools."));
    }

    test("should register every contributed command", async () => {
        const registered = new Set(await registeredCommands());

        assert.deepStrictEqual(
            contributedCommands().filter(command => !registered.has(command)),
            []
        );
    });

    test("should contribute every registered command", async () => {
        const contributed = new Set(contributedCommands());

        assert.deepStrictEqual(
            (await registeredCommands()).filter(command => !contributed.has(command)),
            []
        );
    });

    test("should declare every setting the code reads", () => {
        const declared = manifest.contributes.configuration.properties;
        const codeDefaults = readCodeDefaults(extension.extensionPath);

        // A regex over the source is only as good as its match count; this guards against it silently
        // reading nothing after `config.ts` is reformatted.
        assert.strictEqual(codeDefaults.size, 11, "Expected 11 settings in config.ts");

        assert.deepStrictEqual(
            [...codeDefaults.keys()].filter(key => !(key in declared)),
            []
        );
    });

    test("should declare the same default the code falls back to", () => {
        // The declared default wins at runtime, so a disagreement makes the code fallback dead text.
        const declared = manifest.contributes.configuration.properties;

        for (const [key, codeDefault] of readCodeDefaults(extension.extensionPath)) {
            assert.deepStrictEqual(declared[key]?.default, codeDefault, key);
        }
    });

    test("should name the commit editor's file the way the code does", () => {
        const whenClauses = [
            ...Object.values(manifest.contributes.menus).flatMap(items => items.map(item => item.when)),
            ...manifest.contributes.keybindings.map(binding => binding.when),
        ].filter((when): when is string => when !== undefined && when.includes("resourceFilename"));

        assert.strictEqual(whenClauses.length, 5, "Expected the commit editor's contributions to be matched by file name");

        for (const when of whenClauses) {
            assert.ok(when.includes(`resourceFilename == ${COMMIT_EDITOR_FILE_NAME}`), when);
        }

        // The editor's language, and with it its rulers and syntax, is contributed by file name too.
        assert.ok(manifest.contributes.languages.some(language => language.filenames?.includes(COMMIT_EDITOR_FILE_NAME)));
    });
});

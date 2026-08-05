import * as assert from "assert";

import { parseAiCommand } from "../../../features/ai/aiCommandRegistry";
import type { AiCommand } from "../../../features/ai/aiCommandTypes";
import {
    aiCommandIdOf,
    applyPaletteContributions,
    buildPaletteContributions,
    paletteCommandId,
    paletteCommandIds,
    whenClauseFor,
    type PaletteManifest,
} from "../../../features/ai/paletteContributions";

/**
 * These entries end up in a manifest nothing else validates, and a wrong `when` clause is invisible:
 * the command simply never shows up. So the clause is tested the way VS Code reads it, by pulling the
 * regex literal back out of the string and running it against real paths.
 *
 * Real paths on both platforms: `resourcePath` is `fsPath` for a `file:` resource, so the clause is
 * handed `D:\dir\Button.tsx` on Windows and `/dir/Button.tsx` elsewhere. Matching only the second
 * spelling is a bug that hides every entry on Windows and passes every test written for POSIX.
 */

function command(raw: Record<string, unknown>): AiCommand {
    const parsed = parseAiCommand({ prompt: "Do it.", ...raw }, "settings");
    assert.ok(typeof parsed !== "string", `expected a command, got: ${parsed}`);
    return parsed;
}

/** VS Code takes a regex literal to be everything between the first and the last "/" of the clause. */
function matcherOf(when: string): RegExp {
    const value = when.slice(when.indexOf("=~") + 2);
    const start = value.indexOf("/");
    const end = value.lastIndexOf("/");

    assert.ok(start >= 0 && end > start, `no regex literal in: ${when}`);

    return new RegExp(value.slice(start + 1, end));
}

/** Asserted for the POSIX path and for the Windows spelling of the same file, which must agree. */
function matches(when: string, posixPath: string): boolean {
    const matcher = matcherOf(when);
    const windowsPath = `D:${posixPath.replace(/^\/[a-z]:/, "").replace(/\//g, "\\")}`;
    const posix = matcher.test(posixPath);

    assert.strictEqual(matcher.test(windowsPath), posix, `${windowsPath} and ${posixPath} disagree for: ${when}`);

    return posix;
}

suite("AI Palette Contributions Tests", () => {
    suite("when clauses", () => {
        test("should offer a command with no globs wherever a file is open", () => {
            assert.strictEqual(whenClauseFor(undefined), "resourceScheme == file");
            assert.strictEqual(whenClauseFor([]), "resourceScheme == file");
        });

        test("should keep a react command off a file it does not apply to", () => {
            const when = whenClauseFor(["**/*.tsx"]);

            assert.ok(when.startsWith("resourceScheme == file && resourcePath =~ /"), when);
            assert.strictEqual(matches(when, "/d:/proj/src/components/Button.tsx"), true);
            assert.strictEqual(matches(when, "/d:/proj/src/utils/config.ts"), false);
            assert.strictEqual(matches(when, "/d:/proj/README.md"), false);
        });

        test("should match the backslash path Windows hands the clause", () => {
            // `resourcePath` is `fsPath` for a file, so on Windows the clause never sees a forward slash.
            const tsx = matcherOf(whenClauseFor(["**/*.tsx"]));

            assert.strictEqual(tsx.test("D:\\Source\\proj\\src\\components\\Button.tsx"), true);
            assert.strictEqual(tsx.test("D:\\Source\\proj\\src\\utils\\config.ts"), false);
            assert.strictEqual(tsx.test("/home/p/proj/src/components/Button.tsx"), true);

            const scoped = matcherOf(whenClauseFor(["app/**/page.tsx"]));

            assert.strictEqual(scoped.test("D:\\Source\\proj\\app\\blog\\page.tsx"), true);
            assert.strictEqual(scoped.test("D:\\Source\\proj\\components\\page.tsx"), false);
        });

        test("should match a file sitting at the workspace root", () => {
            assert.strictEqual(matches(whenClauseFor(["**/*.tsx"]), "/d:/proj/App.tsx"), true);
        });

        test("should not let a suffix outside a path segment count as a match", () => {
            // The absolute path is anchored to a segment boundary, so a directory ending in the same
            // letters as the glob is not the glob.
            assert.strictEqual(matches(whenClauseFor(["src/**/*.ts"]), "/d:/proj/vendor-src/a.ts"), false);
            assert.strictEqual(matches(whenClauseFor(["src/**/*.ts"]), "/d:/proj/src/a.ts"), true);
        });

        test("should offer a command listing several globs for each of them", () => {
            const when = whenClauseFor(["**/*.ts", "**/*.md"]);

            assert.strictEqual(matches(when, "/c:/w/src/a.ts"), true);
            assert.strictEqual(matches(when, "/c:/w/docs/a.md"), true);
            assert.strictEqual(matches(when, "/c:/w/src/a.tsx"), false);
        });

        test("should expand brace alternation the way the picker does", () => {
            const when = whenClauseFor(["**/*.{ts,tsx}"]);

            assert.strictEqual(matches(when, "/c:/w/src/a.tsx"), true);
            assert.strictEqual(matches(when, "/c:/w/src/a.css"), false);
        });

        test("should honour a path-scoped glob", () => {
            const when = whenClauseFor(["app/**/page.tsx"]);

            assert.strictEqual(matches(when, "/c:/w/app/blog/[slug]/page.tsx"), true);
            assert.strictEqual(matches(when, "/c:/w/components/page.tsx"), false);
        });

        test("should leave the regex delimiters unambiguous", () => {
            // Everything between the first and the last "/" is the pattern, so the clause has to end
            // with the closing delimiter and nothing else.
            const when = whenClauseFor(["src/**/*.tsx"]);

            assert.ok(when.endsWith("$/"), when);
            assert.doesNotThrow(() => matcherOf(when));
        });
    });

    suite("entries", () => {
        test("should render a command as 'AI: <title>' at the top level", () => {
            const { commands, palette, problems } = buildPaletteContributions([command({ id: "add-props", title: "Add missing props" })]);

            assert.deepStrictEqual(problems, []);
            assert.deepStrictEqual(commands, [{ command: "myDevTools.ai.run.add-props", title: "Add missing props", category: "AI" }]);
            assert.strictEqual(palette[0].command, "myDevTools.ai.run.add-props");
        });

        test("should get back the id the runner has to be given", () => {
            assert.strictEqual(aiCommandIdOf(paletteCommandId("write-tests")), "write-tests");
        });

        test("should report an id that cannot be a command id rather than writing a broken entry", () => {
            const { commands, problems } = buildPaletteContributions([
                command({ id: "add props", title: "Spaced" }),
                command({ id: "ok", title: "Fine" }),
            ]);

            assert.strictEqual(commands.length, 1, "the good command still gets an entry");
            assert.match(problems[0], /"add props" cannot be a palette entry/);
        });
    });

    suite("applying to the manifest", () => {
        function manifest(): PaletteManifest {
            return {
                contributes: {
                    commands: [{ command: "myDevTools.quickCommit", title: "Quick Commit..." }],
                    menus: { commandPalette: [{ command: "myDevTools.quickCommit", when: "false" }] },
                },
            };
        }

        test("should add the entries without touching the hand-written ones", () => {
            const target = manifest();

            assert.strictEqual(applyPaletteContributions(target, buildPaletteContributions([command({ id: "a", title: "A" })])), true);

            assert.deepStrictEqual(
                target.contributes?.commands?.map(entry => entry.command),
                ["myDevTools.quickCommit", "myDevTools.ai.run.a"]
            );
            assert.deepStrictEqual(
                target.contributes?.menus?.commandPalette?.map(item => item.command),
                ["myDevTools.quickCommit", "myDevTools.ai.run.a"]
            );
        });

        test("should replace the previous entries instead of piling them up", () => {
            const target = manifest();

            applyPaletteContributions(target, buildPaletteContributions([command({ id: "a", title: "A" }), command({ id: "b", title: "B" })]));
            applyPaletteContributions(target, buildPaletteContributions([command({ id: "b", title: "B renamed" })]));

            assert.deepStrictEqual(paletteCommandIds(target), ["myDevTools.ai.run.b"]);
            assert.strictEqual(target.contributes?.commands?.find(entry => entry.command === "myDevTools.ai.run.b")?.title, "B renamed");
        });

        test("should report an unchanged manifest, so a pointless reload is not asked for", () => {
            const target = manifest();
            const contributions = buildPaletteContributions([command({ id: "a", title: "A", globs: ["**/*.tsx"] })]);

            assert.strictEqual(applyPaletteContributions(target, contributions), true);
            assert.strictEqual(applyPaletteContributions(target, contributions), false);
        });

        test("should notice a changed glob, which is only visible in the when clause", () => {
            const target = manifest();

            applyPaletteContributions(target, buildPaletteContributions([command({ id: "a", title: "A", globs: ["**/*.ts"] })]));

            assert.strictEqual(applyPaletteContributions(target, buildPaletteContributions([command({ id: "a", title: "A", globs: ["**/*.tsx"] })])), true);
        });

        test("should take an emptied catalogue as removing every entry", () => {
            const target = manifest();

            applyPaletteContributions(target, buildPaletteContributions([command({ id: "a", title: "A" })]));

            assert.strictEqual(applyPaletteContributions(target, buildPaletteContributions([])), true);
            assert.deepStrictEqual(paletteCommandIds(target), []);
            assert.deepStrictEqual(
                target.contributes?.commands?.map(entry => entry.command),
                ["myDevTools.quickCommit"]
            );
        });

        test("should cope with a manifest that contributes nothing yet", () => {
            const target: PaletteManifest = {};

            assert.strictEqual(applyPaletteContributions(target, buildPaletteContributions([command({ id: "a", title: "A" })])), true);
            assert.deepStrictEqual(paletteCommandIds(target), ["myDevTools.ai.run.a"]);
        });
    });
});

import { globToRegExpSource } from "../../utils/globUtils";
import type { AiCommand } from "./aiCommandTypes";

/**
 * Turns the command catalogue into manifest entries, so every AI command sits at the top level of the
 * command palette as "AI: <title>" instead of behind a picker.
 *
 * The palette is built from `contributes.commands` at startup and VS Code offers no API for adding to
 * it at runtime, so these entries have to be written into the extension's own package.json. Everything
 * here is pure: deciding *when* to write, and reloading afterwards, belongs to `paletteSync`.
 */

/** Generated entries are recognised by this prefix alone, which is what makes a re-sync idempotent. */
export const PALETTE_COMMAND_PREFIX = "myDevTools.ai.run.";

/** Rendered by the palette as "AI: <title>", which is the prefix without having to write it. */
export const PALETTE_CATEGORY = "AI";

/** A command id becomes part of a VS Code command id, which is not free to contain anything. */
const PALETTE_SAFE_ID = /^[A-Za-z0-9._-]+$/;

export interface ManifestCommand {
    command: string;
    title: string;
    category?: string;
    icon?: string;
}

export interface ManifestMenuItem {
    command?: string;
    submenu?: string;
    when?: string;
    group?: string;
}

/** The slice of package.json this module reads and rewrites. */
export interface PaletteManifest {
    contributes?: {
        commands?: ManifestCommand[];
        menus?: Record<string, ManifestMenuItem[]>;
    };
}

export interface PaletteContributions {
    commands: ManifestCommand[];
    palette: ManifestMenuItem[];
    /** One line per command that cannot become an entry, ready to show as a single warning. */
    problems: string[];
}

export function paletteCommandId(commandId: string): string {
    return PALETTE_COMMAND_PREFIX + commandId;
}

/** The catalogue id behind a generated palette command, which is what the runner is given. */
export function aiCommandIdOf(paletteId: string): string {
    return paletteId.slice(PALETTE_COMMAND_PREFIX.length);
}

export function isPaletteCommandId(command: string | undefined): boolean {
    return typeof command === "string" && command.startsWith(PALETTE_COMMAND_PREFIX);
}

/** The generated ids a manifest declares: the manifest is the list of ids that must answer. */
export function paletteCommandIds(manifest: PaletteManifest): string[] {
    return (manifest.contributes?.commands ?? []).map(entry => entry.command).filter(isPaletteCommandId);
}

/**
 * A path separator as the clause has to spell it. For a `file:` resource VS Code sets `resourcePath`
 * from `fsPath`, which on Windows is `D:\dir\Button.tsx` - a glob written with forward slashes only
 * ever matches if the clause accepts both spellings.
 */
const SEPARATOR = "[\\\\/]";
const NON_SEPARATOR = "[^\\\\/]";

/**
 * The globs as a `when` clause, so a command for `**\/*.tsx` is absent from the palette rather than
 * failing once picked. `resourcePath` is absolute, so each workspace-relative glob is anchored to a
 * path separator rather than to the start - which does mean a path-scoped glob such as `src/**` also
 * matches a `src` directory outside the workspace, where the picker would not offer it.
 *
 * Separators are escaped because VS Code reads a regex literal as everything between the first and
 * the last `/` of the clause; escaping them keeps the delimiters unambiguous.
 */
export function whenClauseFor(globs: readonly string[] | undefined): string {
    const patterns = (globs ?? []).map(glob => nativeSeparators(globToRegExpSource(glob))).filter(source => source !== "");

    // No globs means every file, but still only when a file is what is open: a command palette entry
    // that can only report "open a file first" is worth hiding.
    if (patterns.length === 0) {
        return "resourceScheme == file";
    }

    const alternation = patterns.length === 1 ? patterns[0] : `(?:${patterns.join("|")})`;
    const source = `${SEPARATOR}${alternation}$`.replace(/\//g, "\\/");

    return `resourceScheme == file && resourcePath =~ /${source}/`;
}

/** Rewrites the matcher's slashes to accept either platform's, in one pass so neither eats the other. */
function nativeSeparators(source: string): string {
    return source.replace(/\[\^\/\]|\//g, match => (match === "/" ? SEPARATOR : NON_SEPARATOR));
}

export function buildPaletteContributions(commands: readonly AiCommand[]): PaletteContributions {
    const contributions: PaletteContributions = { commands: [], palette: [], problems: [] };

    for (const command of commands) {
        if (!PALETTE_SAFE_ID.test(command.id)) {
            contributions.problems.push(`"${command.id}" cannot be a palette entry: an id may only contain letters, digits, ".", "-" and "_".`);
            continue;
        }

        const id = paletteCommandId(command.id);

        contributions.commands.push({ command: id, title: command.title, category: PALETTE_CATEGORY });
        contributions.palette.push({ command: id, when: whenClauseFor(command.globs) });
    }

    return contributions;
}

function generatedPart(manifest: PaletteManifest): string {
    return JSON.stringify([
        (manifest.contributes?.commands ?? []).filter(entry => isPaletteCommandId(entry.command)),
        (manifest.contributes?.menus?.commandPalette ?? []).filter(item => isPaletteCommandId(item.command)),
    ]);
}

/**
 * Replaces the generated entries in the manifest, leaving the hand-written ones untouched, and says
 * whether anything actually changed - a sync that changed nothing should not ask for a reload.
 */
export function applyPaletteContributions(manifest: PaletteManifest, contributions: PaletteContributions): boolean {
    const before = generatedPart(manifest);

    if (!manifest.contributes) {
        manifest.contributes = {};
    }

    const contributes = manifest.contributes;
    const menus = contributes.menus ?? {};

    contributes.commands = [...(contributes.commands ?? []).filter(entry => !isPaletteCommandId(entry.command)), ...contributions.commands];
    menus.commandPalette = [...(menus.commandPalette ?? []).filter(item => !isPaletteCommandId(item.command)), ...contributions.palette];
    contributes.menus = menus;

    return generatedPart(manifest) !== before;
}

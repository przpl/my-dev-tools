import * as vscode from "vscode";

import { Config } from "../../utils/config";
import { FileUtils } from "../../utils/fileUtils";
import { matchesGlob } from "../../utils/globUtils";

/**
 * Attaches the project's own coding rules to a command, so "add props" writes props the way this
 * repository writes them without the prompt having to repeat any of it.
 *
 * The files are the Markdown ones under `.claude/rules`, whose frontmatter carries exactly one
 * field — the globs the rule applies to:
 *
 * ```yaml
 * ---
 * paths:
 *     - "**\/*.ts"
 *     - "**\/*.tsx"
 * ---
 * ```
 *
 * That is the whole format, so it is read directly rather than by pulling in a YAML parser: a VS
 * Code extension pays for every dependency in download size. A rule with no frontmatter, or with no
 * `paths`, applies everywhere — as does the `"**\/*"` those files use to say the same thing.
 */

export interface Rule {
    /** File name, e.g. `typescript.md`. Sent along so the model can cite which rule it followed. */
    name: string;
    body: string;
}

interface Frontmatter {
    paths?: string[];
    body: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(text: string): Frontmatter {
    const match = FRONTMATTER.exec(text);
    if (!match) {
        return { body: text.trim() };
    }

    return { paths: readPaths(match[1]), body: text.slice(match[0].length).trim() };
}

/** `paths:` as either an inline array or the block sequence the rule files actually use. */
function readPaths(frontmatter: string): string[] | undefined {
    const lines = frontmatter.split(/\r?\n/);
    const start = lines.findIndex(line => /^paths\s*:/.test(line));

    if (start === -1) {
        return undefined;
    }

    const inline = lines[start].slice(lines[start].indexOf(":") + 1).trim();
    if (inline.startsWith("[")) {
        return unquoteAll(inline.replace(/^\[|\]$/g, "").split(","));
    }
    if (inline !== "") {
        return unquoteAll([inline]);
    }

    const entries: string[] = [];
    for (const line of lines.slice(start + 1)) {
        const item = /^\s*-\s+(.*)$/.exec(line);
        if (!item) {
            // A sibling key ends the sequence; a blank line inside one does not.
            if (line.trim() !== "") {
                break;
            }
            continue;
        }
        entries.push(item[1]);
    }

    return unquoteAll(entries);
}

function unquoteAll(values: string[]): string[] | undefined {
    const cleaned = values.map(value => value.trim().replace(/^["']|["']$/g, "").trim()).filter(value => value !== "");
    return cleaned.length > 0 ? cleaned : undefined;
}

export interface RuleSelection {
    /** The document's path relative to the workspace folder, in POSIX form. */
    relativePath: string;
    /** Files attached whatever their `paths` say — a write-tests command always wants `testing.md`. */
    always?: string[];
    /** False for a command that opted out of rules but still named some in `ruleFiles`. */
    matchPaths?: boolean;
}

/** Reads the rules directory and keeps the ones that apply. Missing directory means no rules, not an error. */
export async function loadRules(folder: vscode.WorkspaceFolder, selection: RuleSelection): Promise<Rule[]> {
    const directory = vscode.Uri.joinPath(folder.uri, ...Config.aiRulesDirectory.split(/[\\/]/).filter(segment => segment !== ""));

    let listing: [string, vscode.FileType][];
    try {
        listing = await vscode.workspace.fs.readDirectory(directory);
    } catch {
        return [];
    }

    const always = new Set(selection.always ?? []);
    const matchPaths = selection.matchPaths !== false;
    const names = listing
        .filter(([name, type]) => type === vscode.FileType.File && name.endsWith(".md"))
        .map(([name]) => name)
        .sort();

    const rules: Rule[] = [];

    for (const name of names) {
        const text = await FileUtils.readTextIfExists(vscode.Uri.joinPath(directory, name));
        if (text === undefined) {
            continue;
        }

        const { paths, body } = parseFrontmatter(text);
        const applies = always.has(name) || (matchPaths && (!paths || paths.some(glob => matchesGlob(selection.relativePath, glob))));

        if (applies && body !== "") {
            rules.push({ name, body });
        }
    }

    return rules;
}

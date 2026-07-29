import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

import { isFormattingOnlyChange, isParseable } from "./formattingOnly";
import { execGit, execGitWithStdin, findGitRoot } from "./gitCli";

const MAX_FILES_IN_MESSAGE = 5;

/** Drops the trailing empty entry that follows git's final NUL. */
function splitNulTerminated(output: string): string[] {
    return output.split("\0").filter(entry => entry.length > 0);
}

/** `--numstat -z` emits one `added\tdeleted\tpath` record per file. */
function parseNumstatPaths(output: string): string[] {
    const paths: string[] = [];

    for (const record of splitNulTerminated(output)) {
        const separator = record.lastIndexOf("\t");
        if (separator !== -1) {
            paths.push(record.substring(separator + 1));
        }
    }

    return paths;
}

/** `--name-status -z` alternates status and path entries; `--no-renames` keeps every record two entries wide. */
function parseModifiedPaths(output: string): Set<string> {
    const entries = splitNulTerminated(output);
    const modified = new Set<string>();

    for (let i = 0; i + 1 < entries.length; i += 2) {
        if (entries[i].startsWith("M")) {
            modified.add(entries[i + 1]);
        }
    }

    return modified;
}

interface UnstagedDiff {
    /** Files reported as modified, relative to the repository root, with forward slashes. */
    modified: string[];
    /** The subset that still differs once whitespace inside lines is ignored. */
    meaningful: Set<string>;
}

/**
 * Binary files, mode-only changes and pure additions or deletions survive both passes (or are not
 * reported as modifications), so they never reach a classification rule.
 */
async function readUnstagedDiff(gitRoot: string): Promise<UnstagedDiff> {
    const [allChanges, meaningfulChanges, nameStatus] = await Promise.all([
        execGit(gitRoot, ["diff", "--numstat", "--no-renames", "-z"]),
        execGit(gitRoot, ["diff", "--numstat", "--no-renames", "-z", "--ignore-all-space", "--ignore-blank-lines"]),
        execGit(gitRoot, ["diff", "--name-status", "--no-renames", "-z"]),
    ]);

    const modified = parseModifiedPaths(nameStatus);

    return {
        modified: parseNumstatPaths(allChanges).filter(file => modified.has(file)),
        meaningful: new Set(parseNumstatPaths(meaningfulChanges)),
    };
}

/** Reads the version of `file` the unstaged diff is taken against, which is the index, not HEAD. */
async function readIndexContent(gitRoot: string, file: string): Promise<string | undefined> {
    try {
        return await execGit(gitRoot, ["show", `:${file}`]);
    } catch {
        return undefined;
    }
}

async function readWorkingTreeContent(gitRoot: string, file: string): Promise<string | undefined> {
    try {
        return await fs.promises.readFile(path.join(gitRoot, file), "utf8");
    } catch {
        return undefined;
    }
}

/**
 * Rule: unstaged files whose changes vanish once whitespace is ignored - added or removed spaces
 * and blank lines only. Paths are relative to `gitRoot` and use forward slashes.
 *
 * Detection is a set difference between the normal diff and a whitespace-insensitive one.
 */
export async function findWhitespaceOnlyChanges(gitRoot: string): Promise<string[]> {
    const diff = await readUnstagedDiff(gitRoot);
    return selectWhitespaceOnly(diff);
}

function selectWhitespaceOnly(diff: UnstagedDiff): string[] {
    return diff.modified.filter(file => !diff.meaningful.has(file));
}

/**
 * Rule: unstaged files a formatter only re-laid out. Git's whitespace-insensitive diff compares whole
 * lines, so re-wrapping one line into several always looks like a real change to it; those files are
 * re-checked here by comparing the parsed token streams instead.
 */
export async function findFormattingOnlyChanges(gitRoot: string): Promise<string[]> {
    const diff = await readUnstagedDiff(gitRoot);
    return selectFormattingOnly(gitRoot, diff);
}

async function selectFormattingOnly(gitRoot: string, diff: UnstagedDiff): Promise<string[]> {
    const candidates = diff.modified.filter(file => diff.meaningful.has(file) && isParseable(file));

    const verdicts = await Promise.all(
        candidates.map(async file => {
            const [before, after] = await Promise.all([readIndexContent(gitRoot, file), readWorkingTreeContent(gitRoot, file)]);
            return before !== undefined && after !== undefined && isFormattingOnlyChange(file, before, after);
        }),
    );

    return candidates.filter((_, i) => verdicts[i]);
}

/**
 * Returns the unstaged files that are safe to stage without review: the union of every classification
 * rule. Further rules are meant to be unioned in here.
 */
export async function findAutoStageableFiles(gitRoot: string): Promise<string[]> {
    const diff = await readUnstagedDiff(gitRoot);
    const [whitespaceOnly, formattingOnly] = [selectWhitespaceOnly(diff), await selectFormattingOnly(gitRoot, diff)];

    const selected = new Set([...whitespaceOnly, ...formattingOnly]);

    return diff.modified.filter(file => selected.has(file));
}

/** VS Code passes the clicked resource group, or the individual resource states, as separate arguments. */
function collectResourceUris(args: unknown[]): vscode.Uri[] {
    const uris: vscode.Uri[] = [];

    for (const arg of args) {
        if (!arg || typeof arg !== "object") {
            continue;
        }

        if ("resourceStates" in arg) {
            uris.push(...(arg as vscode.SourceControlResourceGroup).resourceStates.map(state => state.resourceUri));
        } else if ("resourceUri" in arg) {
            uris.push((arg as vscode.SourceControlResourceState).resourceUri);
        }
    }

    return uris;
}

/** Resolves the directory to run git in, preferring the repository the command was invoked from. */
function resolveWorkingDirectory(args: unknown[]): string | undefined {
    const [firstResource] = collectResourceUris(args);
    if (firstResource) {
        return path.dirname(firstResource.fsPath);
    }

    // Invoked from the command palette: fall back to the active file's folder, then the workspace.
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (activeUri?.scheme === "file") {
        return path.dirname(activeUri.fsPath);
    }

    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function summarizeFiles(files: string[]): string {
    const names = files.slice(0, MAX_FILES_IN_MESSAGE).map(file => path.basename(file));
    const remaining = files.length - names.length;

    return remaining > 0 ? `${names.join(", ")} and ${remaining} more` : names.join(", ");
}

export async function autoStage(...args: unknown[]): Promise<void> {
    const cwd = resolveWorkingDirectory(args);
    if (!cwd) {
        vscode.window.showErrorMessage("Auto stage: no folder is open.");
        return;
    }

    const gitRoot = await findGitRoot(cwd);
    if (!gitRoot) {
        vscode.window.showErrorMessage("Auto stage: could not find a Git repository.");
        return;
    }

    try {
        const files = await findAutoStageableFiles(gitRoot);

        if (files.length === 0) {
            vscode.window.showInformationMessage("No changes to auto stage.");
            return;
        }

        await execGitWithStdin(gitRoot, ["add", "--pathspec-from-file=-", "--pathspec-file-nul"], files.join("\0"));

        const fileWord = files.length === 1 ? "file" : "files";
        vscode.window.showInformationMessage(`Auto staged ${files.length} ${fileWord}: ${summarizeFiles(files)}`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Auto stage failed: ${errorMessage}`);
    }
}

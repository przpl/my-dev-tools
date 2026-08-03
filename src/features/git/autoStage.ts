import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

import { mapWithLimit } from "../../utils/concurrency";
import { isFormattingOnlyChange, isSupportedFile } from "./formattingOnly";
import { execGit, execGitWithStdin, findGitRoot } from "./gitCli";

const MAX_FILES_IN_MESSAGE = 5;

/** Reading every candidate costs a `git show` process, so a wide sweep is kept to a few at a time. */
const MAX_CONCURRENT_READS = 16;

/**
 * Lock files are machine-generated dependency records. A reformat of one is still a supply-chain
 * change in the making, and they are the one JSON file nobody wants staged without a look.
 */
const NEVER_AUTO_STAGED = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|[^/]+\.lock)$/i;

/** Drops the trailing empty entry that follows git's final NUL. */
function splitNulTerminated(output: string): string[] {
    return output.split("\0").filter(entry => entry.length > 0);
}

/**
 * `--name-status -z` alternates status and path entries; `--no-renames` keeps every record two
 * entries wide. Only `M` is taken, which leaves out additions, deletions and type changes.
 *
 * A path with an unresolved merge conflict is reported twice, as `U` and again as `M`, so the `U`
 * records have to be subtracted rather than merely skipped: staging one would mark it resolved.
 */
function parseModifiedPaths(output: string): string[] {
    const entries = splitNulTerminated(output);
    const modified: string[] = [];
    const unmerged = new Set<string>();

    for (let i = 0; i + 1 < entries.length; i += 2) {
        const [status, file] = [entries[i], entries[i + 1]];

        if (status.startsWith("U")) {
            unmerged.add(file);
        } else if (status.startsWith("M")) {
            modified.push(file);
        }
    }

    return modified.filter(file => !unmerged.has(file));
}

/** Files with unstaged modifications, relative to the repository root, with forward slashes. */
async function readModifiedFiles(gitRoot: string): Promise<string[]> {
    return parseModifiedPaths(await execGit(gitRoot, ["diff", "--name-status", "--no-renames", "-z"]));
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

async function isCosmeticChange(gitRoot: string, file: string): Promise<boolean> {
    const [before, after] = await Promise.all([readIndexContent(gitRoot, file), readWorkingTreeContent(gitRoot, file)]);
    if (before === undefined || after === undefined) {
        return false;
    }

    // Identical content means the diff is a file mode change, which is an intentional edit, not a reformat.
    return before !== after && isFormattingOnlyChange(file, before, after);
}

/**
 * Returns the unstaged files that are safe to stage without review: those whose working-tree version
 * is provably the same program, stylesheet or document as the version already in the index.
 */
export async function findAutoStageableFiles(gitRoot: string): Promise<string[]> {
    const modified = await readModifiedFiles(gitRoot);
    const candidates = modified.filter(file => isSupportedFile(file) && !NEVER_AUTO_STAGED.test(file));

    const verdicts = await mapWithLimit(candidates, MAX_CONCURRENT_READS, file => isCosmeticChange(gitRoot, file));

    return candidates.filter((_, i) => verdicts[i]);
}

/**
 * VS Code passes the clicked resource group, or the individual resource states, as separate
 * arguments. A multi-selection arrives as an array in one of them, and the Explorer and the editor
 * title bar pass bare `Uri`s, so the arguments are walked rather than read one deep.
 */
export function collectResourceUris(args: unknown[]): vscode.Uri[] {
    const uris: vscode.Uri[] = [];

    for (const arg of args) {
        if (!arg || typeof arg !== "object") {
            continue;
        }

        if (Array.isArray(arg)) {
            uris.push(...collectResourceUris(arg));
        } else if (arg instanceof vscode.Uri) {
            uris.push(arg);
        } else if ("resourceStates" in arg) {
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

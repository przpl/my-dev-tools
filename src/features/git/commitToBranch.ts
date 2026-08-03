import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

import { promptForCommitMessage } from "./commitMessageInput";
import { execGit, execGitRaw, findGitDir, toGitPath } from "./gitCli";
import { resolveSelectedFiles } from "./selectedFiles";

/**
 * Commits selected files onto a branch that is not checked out, leaving the working tree, the index
 * and HEAD exactly as they were. No checkout, no stash, no switching back.
 *
 * The commit is assembled out of the object database with plumbing - the same sequence `git commit`
 * runs internally - against a scratch index, so unrelated pending changes are never in the way:
 *
 *   read-tree <target> -> hash-object -> update-index -> write-tree -> commit-tree -> update-ref
 *
 * It is offered only when the change would land identically on the target, which holds exactly when
 * each file's base blob is the same on both branches. Anything else would be a merge, not a commit.
 */

const COMMAND_LABEL = "Commit to Branch";

/** Blobs only: a symlink or a submodule cannot be rewritten from working-tree bytes. */
const REGULAR_FILE_MODES = new Set(["100644", "100755"]);

/** A tree entry as `git ls-tree` reports it: the mode carries the file kind, the id the content. */
interface TreeEntry {
    mode: string;
    id: string;
}

interface Branch {
    name: string;
    id: string;
    subject: string;
}

/** The index entry a single file contributes to the new tree, or its removal when `entry` is absent. */
interface FileChange {
    gitPath: string;
    entry: TreeEntry | undefined;
}

/** A refusal the user should read as a verdict rather than as a failure. */
class NotEquivalentError extends Error {}

function sameEntry(a: TreeEntry | undefined, b: TreeEntry | undefined): boolean {
    // The mode counts too: the same bytes with a different executable bit is a different diff.
    return a?.id === b?.id && a?.mode === b?.mode;
}

async function readTreeEntry(gitRoot: string, rev: string, gitPath: string): Promise<TreeEntry | undefined> {
    // An unborn HEAD or a path missing from the tree both come back empty rather than failing.
    const output = await execGitRaw(gitRoot, ["ls-tree", "-z", rev, "--", gitPath]);
    const match = /^(\d{6}) \w+ ([0-9a-f]+)\t/.exec(output);

    return match ? { mode: match[1], id: match[2] } : undefined;
}

async function listLocalBranches(gitRoot: string): Promise<Branch[]> {
    const format = "%(refname:short)%00%(objectname)%00%(contents:subject)";
    const output = await execGit(gitRoot, ["for-each-ref", `--format=${format}`, "refs/heads"]);

    return output
        .split("\n")
        .filter(line => line.length > 0)
        .map(line => {
            const [name, id, subject] = line.trimEnd().split("\0");
            return { name, id, subject: subject ?? "" };
        });
}

/**
 * Branches held by a worktree, including the current one. Writing to any of them would leave that
 * worktree's index against a HEAD it never checked out, showing the change back as a pending revert.
 */
async function readWorktreeBranches(gitRoot: string): Promise<Set<string>> {
    const output = await execGitRaw(gitRoot, ["worktree", "list", "--porcelain"]);
    const branches = new Set<string>();

    for (const line of output.split("\n")) {
        const match = /^branch refs\/heads\/(.+)$/.exec(line.trim());
        if (match) {
            branches.add(match[1]);
        }
    }

    return branches;
}

/** Empty when HEAD is detached, which is a state this command can still commit from. */
async function readCurrentBranch(gitRoot: string): Promise<string> {
    return (await execGitRaw(gitRoot, ["branch", "--show-current"])).trim();
}

async function pickTargetBranch(gitRoot: string): Promise<Branch | undefined> {
    const [branches, occupied] = await Promise.all([listLocalBranches(gitRoot), readWorktreeBranches(gitRoot)]);
    const candidates = branches.filter(branch => !occupied.has(branch.name));

    if (candidates.length === 0) {
        vscode.window.showInformationMessage("No other local branch to commit to; every branch here is checked out.");
        return undefined;
    }

    const picked = await vscode.window.showQuickPick(
        candidates.map(branch => ({ label: branch.name, description: branch.subject, branch })),
        { title: "Commit to Branch", placeHolder: "Pick the branch to commit the selected files to" }
    );

    return picked?.branch;
}

/** `git add` records the executable bit; a file that exists on neither branch has no mode to reuse. */
function modeForNewFile(absolutePath: string): string {
    if (process.platform === "win32") {
        return "100644";
    }

    try {
        return (fs.statSync(absolutePath).mode & 0o111) !== 0 ? "100755" : "100644";
    } catch {
        return "100644";
    }
}

/**
 * Checks that the file's change would land identically on `target`, and resolves what the new tree
 * should hold for it. Throws `NotEquivalentError` when the two branches disagree on the base.
 */
async function prepareChange(gitRoot: string, target: Branch, currentBranch: string, absolutePath: string): Promise<FileChange> {
    const gitPath = toGitPath(gitRoot, absolutePath);

    const [headEntry, targetEntry] = await Promise.all([
        readTreeEntry(gitRoot, "HEAD", gitPath),
        readTreeEntry(gitRoot, target.id, gitPath),
    ]);

    if (!sameEntry(headEntry, targetEntry)) {
        const here = currentBranch || "the current commit";
        throw new NotEquivalentError(
            `${gitPath} differs between ${target.name} and ${here}, so committing it there would not produce the same change. ` +
                `Bring the branches level on this file first.`
        );
    }

    if (headEntry && !REGULAR_FILE_MODES.has(headEntry.mode)) {
        throw new NotEquivalentError(`${gitPath} is a symlink or a submodule, which ${COMMAND_LABEL} does not handle.`);
    }

    if (!fs.existsSync(absolutePath)) {
        if (!headEntry) {
            throw new NotEquivalentError(`${gitPath} does not exist.`);
        }

        // Gone from disk and tracked on both branches: the change is a deletion.
        return { gitPath, entry: undefined };
    }

    // `--path` applies the same attributes and clean filters `git add` would, so the blob is identical.
    const id = (await execGit(gitRoot, ["hash-object", "-w", "--path", gitPath, "--", absolutePath])).trim();

    return { gitPath, entry: { mode: headEntry?.mode ?? modeForNewFile(absolutePath), id } };
}

async function isSigningEnabled(gitRoot: string): Promise<boolean> {
    return (await execGitRaw(gitRoot, ["config", "--type=bool", "--get", "commit.gpgsign"])).trim() === "true";
}

/**
 * Writes the commit object and returns its id, or `undefined` when the target already holds this
 * content. Everything happens in a scratch index, so the repository's own index is never read.
 */
async function buildCommit(gitRoot: string, gitDir: string, target: Branch, changes: FileChange[], message: string): Promise<string | undefined> {
    const indexFile = path.join(gitDir, `MY_DEV_TOOLS_COMMIT_INDEX_${process.pid}`);
    const env = { GIT_INDEX_FILE: indexFile };

    try {
        await execGit(gitRoot, ["read-tree", target.id], env);

        for (const { gitPath, entry } of changes) {
            const args = entry
                ? ["update-index", "--add", "--cacheinfo", `${entry.mode},${entry.id},${gitPath}`]
                : ["update-index", "--force-remove", "--", gitPath];

            await execGit(gitRoot, args, env);
        }

        const tree = (await execGit(gitRoot, ["write-tree"], env)).trim();
        const targetTree = (await execGit(gitRoot, ["rev-parse", `${target.id}^{tree}`])).trim();

        if (tree === targetTree) {
            return undefined;
        }

        const args = ["commit-tree", tree, "-p", target.id, "-m", message];
        if (await isSigningEnabled(gitRoot)) {
            args.push("-S");
        }

        return (await execGit(gitRoot, args)).trim();
    } finally {
        await fs.promises.rm(indexFile, { force: true }).catch(() => {});
    }
}

function describeResult(fileCount: number, target: string, currentBranch: string): string {
    const fileWord = fileCount === 1 ? "file" : "files";
    const reminder = currentBranch
        ? ` They stay modified here until ${currentBranch} includes ${target}.`
        : ` They stay modified here until this branch includes ${target}.`;

    return `${COMMAND_LABEL}: committed ${fileCount} ${fileWord} to ${target}.${reminder}`;
}

export async function commitToBranch(...args: unknown[]): Promise<void> {
    const selection = await resolveSelectedFiles(args, COMMAND_LABEL);
    if (!selection) {
        return;
    }

    const { gitRoot, filePaths } = selection;

    try {
        const target = await pickTargetBranch(gitRoot);
        if (!target) {
            return;
        }

        // Checked before the message is written, so a refusal never throws away typing.
        const currentBranch = await readCurrentBranch(gitRoot);
        const changes = await Promise.all(filePaths.map(filePath => prepareChange(gitRoot, target, currentBranch, filePath)));

        const message = await promptForCommitMessage(
            gitRoot,
            changes.map(change => change.gitPath),
            target.name
        );

        if (!message) {
            // User cancelled
            return;
        }

        const gitDir = (await findGitDir(gitRoot)) ?? path.join(gitRoot, ".git");
        const commit = await buildCommit(gitRoot, gitDir, target, changes, message.trim());

        if (!commit) {
            vscode.window.showInformationMessage(`${target.name} already has this content; nothing to commit.`);
            return;
        }

        // Passing the old id makes this a compare-and-swap: a branch moved meanwhile is not clobbered.
        const subject = message.trim().split("\n")[0];
        await execGit(gitRoot, ["update-ref", "-m", `commit: ${subject}`, `refs/heads/${target.name}`, commit, target.id]);

        vscode.window.showInformationMessage(describeResult(filePaths.length, target.name, currentBranch));
    } catch (error) {
        if (error instanceof NotEquivalentError) {
            vscode.window.showWarningMessage(error.message);
            return;
        }

        vscode.window.showErrorMessage(`${COMMAND_LABEL} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

import * as fs from "fs";
import * as path from "path";

import { execGit } from "./gitCli";

/**
 * What the repository says about a commit beyond its diff: the branch it lands on, what that branch
 * already holds, and whether git is in the middle of replaying or merging something. All of it is
 * read locally and costs no tokens to work out, only to send.
 */

/**
 * A trunk name says nothing about this change, and a detached HEAD reads as the literal `HEAD`: both
 * would only be noise the model tries to make sense of.
 */
const UNINFORMATIVE_BRANCHES = new Set(["main", "master", "HEAD"]);

/** Tried in order; the remote's own idea of its default branch is the most reliable. */
const BASE_CANDIDATES = ["origin/main", "origin/master", "main", "master"];

/** Enough to show the direction a branch has taken and the scopes it uses. */
const MAX_BRANCH_COMMITS = 20;

export type OperationKind = "merge" | "rebase" | "cherry-pick" | "revert";

export interface InProgressOperation {
    kind: OperationKind;
    /** The message git prepared, without its comment lines. */
    message?: string;
    /** Paths git reported as conflicted, from the `# Conflicts:` block of the prepared message. */
    conflicts: string[];
}

export interface BranchCommits {
    /** Subjects, newest first, capped at `MAX_BRANCH_COMMITS`. */
    subjects: string[];
    total: number;
}

export function describingBranch(branch: string | undefined): string | undefined {
    return branch && !UNINFORMATIVE_BRANCHES.has(branch) ? branch : undefined;
}

function readGitFile(gitDir: string, ...segments: string[]): string | undefined {
    try {
        return fs.readFileSync(path.join(gitDir, ...segments), "utf8");
    } catch {
        return undefined;
    }
}

function exists(gitDir: string, ...segments: string[]): boolean {
    return fs.existsSync(path.join(gitDir, ...segments));
}

/** Mid-rebase HEAD is detached; the branch being rebased is recorded beside the rebase state. */
function readRebasedBranch(gitDir: string): string | undefined {
    const headName = readGitFile(gitDir, "rebase-merge", "head-name") ?? readGitFile(gitDir, "rebase-apply", "head-name");
    const name = headName?.trim().replace(/^refs\/heads\//, "");
    return name || undefined;
}

export async function readBranch(gitRoot: string, gitDir: string | undefined): Promise<string | undefined> {
    let branch: string | undefined;
    try {
        branch = (await execGit(gitRoot, ["rev-parse", "--abbrev-ref", "HEAD"])).trim() || undefined;
    } catch {
        branch = undefined;
    }

    if (branch === "HEAD" && gitDir) {
        return readRebasedBranch(gitDir) ?? branch;
    }

    return branch;
}

async function resolves(gitRoot: string, ref: string): Promise<boolean> {
    try {
        await execGit(gitRoot, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
        return true;
    } catch {
        return false;
    }
}

async function findBaseRef(gitRoot: string): Promise<string | undefined> {
    try {
        const remoteHead = (await execGit(gitRoot, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"])).trim();
        if (remoteHead && (await resolves(gitRoot, remoteHead))) {
            return remoteHead;
        }
    } catch {
        // No remote, or one cloned without its HEAD recorded: fall through to the usual names.
    }

    for (const candidate of BASE_CANDIDATES) {
        if (await resolves(gitRoot, candidate)) {
            return candidate;
        }
    }

    return undefined;
}

/**
 * The commits the branch has that its base does not, merges left out: a sync from trunk is not part
 * of the branch's story. Without a base there is no telling where the branch starts, and recent
 * trunk history would only mislead, so nothing is returned.
 */
export async function readBranchCommits(gitRoot: string, branchRef: string): Promise<BranchCommits | undefined> {
    const base = await findBaseRef(gitRoot);
    if (!base) {
        return undefined;
    }

    const range = `${base}..${branchRef}`;

    try {
        const [log, count] = await Promise.all([
            execGit(gitRoot, ["log", "--no-merges", "--format=%s", `-n${MAX_BRANCH_COMMITS}`, range, "--"]),
            execGit(gitRoot, ["rev-list", "--no-merges", "--count", range, "--"]),
        ]);

        const subjects = log.split("\n").map(line => line.trim()).filter(Boolean);
        return subjects.length > 0 ? { subjects, total: Number(count.trim()) || subjects.length } : undefined;
    } catch {
        return undefined;
    }
}

/** How far back scope usage looks: enough to see a convention, recent enough to be the current one. */
const MAX_HISTORY_COMMITS = 50;
/** Keeps the pathspec well inside the Windows command-line limit. */
const MAX_HISTORY_PATHS = 100;
const MAX_REPORTED_SCOPES = 8;

const CONVENTIONAL_SUBJECT = /^[a-z]+(?:\(([^)]*)\))?!?:\s/i;

export interface ScopeUsage {
    /** Scopes with the number of commits that used them, most used first. */
    scopes: { name: string; count: number }[];
    /** Conventional commits among those examined that used no scope. */
    unscoped: number;
    /** Commits examined, conventional or not. */
    examined: number;
}

/**
 * The scopes earlier commits to the same paths used. Tied to the files rather than to recent history,
 * so it is as good on trunk as on a branch, and it answers what the model is worst at guessing: what
 * this project calls the part of the codebase being changed.
 */
export async function readScopeUsage(gitRoot: string, ref: string, paths: string[]): Promise<ScopeUsage | undefined> {
    if (paths.length === 0) {
        return undefined;
    }

    let log: string;
    try {
        log = await execGit(gitRoot, ["log", "--no-merges", "--format=%s", `-n${MAX_HISTORY_COMMITS}`, ref, "--", ...paths.slice(0, MAX_HISTORY_PATHS)]);
    } catch {
        // No commits yet, or a ref that does not resolve: there is simply no convention to report.
        return undefined;
    }

    const subjects = log.split("\n").map(line => line.trim()).filter(Boolean);
    const counts = new Map<string, number>();
    let unscoped = 0;

    for (const subject of subjects) {
        const match = CONVENTIONAL_SUBJECT.exec(subject);
        if (!match) {
            continue;
        }

        const scope = match[1]?.trim();
        if (scope) {
            counts.set(scope, (counts.get(scope) ?? 0) + 1);
        } else {
            unscoped++;
        }
    }

    if (counts.size === 0) {
        return undefined;
    }

    const scopes = [...counts]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, MAX_REPORTED_SCOPES);

    return { scopes, unscoped, examined: subjects.length };
}

/** Git's prepared message keeps conflicted paths in a commented-out `Conflicts:` block. */
function parsePreparedMessage(raw: string): { message?: string; conflicts: string[] } {
    const lines = raw.replace(/\r\n/g, "\n").split("\n");
    const conflicts: string[] = [];
    let inConflicts = false;

    for (const line of lines) {
        if (/^#\s*Conflicts:\s*$/.test(line)) {
            inConflicts = true;
            continue;
        }

        const entry = /^#\t(.+)$/.exec(line);
        if (inConflicts && entry) {
            conflicts.push(entry[1].trim());
        } else if (line.trim() !== "#") {
            inConflicts = false;
        }
    }

    const message = lines
        .filter(line => !line.startsWith("#"))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    return { message: message || undefined, conflicts };
}

export function readInProgressOperation(gitDir: string): InProgressOperation | undefined {
    let kind: OperationKind | undefined;
    let raw: string | undefined;

    if (exists(gitDir, "rebase-merge") || exists(gitDir, "rebase-apply")) {
        kind = "rebase";
        raw = readGitFile(gitDir, "rebase-merge", "message") ?? readGitFile(gitDir, "MERGE_MSG");
    } else if (exists(gitDir, "MERGE_HEAD")) {
        kind = "merge";
    } else if (exists(gitDir, "CHERRY_PICK_HEAD")) {
        kind = "cherry-pick";
    } else if (exists(gitDir, "REVERT_HEAD")) {
        kind = "revert";
    }

    if (!kind) {
        return undefined;
    }

    raw ??= readGitFile(gitDir, "MERGE_MSG");
    return { kind, ...(raw ? parsePreparedMessage(raw) : { conflicts: [] }) };
}

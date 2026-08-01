import * as fs from "fs";
import * as path from "path";
import { isText } from "istextorbinary";

import { mapWithLimit } from "../../utils/concurrency";
import { isFormattingOnlyChange, isSupportedFile } from "./formattingOnly";
import { execGit, execGitRaw } from "./gitCli";

/**
 * Runs the git commands behind commit message generation. The diff is narrowed here, at the source:
 * files that can never inform a commit message are excluded by pathspec so they are never read,
 * while still being *named* so a dependency bump is still recognisable as one.
 */

const DIFF_FLAGS = ["--no-color", "--no-ext-diff", "--diff-algorithm=minimal", "-M", "-C", "-U2"];

/** Reading both versions of a file costs a `git show`; a wide sweep is kept to a few at a time. */
const MAX_CONCURRENT_READS = 16;

/** A new file this large is generated, vendored or a fixture, and its body is never the story. */
const MAX_UNTRACKED_BYTES = 100 * 1024;

export interface DiffScope {
    /** `["--cached"]` to describe the index, `["HEAD"]` to describe everything uncommitted. */
    revisions: string[];
    /** Repository-relative paths, or `["."]` for the whole repository. */
    paths: string[];
    /** True when the "after" side is the index rather than the working tree. */
    staged: boolean;
    includeUntracked: boolean;
}

export interface ChangedFile {
    /** Git's short status letter: `M`, `A`, `D`, `R`, `?` for untracked. */
    status: string;
    path: string;
    previousPath?: string;
    /** True when the path matched an exclusion, so it is listed but not diffed. */
    excluded: boolean;
}

export interface CollectedDiff {
    files: ChangedFile[];
    /** Raw unified diff, before compaction. */
    diff: string;
    /** Paths whose change is provably a reformat of the same source. */
    formattingOnlyPaths: Set<string>;
}

function splitNulTerminated(output: string): string[] {
    return output.split("\0").filter(entry => entry.length > 0);
}

async function hasHead(gitRoot: string): Promise<boolean> {
    try {
        await execGit(gitRoot, ["rev-parse", "--verify", "HEAD"]);
        return true;
    } catch {
        return false;
    }
}

function excludePathspecs(excludeGlobs: readonly string[]): string[] {
    return excludeGlobs.map(glob => `:(exclude,glob)${glob}`);
}

/**
 * Picks what to describe: the index when something is staged, otherwise every uncommitted change.
 * This mirrors what pressing Commit would actually record.
 */
export async function resolveScope(gitRoot: string, paths?: string[]): Promise<DiffScope> {
    const scopedPaths = paths && paths.length > 0 ? paths : ["."];

    // Before the first commit there is no HEAD to diff against, so the index is the only baseline.
    if (!(await hasHead(gitRoot))) {
        return { revisions: ["--cached"], paths: scopedPaths, staged: true, includeUntracked: true };
    }

    // Quick Commit names the files it is about to commit, whether or not they are staged yet.
    if (paths && paths.length > 0) {
        return { revisions: ["HEAD"], paths: scopedPaths, staged: false, includeUntracked: true };
    }

    const staged = (await execGit(gitRoot, ["diff", "--cached", "--name-only"])).trim().length > 0;

    return staged
        ? { revisions: ["--cached"], paths: scopedPaths, staged: true, includeUntracked: false }
        : { revisions: ["HEAD"], paths: scopedPaths, staged: false, includeUntracked: true };
}

/**
 * `--name-status -z` emits a status entry followed by one path, or two paths for a rename. Run
 * without exclusions, so the caller can report the full shape of the commit.
 */
function parseNameStatus(output: string): ChangedFile[] {
    const entries = splitNulTerminated(output);
    const files: ChangedFile[] = [];

    for (let i = 0; i < entries.length; ) {
        const status = entries[i++];

        if (status.startsWith("R") || status.startsWith("C")) {
            const previousPath = entries[i++];
            const target = entries[i++];
            if (target) {
                files.push({ status: status[0], path: target, previousPath, excluded: false });
            }
            continue;
        }

        const file = entries[i++];
        if (file) {
            files.push({ status: status[0], path: file, excluded: false });
        }
    }

    return files;
}

async function listUntrackedFiles(gitRoot: string, scope: DiffScope): Promise<string[]> {
    if (!scope.includeUntracked) {
        return [];
    }

    const output = await execGit(gitRoot, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...scope.paths]);
    return splitNulTerminated(output);
}

/** Builds the diff git will not produce for a file it does not track yet. */
function synthesizeUntrackedDiff(gitRoot: string, file: string): string {
    const absolute = path.join(gitRoot, file);
    const header = `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}`;

    let content: Buffer;
    try {
        const stats = fs.statSync(absolute);
        if (stats.size > MAX_UNTRACKED_BYTES) {
            return header;
        }
        content = fs.readFileSync(absolute);
    } catch {
        return header;
    }

    if (!isText(absolute, content)) {
        return `${header}\nBinary files /dev/null and b/${file} differ`;
    }

    const lines = content.toString("utf8").replace(/\r\n/g, "\n").split("\n");
    if (lines[lines.length - 1] === "") {
        lines.pop();
    }

    return `${header}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line => `+${line}`).join("\n")}`;
}

async function readHeadContent(gitRoot: string, file: string): Promise<string | undefined> {
    try {
        return await execGit(gitRoot, ["show", `HEAD:${file}`]);
    } catch {
        return undefined;
    }
}

async function readCurrentContent(gitRoot: string, file: string, staged: boolean): Promise<string | undefined> {
    try {
        return staged ? await execGit(gitRoot, ["show", `:${file}`]) : await fs.promises.readFile(path.join(gitRoot, file), "utf8");
    } catch {
        return undefined;
    }
}

/**
 * Files whose two versions parse to the same program, stylesheet or document. Reuses the comparison
 * Auto Stage is built on, so a reformat costs one line in the prompt instead of the whole file.
 */
async function findFormattingOnlyPaths(gitRoot: string, scope: DiffScope, files: ChangedFile[]): Promise<Set<string>> {
    const candidates = files.filter(file => file.status === "M" && isSupportedFile(file.path) && !file.excluded).map(file => file.path);

    const verdicts = await mapWithLimit(candidates, MAX_CONCURRENT_READS, async file => {
        const [before, after] = await Promise.all([readHeadContent(gitRoot, file), readCurrentContent(gitRoot, file, scope.staged)]);

        return before !== undefined && after !== undefined && before !== after && isFormattingOnlyChange(file, before, after);
    });

    return new Set(candidates.filter((_, index) => verdicts[index]));
}

export async function collectDiff(gitRoot: string, scope: DiffScope, excludeGlobs: readonly string[]): Promise<CollectedDiff> {
    const { revisions, paths } = scope;
    const exclusions = excludePathspecs(excludeGlobs);

    const [nameStatus, includedNames, untracked] = await Promise.all([
        execGit(gitRoot, ["diff", ...revisions, "--name-status", "-M", "-C", "-z", "--", ...paths]),
        execGit(gitRoot, ["diff", ...revisions, "--name-only", "-z", "--", ...paths, ...exclusions]),
        listUntrackedFiles(gitRoot, scope),
    ]);

    const included = new Set(splitNulTerminated(includedNames));
    const untrackedSet = new Set(untracked.filter(file => !excludeGlobs.some(glob => matchesGlob(file, glob))));

    const files: ChangedFile[] = [
        ...parseNameStatus(nameStatus).map(file => ({ ...file, excluded: !included.has(file.path) })),
        ...untracked.map(file => ({ status: "?", path: file, excluded: !untrackedSet.has(file) })),
    ];

    const trackedDiff = await execGitRaw(gitRoot, ["diff", ...revisions, ...DIFF_FLAGS, "--", ...paths, ...exclusions]);
    const untrackedDiff = [...untrackedSet].map(file => synthesizeUntrackedDiff(gitRoot, file));

    return {
        files,
        diff: [trackedDiff.trim(), ...untrackedDiff].filter(part => part.length > 0).join("\n"),
        formattingOnlyPaths: await findFormattingOnlyPaths(gitRoot, scope, files),
    };
}

/**
 * Matches the subset of glob syntax the exclusion settings use, following git's `:(glob)` rules:
 * `*` stops at a slash, `?` is one non-slash character, and a leading double star followed by a
 * slash spans any number of directories *including none*, so the default `package-lock.json`
 * pattern also matches one sitting at the repository root.
 */
export function matchesGlob(filePath: string, glob: string): boolean {
    let pattern = "";

    for (let i = 0; i < glob.length; i++) {
        if (glob[i] !== "*" && glob[i] !== "?") {
            pattern += escapeRegExp(glob[i]);
        } else if (glob[i] === "?") {
            pattern += "[^/]";
        } else if (glob[i + 1] !== "*") {
            pattern += "[^/]*";
        } else if (glob[i + 2] === "/") {
            pattern += "(?:.*/)?";
            i += 2;
        } else {
            pattern += ".*";
            i += 1;
        }
    }

    return new RegExp(`^${pattern}$`).test(filePath);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

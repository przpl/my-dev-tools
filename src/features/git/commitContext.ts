import * as path from "path";

import { Config } from "../../utils/config";
import { getOpenRouter } from "../../services/openRouter";
import { collectDiff, listLeftOutChanges, resolveScope, type ChangedFile } from "./collectDiff";
import { buildSystemPrompt, buildUserPrompt, sanitizeCommitMessage, type CommitContext } from "./commitMessagePrompt";
import { cleanDiff, parseDiff } from "./diffCleaner";
import { findGitDir } from "./gitCli";
import { findMovedBlocks } from "./movedCode";
import { describingBranch, readBranch, readBranchCommits, readInProgressOperation, readScopeUsage } from "./repositoryState";

import type * as vscode from "vscode";

/** Ties the git side to the model side: gather, compact, prompt, sanitize. */

export interface GenerateOptions {
    /** Restricts the diff to these repository-relative paths, as Quick Commit does. */
    paths?: string[];
    /** Text already in the message box, passed along as intent. */
    hint?: string;
    /** The branch the commit lands on, when that is not the checked-out one, as Commit to Branch does. */
    targetBranch?: string;
}

export class NothingToDescribeError extends Error {
    constructor() {
        super("There are no changes to describe.");
        this.name = "NothingToDescribeError";
    }
}

/**
 * Where to look for the history of these files. A new file has none, so its directory stands in for
 * it; a renamed one has its history under the old name.
 */
function historyPaths(files: ChangedFile[]): string[] {
    const paths = new Set<string>();

    for (const file of files) {
        if (file.excluded) {
            continue;
        }

        if (file.status === "A" || file.status === "?") {
            const directory = path.posix.dirname(file.path);
            if (directory !== ".") {
                paths.add(directory);
            }
            continue;
        }

        paths.add(file.path);
        if (file.previousPath) {
            paths.add(file.previousPath);
        }
    }

    return [...paths];
}

export async function buildCommitContext(gitRoot: string, options: GenerateOptions = {}): Promise<CommitContext> {
    const scope = await resolveScope(gitRoot, options.paths);
    const collected = await collectDiff(gitRoot, scope, Config.commitMessageExcludeGlobs);

    if (collected.files.length === 0) {
        throw new NothingToDescribeError();
    }

    const gitDir = await findGitDir(gitRoot);
    const branch = describingBranch(options.targetBranch ?? (await readBranch(gitRoot, gitDir)));

    // A commit headed elsewhere continues that branch's story, not the checked-out one's.
    const ref = options.targetBranch ? `refs/heads/${options.targetBranch}` : "HEAD";

    const [branchCommits, scopeUsage, leftOut] = await Promise.all([
        branch ? readBranchCommits(gitRoot, ref) : undefined,
        readScopeUsage(gitRoot, ref, historyPaths(collected.files)),
        listLeftOutChanges(gitRoot, scope, collected.files),
    ]);

    const parsed = parseDiff(collected.diff);

    return {
        branch,
        branchCommits,
        // Commit to Branch builds its commit beside whatever the checked-out branch is in the middle of.
        operation: gitDir && !options.targetBranch ? readInProgressOperation(gitDir) : undefined,
        leftOut,
        scopeUsage,
        files: collected.files,
        diffedPaths: new Set(parsed.map(file => file.path)),
        hint: options.hint,
        diff: cleanDiff(collected.diff, {
            maxCharacters: Config.commitMessageMaxDiffCharacters,
            stripImportsAboveLines: Config.commitMessageStripImportsAboveLines,
            summarizeAddedScriptsAboveLines: Config.commitMessageSummarizeAddedScriptsAboveLines,
            outlineAddedMarkdownAboveLines: Config.commitMessageOutlineAddedMarkdownAboveLines,
            maxLineLength: Config.commitMessageMaxDiffLineLength,
            formattingOnlyPaths: collected.formattingOnlyPaths,
            lineCounts: true,
            movedBlocks: findMovedBlocks(parsed),
        }),
    };
}

export async function generateCommitMessage(gitRoot: string, options: GenerateOptions = {}, token?: vscode.CancellationToken): Promise<string> {
    const context = await buildCommitContext(gitRoot, options);

    const reply = await getOpenRouter().chat(
        {
            messages: [
                { role: "system", content: buildSystemPrompt(Config.commitMessageAdditionalInstructions) },
                { role: "user", content: buildUserPrompt(context) },
            ],
            temperature: 0.2,
            keyScope: "commitMessage",
        },
        token
    );

    return sanitizeCommitMessage(reply);
}

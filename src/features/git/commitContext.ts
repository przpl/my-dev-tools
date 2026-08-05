import { Config } from "../../utils/config";
import { getOpenRouter } from "../../services/openRouter";
import { collectDiff, resolveScope } from "./collectDiff";
import { buildSystemPrompt, buildUserPrompt, sanitizeCommitMessage, type CommitContext } from "./commitMessagePrompt";
import { cleanDiff } from "./diffCleaner";
import { execGit } from "./gitCli";

import type * as vscode from "vscode";

/** Ties the git side to the model side: gather, compact, prompt, sanitize. */

export interface GenerateOptions {
    /** Restricts the diff to these repository-relative paths, as Quick Commit does. */
    paths?: string[];
    /** Text already in the message box, passed along as intent. */
    hint?: string;
}

async function readBranch(gitRoot: string): Promise<string | undefined> {
    try {
        return (await execGit(gitRoot, ["rev-parse", "--abbrev-ref", "HEAD"])).trim() || undefined;
    } catch {
        return undefined;
    }
}

export class NothingToDescribeError extends Error {
    constructor() {
        super("There are no changes to describe.");
        this.name = "NothingToDescribeError";
    }
}

export async function buildCommitContext(gitRoot: string, options: GenerateOptions = {}): Promise<CommitContext> {
    const scope = await resolveScope(gitRoot, options.paths);
    const collected = await collectDiff(gitRoot, scope, Config.commitMessageExcludeGlobs);

    if (collected.files.length === 0) {
        throw new NothingToDescribeError();
    }

    return {
        branch: await readBranch(gitRoot),
        files: collected.files,
        hint: options.hint,
        diff: cleanDiff(collected.diff, {
            maxCharacters: Config.commitMessageMaxDiffCharacters,
            stripImportsAboveLines: Config.commitMessageStripImportsAboveLines,
            summarizeAddedScriptsAboveLines: Config.commitMessageSummarizeAddedScriptsAboveLines,
            outlineAddedMarkdownAboveLines: Config.commitMessageOutlineAddedMarkdownAboveLines,
            maxLineLength: Config.commitMessageMaxDiffLineLength,
            formattingOnlyPaths: collected.formattingOnlyPaths,
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

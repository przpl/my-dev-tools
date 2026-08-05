import * as cp from "child_process";

import { createTempDir, removeTempDir, writeFile } from "./tempDir";

export { writeFile };

/**
 * The temporary git repository every git suite is built on. Real repositories rather than a fake
 * git: the features under test are thin wrappers around the command line, so a stub would only
 * assert that the arguments look the way the test expects them to.
 */

/** Runs git and returns its output, throwing when it fails - which is what a broken fixture should do. */
export function git(cwd: string, args: string[]): string {
    return cp.execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });
}

export interface TempRepoOptions {
    /** The name of the initial branch, for suites that name it in an assertion. */
    branch?: string;
}

/**
 * A repository under the OS temp directory, named after the suite that asked for it.
 *
 * `core.autocrlf=false` because a suite that compares bytes cannot have git rewriting its line
 * endings on checkout.
 */
export function createTempRepo(name: string, options: TempRepoOptions = {}): string {
    const repo = createTempDir(name);

    git(repo, ["init", "-q", ...(options.branch ? ["-b", options.branch] : []), "."]);
    git(repo, ["config", "user.email", "test@example.com"]);
    git(repo, ["config", "user.name", "Test"]);
    git(repo, ["config", "core.autocrlf", "false"]);

    return repo;
}

/** Best effort: Windows holds locks on the git directory, and a leaked temp folder must never fail a test. */
export function removeTempRepo(repo: string): void {
    removeTempDir(repo);
}

/** Commits everything in the working tree, which is how a suite gets a baseline to diff against. */
export function commitAll(repo: string, message = "baseline"): void {
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", message]);
}

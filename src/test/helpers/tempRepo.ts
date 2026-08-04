import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

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
 * `realpathSync` because the temp directory is a symlink on macOS and git reports the resolved path,
 * and `core.autocrlf=false` because a suite that compares bytes cannot have git rewriting its line
 * endings on checkout.
 */
export function createTempRepo(name: string, options: TempRepoOptions = {}): string {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `vscode-${name}-`)));

    git(repo, ["init", "-q", ...(options.branch ? ["-b", options.branch] : []), "."]);
    git(repo, ["config", "user.email", "test@example.com"]);
    git(repo, ["config", "user.name", "Test"]);
    git(repo, ["config", "core.autocrlf", "false"]);

    return repo;
}

/** Best effort: Windows holds locks on the git directory, and a leaked temp folder must never fail a test. */
export function removeTempRepo(repo: string): void {
    try {
        fs.rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch {
        // Nothing to do about it, and nothing that should stop the run.
    }
}

export function writeFile(repo: string, relativePath: string, content: string): void {
    const target = path.join(repo, relativePath);

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
}

/** Commits everything in the working tree, which is how a suite gets a baseline to diff against. */
export function commitAll(repo: string, message = "baseline"): void {
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", message]);
}

import * as cp from "child_process";
import * as path from "path";

// Whole-repository diffs comfortably exceed Node's 1 MB default.
const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Once git has exited, everything it wrote is already in the pipe and only needs draining, so a
 * stream still open after this long is held by something else and will never end on its own.
 */
const FLUSH_GRACE_MS = 2000;

interface GitResult {
    stdout: string;
    stderr: string;
    error: Error | null;
}

/** Overrides layered onto the inherited environment, for the variables git reads such as `GIT_INDEX_FILE`. */
function withEnv(env: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv | undefined {
    return env ? { ...process.env, ...env } : undefined;
}

/**
 * Runs git and waits for git itself, not for its pipes. Never rejects: the exit code is the
 * caller's to interpret.
 *
 * `execFile` settles on the child's `close`, which waits for the standard streams to end. A
 * `pre-commit` hook that leaves anything running behind it hands that process git's stdout and
 * stderr and holds them open for as long as it lives: the commit is made, git is gone, and the call
 * never comes back. `exit` says git is finished and carries its code, so the result is built on
 * that; the streams get a moment afterwards to hand over what git already wrote.
 *
 * Stdin is closed straight away for the same family of reasons: an inherited pipe that nobody ever
 * writes to leaves anything reading it - `hash-object --stdin`, a prompt for credentials - waiting
 * for input that can never arrive.
 */
function runGit(cwd: string, args: string[], env?: NodeJS.ProcessEnv, input?: string): Promise<GitResult> {
    return new Promise(resolve => {
        const child = cp.spawn("git", args, { cwd, env: withEnv(env), windowsHide: true });

        let stdout = "";
        let stderr = "";
        let exitError: Error | null = null;
        let settled = false;
        let flushTimer: NodeJS.Timeout | undefined;

        function settle(error: Error | null): void {
            if (settled) {
                return;
            }

            settled = true;
            clearTimeout(flushTimer);

            // Nothing else here reads them, and a stream left open keeps its pipe alive.
            child.stdout?.destroy();
            child.stderr?.destroy();

            resolve({ stdout, stderr, error });
        }

        function collect(text: string, into: "stdout" | "stderr"): void {
            if (into === "stdout") {
                stdout += text;
            } else {
                stderr += text;
            }

            // The equivalent of execFile's maxBuffer: a runaway command is killed rather than held.
            if (stdout.length + stderr.length > MAX_BUFFER) {
                child.kill();
                settle(new Error("git produced more output than this command can hold"));
            }
        }

        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => collect(chunk, "stdout"));
        child.stderr?.on("data", (chunk: string) => collect(chunk, "stderr"));

        // git missing from PATH, or a working directory that does not exist.
        child.on("error", error => settle(error));

        child.on("exit", (code, signal) => {
            exitError = code === 0 ? null : new Error(signal ? `git was killed by ${signal}` : `git exited with code ${code}`);
            flushTimer = setTimeout(() => settle(exitError), FLUSH_GRACE_MS);
        });

        // Always after `exit`, and the usual way out: the streams ended, so the output is complete.
        child.on("close", () => settle(exitError));

        // git can close stdin before we finish writing; the exit code reports the real failure.
        child.stdin?.on("error", () => {});
        child.stdin?.end(input);
    });
}

export async function execGit(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
    const { stdout, stderr, error } = await runGit(cwd, args, env);

    if (error) {
        throw new Error(String(stderr || error.message || error).trim());
    }

    return stdout;
}

/**
 * Runs git and returns stdout even when the exit code is non-zero. `git diff` reports "differences
 * found" as exit 1, so a caller that wants the diff rather than the verdict has to ignore the code.
 */
export async function execGitRaw(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
    return (await runGit(cwd, args, env)).stdout;
}

/**
 * Runs git with `input` piped to stdin. Used for path lists, which would otherwise be capped by the
 * OS command-line length limit once a repository has enough changed files.
 */
export async function execGitWithStdin(cwd: string, args: string[], input: string): Promise<void> {
    const { stderr, error } = await runGit(cwd, args, undefined, input);

    if (error) {
        throw new Error(String(stderr || error.message || error).trim());
    }
}

export async function findGitRoot(cwd: string): Promise<string | undefined> {
    try {
        const root = (await execGit(cwd, ["rev-parse", "--show-toplevel"])).trim();
        return root ? path.normalize(root) : undefined;
    } catch {
        return undefined;
    }
}

/**
 * The `.git` directory itself, which is not always `<root>/.git`: in a linked worktree or a
 * submodule it lives elsewhere and `.git` is a file pointing at it.
 */
export async function findGitDir(cwd: string): Promise<string | undefined> {
    try {
        const gitDir = (await execGit(cwd, ["rev-parse", "--absolute-git-dir"])).trim();
        return gitDir ? path.normalize(gitDir) : undefined;
    } catch {
        return undefined;
    }
}

/** Git reports and accepts forward-slash paths relative to the repository root, on every platform. */
export function toGitPath(gitRoot: string, filePath: string): string {
    return path.relative(gitRoot, filePath).replace(/\\/g, "/");
}

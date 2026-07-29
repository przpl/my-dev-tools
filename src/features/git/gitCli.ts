import * as cp from "child_process";
import * as path from "path";
import { promisify } from "util";

const execFileAsync = promisify(cp.execFile);

// Whole-repository diffs comfortably exceed Node's 1 MB default.
const MAX_BUFFER = 64 * 1024 * 1024;

export async function execGit(cwd: string, args: string[]): Promise<string> {
    try {
        const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: MAX_BUFFER, windowsHide: true });
        return stdout;
    } catch (error: any) {
        throw new Error(String(error.stderr || error.message || error).trim());
    }
}

/**
 * Runs git with `input` piped to stdin. Used for path lists, which would otherwise be capped by the
 * OS command-line length limit once a repository has enough changed files.
 */
export function execGitWithStdin(cwd: string, args: string[], input: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = cp.spawn("git", args, { cwd, windowsHide: true });
        let stderr = "";

        child.stderr.on("data", chunk => (stderr += chunk));
        child.on("error", reject);
        child.on("close", code => (code === 0 ? resolve() : reject(new Error(stderr.trim() || `git exited with code ${code}`))));

        // git can close stdin before we finish writing; the close handler reports the real failure.
        child.stdin.on("error", () => {});
        child.stdin.end(input);
    });
}

export async function findGitRoot(cwd: string): Promise<string | undefined> {
    try {
        const root = (await execGit(cwd, ["rev-parse", "--show-toplevel"])).trim();
        return root ? path.normalize(root) : undefined;
    } catch {
        return undefined;
    }
}

/** Git reports and accepts forward-slash paths relative to the repository root, on every platform. */
export function toGitPath(gitRoot: string, filePath: string): string {
    return path.relative(gitRoot, filePath).replace(/\\/g, "/");
}

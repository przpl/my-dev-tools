import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * A scratch directory for suites that need real files but no git. `realpathSync` because the temp
 * directory is a symlink on macOS, and a suite comparing paths cannot have two spellings of one.
 */
export function createTempDir(name: string): string {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `vscode-${name}-`)));
}

/** Best effort: Windows holds locks, and a leaked temp folder must never fail a test. */
export function removeTempDir(directory: string): void {
    try {
        fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch {
        // Nothing to do about it, and nothing that should stop the run.
    }
}

export function writeFile(directory: string, relativePath: string, content: string): void {
    const target = path.join(directory, relativePath);

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
}

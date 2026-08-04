import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

import { execGit, execGitRaw } from "../../../features/git/gitCli";
import { createTempRepo, git, removeTempRepo } from "../../helpers/tempRepo";

/** The empty blob, which is what `git hash-object --stdin` answers for no input at all. */
const EMPTY_BLOB = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";

suite("gitCli Tests", () => {
    let repo: string;

    setup(() => {
        repo = createTempRepo("git-cli");
    });

    teardown(() => {
        removeTempRepo(repo);
    });

    test("should not wait on a git command that reads standard input", async () => {
        // `execFile` gives the child an stdin pipe that nobody ever writes to or closes, so anything
        // reading from it waits for input that can never arrive and the command hangs with no
        // output, no error and no way for a caller to tell that it is stuck. Closing it ends the
        // read the way a git run without a terminal would. Without that this test never finishes.
        assert.strictEqual((await execGit(repo, ["hash-object", "--stdin"])).trim(), EMPTY_BLOB);
        assert.strictEqual((await execGitRaw(repo, ["hash-object", "--stdin"])).trim(), EMPTY_BLOB);
    });

    test("should come back when a hook leaves a process running behind it", async () => {
        // The hook exits at once, but what it started inherits git's stdout and stderr and holds
        // them open. Waiting for those streams to end - which is what `execFile` does - means
        // waiting for that process instead of for git: the commit is made, git is gone, and the
        // call never returns. No result, no error, and nothing on screen to say anything is wrong.
        // The process outlives the commit, and stops as soon as the test says so rather than
        // running on into the suites that follow. The timeout is only there to make sure a failing
        // run cannot leave it behind.
        const stopFile = path.join(repo, ".git", "stop").replace(/\\/g, "/");
        const lingering = `setTimeout(() => process.exit(0), 30000); setInterval(() => { if (require('fs').existsSync('${stopFile}')) process.exit(0); }, 100);`;

        const hook = path.join(repo, ".git", "hooks", "pre-commit");
        fs.mkdirSync(path.dirname(hook), { recursive: true });
        fs.writeFileSync(hook, `#!/bin/sh\nnode -e "${lingering}" &\nexit 0\n`);
        fs.chmodSync(hook, 0o755);

        fs.writeFileSync(path.join(repo, "file.ts"), "const a = 1;\n");
        git(repo, ["add", "-A"]);

        try {
            await execGit(repo, ["commit", "-m", "committed behind a lingering hook child"]);

            const subject = git(repo, ["log", "-1", "--pretty=%s"]).trim();
            assert.strictEqual(subject, "committed behind a lingering hook child");
        } finally {
            fs.writeFileSync(stopFile, "");
        }
    });

    test("should report the failure of a git command through its stderr", async () => {
        await assert.rejects(execGit(repo, ["rev-parse", "--verify", "refs/heads/nope"]), (error: Error) => error.message.length > 0);
    });

    test("should report a git that could never start", async () => {
        // The `error` branch: no `git` on PATH, or - as here - a working directory that is not there.
        // There is no exit code and no stderr, so the spawn error is all the caller has to go on.
        await assert.rejects(execGit(path.join(repo, "not-a-directory"), ["status"]), (error: Error) => error.message.length > 0);
    });

    test("should refuse to hold more output than it can buffer", async () => {
        // 64 MB. The message only reaches the caller because git wrote nothing to stderr; `execGit`
        // prefers stderr whenever there is any, which would hide it behind git's own complaint.
        const huge = path.join(repo, "huge.bin");
        fs.writeFileSync(huge, Buffer.alloc(65 * 1024 * 1024, "x"));
        git(repo, ["add", "-A"]);

        await assert.rejects(execGit(repo, ["show", ":huge.bin"]), (error: Error) => /more output than/.test(error.message));
    });

    test("should return the output of a git command that exits non-zero", async () => {
        fs.writeFileSync(path.join(repo, "file.ts"), "const a = 1;\n");
        git(repo, ["add", "-A"]);

        // `git diff --exit-code` reports "differences found" as exit 1, with the diff on stdout.
        const diff = await execGitRaw(repo, ["diff", "--cached", "--exit-code"]);

        assert.ok(diff.includes("+const a = 1;"), `Unexpected diff: ${diff}`);
    });
});

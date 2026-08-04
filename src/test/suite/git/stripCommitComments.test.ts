import * as assert from "assert";

import { stripCommitComments } from "../../../features/git/commitMessageEditor";

/** Git's own `--cleanup=strip`, which the commit editor leans on to remove its comment block. */
suite("StripCommitComments Tests", () => {
    test("should drop comment lines", () => {
        assert.strictEqual(stripCommitComments("feat: add a thing\n#\n# Committing 1 file:\n#   a.ts\n"), "feat: add a thing");
    });

    test("should return nothing when every line is a comment", () => {
        assert.strictEqual(stripCommitComments("# one\n# two\n"), "");
    });

    test("should keep an indented hash", () => {
        // Only a line *starting* with '#' is a comment, so a markdown heading in a body survives.
        assert.strictEqual(stripCommitComments("fix: a thing\n\n  # not a comment\n"), "fix: a thing\n\n  # not a comment");
    });

    test("should trim trailing whitespace per line", () => {
        assert.strictEqual(stripCommitComments("fix: a thing   \n\n- because\t\n"), "fix: a thing\n\n- because");
    });

    test("should collapse a run of blank lines", () => {
        assert.strictEqual(stripCommitComments("fix: a thing\n\n\n\n- because\n"), "fix: a thing\n\n- because");
    });

    test("should normalize line endings", () => {
        assert.strictEqual(stripCommitComments("fix: a thing\r\n\r\n- because\r\n"), "fix: a thing\n\n- because");
    });
});

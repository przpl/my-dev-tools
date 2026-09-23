import * as assert from "assert";

import { InvalidBranchPatternError, readBranchVariables, resolveProjectInstructions } from "../../../features/git/projectInstructions";

const TICKET = "^(?<ticket>[a-z]+-\\d+)";

suite("ProjectInstructions Tests", () => {
    suite("readBranchVariables", () => {
        test("should expose the branch and each named group", () => {
            assert.deepStrictEqual(readBranchVariables("mvp-123-fix-something", TICKET), { branch: "mvp-123-fix-something", ticket: "mvp-123" });
        });

        test("should expose only the branch when the pattern does not match", () => {
            assert.deepStrictEqual(readBranchVariables("fix-something", TICKET), { branch: "fix-something" });
        });

        test("should leave out a group that took no part in the match", () => {
            assert.deepStrictEqual(readBranchVariables("fix-something", "^(?:(?<ticket>[a-z]+-\\d+)-)?(?<rest>.+)$"), { branch: "fix-something", rest: "fix-something" });
        });

        test("should expose nothing without a branch", () => {
            assert.deepStrictEqual(readBranchVariables(undefined, TICKET), {});
        });

        test("should name the setting when the pattern is invalid", () => {
            assert.throws(() => readBranchVariables("mvp-1", "(?<ticket>"), InvalidBranchPatternError);
        });
    });

    suite("resolveProjectInstructions", () => {
        const template = "Write in English.\nPut [${ticket}] right after the type: fix: [${ticket}] handle empty cart";

        test("should fill in every placeholder", () => {
            assert.strictEqual(
                resolveProjectInstructions(template, { branch: "mvp-123-x", ticket: "mvp-123" }),
                "Write in English.\nPut [mvp-123] right after the type: fix: [mvp-123] handle empty cart"
            );
        });

        test("should drop a line whose placeholder the branch did not provide", () => {
            assert.strictEqual(resolveProjectInstructions(template, { branch: "fix-x" }), "Write in English.");
        });

        test("should come out empty when every line is dropped", () => {
            assert.strictEqual(resolveProjectInstructions("Branch: ${branch}", {}), "");
        });
    });
});

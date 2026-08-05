import * as assert from "assert";

import { matchesAnyGlob, matchesGlob } from "../../utils/globUtils";

/**
 * The same matcher decides which files a commit message ignores and which files an AI command is
 * offered for, so its edge cases are worth pinning down in one place.
 */
suite("Glob Utils Tests", () => {
    test("should match a leading double star at any depth, including none", () => {
        assert.strictEqual(matchesGlob("package-lock.json", "**/package-lock.json"), true);
        assert.strictEqual(matchesGlob("app/package-lock.json", "**/package-lock.json"), true);
        assert.strictEqual(matchesGlob("a/b/c/package-lock.json", "**/package-lock.json"), true);
    });

    test("should not let a single star cross a slash", () => {
        assert.strictEqual(matchesGlob("src/app.min.js", "**/*.min.js"), true);
        assert.strictEqual(matchesGlob("src/app.min.js", "*.min.js"), false);
    });

    test("should match a trailing double star as a directory subtree", () => {
        assert.strictEqual(matchesGlob("dist/bundle.js", "**/dist/**"), true);
        assert.strictEqual(matchesGlob("app/dist/nested/bundle.js", "**/dist/**"), true);
        assert.strictEqual(matchesGlob("distant.ts", "**/dist/**"), false);
    });

    test("should keep an extension glob from spilling into a longer one", () => {
        assert.strictEqual(matchesGlob("src/button.ts", "**/*.ts"), true);
        assert.strictEqual(matchesGlob("src/button.tsx", "**/*.ts"), false);
        assert.strictEqual(matchesGlob("src/button.tsx", "**/*.tsx"), true);
    });

    test("should expand brace alternation", () => {
        assert.strictEqual(matchesGlob("src/button.ts", "**/*.{ts,tsx}"), true);
        assert.strictEqual(matchesGlob("src/button.tsx", "**/*.{ts,tsx}"), true);
        assert.strictEqual(matchesGlob("src/button.css", "**/*.{ts,tsx}"), false);
    });

    test("should honour a path-scoped rule glob", () => {
        assert.strictEqual(matchesGlob("app/page.tsx", "app/**/page.tsx"), true);
        assert.strictEqual(matchesGlob("app/blog/[slug]/page.tsx", "app/**/page.tsx"), true);
        assert.strictEqual(matchesGlob("components/page.tsx", "app/**/page.tsx"), false);
    });

    test("should treat the rule files' spelling of 'always' as matching everything", () => {
        assert.strictEqual(matchesGlob("README.md", "**/*"), true);
        assert.strictEqual(matchesGlob("src/deep/nested/file.ts", "**/*"), true);
    });

    test("should match everything when a command names no globs", () => {
        assert.strictEqual(matchesAnyGlob("anything.txt", undefined), true);
        assert.strictEqual(matchesAnyGlob("anything.txt", []), true);
        assert.strictEqual(matchesAnyGlob("anything.txt", ["**/*.md"]), false);
        assert.strictEqual(matchesAnyGlob("notes.md", ["**/*.ts", "**/*.md"]), true);
    });
});

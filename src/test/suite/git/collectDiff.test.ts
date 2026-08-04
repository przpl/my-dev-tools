import * as assert from "assert";

import { collectDiff, matchesGlob, resolveScope } from "../../../features/git/collectDiff";
import { cleanDiff } from "../../../features/git/diffCleaner";
import { commitAll, createTempRepo, git, removeTempRepo, writeFile as write } from "../../helpers/tempRepo";

const EXCLUDES = ["**/package-lock.json", "**/*.lock", "**/dist/**"];

suite("CollectDiff Tests", () => {
    let repo: string;

    setup(() => {
        repo = createTempRepo("collect-diff");
    });

    teardown(() => {
        removeTempRepo(repo);
    });

    async function collect() {
        return collectDiff(repo, await resolveScope(repo), EXCLUDES);
    }

    test("should describe the working tree when nothing is staged", async () => {
        write(repo, "src/app.ts", "const limit = 5;\n");
        commitAll(repo);
        write(repo, "src/app.ts", "const limit = 50;\n");

        const collected = await collect();

        assert.deepStrictEqual(
            collected.files.map(file => `${file.status} ${file.path}`),
            ["M src/app.ts"]
        );
        assert.ok(collected.diff.includes("+const limit = 50;"));
    });

    test("should describe the index alone once something is staged", async () => {
        write(repo, "staged.ts", "const a = 1;\n");
        write(repo, "unstaged.ts", "const b = 1;\n");
        commitAll(repo);

        write(repo, "staged.ts", "const a = 2;\n");
        write(repo, "unstaged.ts", "const b = 2;\n");
        git(repo, ["add", "staged.ts"]);

        const collected = await collect();

        assert.deepStrictEqual(
            collected.files.map(file => file.path),
            ["staged.ts"]
        );
    });

    test("should name an excluded file without diffing it", async () => {
        write(repo, "package-lock.json", '{\n    "lockfileVersion": 1\n}\n');
        write(repo, "src/app.ts", "const a = 1;\n");
        commitAll(repo);

        write(repo, "package-lock.json", '{\n    "lockfileVersion": 2\n}\n');
        write(repo, "src/app.ts", "const a = 2;\n");

        const collected = await collect();
        const lock = collected.files.find(file => file.path === "package-lock.json");

        assert.ok(lock, "The lock file must still be listed");
        assert.strictEqual(lock.excluded, true);
        assert.ok(!collected.diff.includes("lockfileVersion"), "Its contents must not be sent");
        assert.ok(collected.diff.includes("+const a = 2;"), "The real change must survive");
    });

    test("should include an untracked file as an addition", async () => {
        write(repo, "seed.ts", "const seed = 1;\n");
        commitAll(repo);

        write(repo, "brand-new.ts", "export const isNew = true;\n");

        const collected = await collect();

        assert.deepStrictEqual(
            collected.files.map(file => `${file.status} ${file.path}`),
            ["? brand-new.ts"]
        );
        assert.ok(cleanDiff(collected.diff, { maxCharacters: 10000, stripImportsAboveLines: 10000 }).startsWith("+++ NEW brand-new.ts"));
    });

    test("should exclude an untracked file that matches an exclusion", async () => {
        write(repo, "seed.ts", "const seed = 1;\n");
        commitAll(repo);

        write(repo, "bun.lock", "generated\n");

        const collected = await collect();

        assert.strictEqual(collected.files[0].excluded, true);
        assert.strictEqual(collected.diff, "");
    });

    test("should report a rename rather than a delete and an add", async () => {
        write(repo, "src/old.ts", "export const value = 1;\nexport const other = 2;\n");
        commitAll(repo);

        git(repo, ["mv", "src/old.ts", "src/new.ts"]);

        const collected = await collect();

        assert.strictEqual(collected.files[0].status, "R");
        assert.strictEqual(collected.files[0].previousPath, "src/old.ts");
        assert.strictEqual(collected.files[0].path, "src/new.ts");
    });

    test("should flag a reformatted file as formatting only", async () => {
        write(repo, "src/style.ts", "const a = {x: 1};\n");
        write(repo, "src/real.ts", "const limit = 5;\n");
        commitAll(repo);

        write(repo, "src/style.ts", "const a = {\n    x: 1,\n};\n");
        write(repo, "src/real.ts", "const limit = 50;\n");

        const collected = await collect();

        assert.deepStrictEqual([...collected.formattingOnlyPaths], ["src/style.ts"]);

        const cleaned = cleanDiff(collected.diff, {
            maxCharacters: 10000,
            stripImportsAboveLines: 10000,
            formattingOnlyPaths: collected.formattingOnlyPaths,
        });

        assert.ok(cleaned.includes("--- src/style.ts\n(formatting only)"));
        assert.ok(cleaned.includes("+const limit = 50;"));
    });

    test("should work before the first commit", async () => {
        write(repo, "first.ts", "const first = 1;\n");
        git(repo, ["add", "first.ts"]);

        const collected = await collect();

        assert.deepStrictEqual(
            collected.files.map(file => `${file.status} ${file.path}`),
            ["A first.ts"]
        );
        assert.ok(collected.diff.includes("+const first = 1;"));
    });

    test("should restrict the diff to the requested paths", async () => {
        write(repo, "a.ts", "const a = 1;\n");
        write(repo, "b.ts", "const b = 1;\n");
        commitAll(repo);

        write(repo, "a.ts", "const a = 2;\n");
        write(repo, "b.ts", "const b = 2;\n");

        const collected = await collectDiff(repo, await resolveScope(repo, ["a.ts"]), EXCLUDES);

        assert.deepStrictEqual(
            collected.files.map(file => file.path),
            ["a.ts"]
        );
        assert.ok(!collected.diff.includes("const b"));
    });

    test("should restrict the diff to the requested paths before the first commit", async () => {
        write(repo, "a.ts", "const a = 1;\n");
        write(repo, "b.ts", "const b = 1;\n");
        git(repo, ["add", "-A"]);

        const collected = await collectDiff(repo, await resolveScope(repo, ["a.ts"]), EXCLUDES);

        assert.deepStrictEqual(
            collected.files.map(file => file.path),
            ["a.ts"]
        );
    });

    test("should describe a requested path whether or not it is staged", async () => {
        write(repo, "staged.ts", "const a = 1;\n");
        write(repo, "unstaged.ts", "const b = 1;\n");
        commitAll(repo);

        write(repo, "staged.ts", "const a = 2;\n");
        write(repo, "unstaged.ts", "const b = 2;\n");
        git(repo, ["add", "staged.ts"]);

        const collected = await collectDiff(repo, await resolveScope(repo, ["staged.ts", "unstaged.ts"]), EXCLUDES);

        assert.deepStrictEqual(
            collected.files.map(file => file.path).sort(),
            ["staged.ts", "unstaged.ts"],
            "Quick Commit stages what it commits, so an unstaged selection still counts"
        );
    });

    suite("matchesGlob", () => {
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
    });
});

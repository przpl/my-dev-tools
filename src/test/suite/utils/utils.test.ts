import * as assert from "assert";
import * as path from "path";

import { mapWithLimit } from "../../../utils/concurrency";
import { FileUtils } from "../../../utils/fileUtils";
import { ControllerName } from "../../../utils/nestUtils";

suite("Concurrency Tests", () => {
    function later<T>(value: T, ms: number): Promise<T> {
        return new Promise(resolve => setTimeout(() => resolve(value), ms));
    }

    test("should return results in input order however the mapper resolves", async () => {
        // Load-bearing: `findAutoStageableFiles` zips these verdicts back against its candidates by index.
        const results = await mapWithLimit([30, 0, 15], 3, ms => later(ms, ms));

        assert.deepStrictEqual(results, [30, 0, 15]);
    });

    test("should keep at most `limit` calls in flight", async () => {
        let inFlight = 0;
        let peak = 0;

        await mapWithLimit(Array.from({ length: 20 }, (_, i) => i), 3, async item => {
            peak = Math.max(peak, ++inFlight);
            await later(item, item % 4);
            inFlight--;
            return item;
        });

        assert.strictEqual(peak, 3);
    });

    test("should handle an empty input", async () => {
        assert.deepStrictEqual(await mapWithLimit([], 4, async item => item), []);
    });

    test("should handle a limit above the item count", async () => {
        assert.deepStrictEqual(await mapWithLimit([1, 2], 10, async item => item * 2), [2, 4]);
    });
});

suite("FileUtils Tests", () => {
    suite("getImportPath", () => {
        test("should prefix a sibling with ./", () => {
            assert.strictEqual(FileUtils.getImportPath(path.join("src", "a.ts"), path.join("src", "b.ts")), "./b");
        });

        test("should reach a parent directory with ../", () => {
            assert.strictEqual(FileUtils.getImportPath(path.join("src", "nested", "a.ts"), path.join("src", "b.ts")), "../b");
        });

        test("should drop a .tsx extension", () => {
            assert.strictEqual(FileUtils.getImportPath(path.join("src", "a.ts"), path.join("src", "Button.tsx")), "./Button");
        });

        test("should write separators the way an import does", () => {
            assert.strictEqual(FileUtils.getImportPath(path.join("src", "a.ts"), path.join("src", "ui", "deep", "b.ts")), "./ui/deep/b");
        });
    });
});

suite("NestUtils Tests", () => {
    suite("ControllerName", () => {
        test("should strip a Controller suffix whatever its casing", () => {
            assert.strictEqual(new ControllerName("UserController", "/api").shortName, "User");
            assert.strictEqual(new ControllerName("usercontroller", "/api").shortName, "User");
        });

        test("should build the file name from the kebab-cased short name", () => {
            const name = new ControllerName("UserProfileController", "/api");

            assert.strictEqual(name.slug, "user-profile");
            assert.strictEqual(name.fileName, "user-profile.controller.ts");
            assert.strictEqual(name.filePath, path.join("/api", "user-profile.controller.ts"));
        });

        test("should PascalCase a lowercase name", () => {
            const name = new ControllerName("user profile", "/api");

            assert.strictEqual(name.shortName, "UserProfile");
            assert.strictEqual(name.className, "UserProfileController");
        });
    });
});

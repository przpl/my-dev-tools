import * as assert from "assert";

import { isMarkdownFile, outlineMarkdown, summarizeScript } from "../../../features/git/addedFileSummary";

suite("AddedFileSummary Tests", () => {
    suite("summarizeScript", () => {
        test("should stub a function body and keep its signature", () => {
            const source = ["export function add(a: number, b: number): number {", "    const sum = a + b;", "    return sum;", "}"].join("\n");

            assert.strictEqual(summarizeScript("a.ts", source), "export function add(a: number, b: number): number { /* 4 lines */ }");
        });

        test("should keep types, constants and comments untouched", () => {
            const source = [
                "// A leading comment.",
                "export const LIMIT = 10;",
                "",
                "export type Mode = 'fast' | 'slow';",
                "",
                "export interface Options {",
                "    mode: Mode;",
                "}",
                "",
                "/** Runs it. */",
                "export function run(options: Options): void {",
                "    console.log(options.mode);",
                "    console.log(LIMIT);",
                "    console.log('done');",
                "}",
            ].join("\n");

            const summary = summarizeScript("a.ts", source)!;

            assert.ok(summary.includes("// A leading comment."));
            assert.ok(summary.includes("export const LIMIT = 10;"));
            assert.ok(summary.includes("export type Mode = 'fast' | 'slow';"));
            assert.ok(summary.includes("    mode: Mode;"), "An interface body is not a statement body");
            assert.ok(summary.includes("/** Runs it. */"));
            assert.ok(!summary.includes("console.log"));
        });

        test("should stub class methods and the constructor", () => {
            const source = [
                "export class Service {",
                "    constructor(private readonly name: string) {",
                "        this.name = name.trim();",
                "        this.check();",
                "    }",
                "",
                "    check(): void {",
                "        if (!this.name) {",
                "            throw new Error('empty');",
                "        }",
                "    }",
                "}",
            ].join("\n");

            const summary = summarizeScript("a.ts", source)!;

            assert.ok(summary.includes("export class Service {"));
            assert.ok(summary.includes("constructor(private readonly name: string) { /* 4 lines */ }"));
            assert.ok(summary.includes("check(): void { /* 5 lines */ }"));
            assert.ok(!summary.includes("throw new Error"));
        });

        test("should stub only the outermost body when a closure is nested inside one", () => {
            const source = [
                "export function outer(items: number[]): number[] {",
                "    return items.map(item => {",
                "        const doubled = item * 2;",
                "        return doubled;",
                "    });",
                "}",
            ].join("\n");

            assert.strictEqual(summarizeScript("a.ts", source), "export function outer(items: number[]): number[] { /* 6 lines */ }");
        });

        test("should stub a body inside a JSX component", () => {
            const source = [
                "export function Button({ label }: { label: string }) {",
                "    const upper = label.toUpperCase();",
                "    const id = upper.toLowerCase();",
                "    return <button id={id}>{upper}</button>;",
                "}",
            ].join("\n");

            const summary = summarizeScript("Button.tsx", source)!;

            assert.ok(summary.includes("export function Button({ label }: { label: string }) { /* 5 lines */ }"));
            assert.ok(!summary.includes("toUpperCase"));
        });

        test("should return undefined for a file that does not parse", () => {
            assert.strictEqual(summarizeScript("a.ts", "export function broken( {{{ ---"), undefined);
        });

        test("should return undefined when there is no body worth stubbing", () => {
            assert.strictEqual(summarizeScript("a.ts", "export const value = 1;\nexport type Mode = 'a';"), undefined);
        });

        test("should leave a one-statement body alone, since the stub is no shorter", () => {
            assert.strictEqual(summarizeScript("a.ts", "export function one() { return 1; }"), undefined);
        });

        test("should return undefined for a file it cannot classify", () => {
            assert.strictEqual(summarizeScript("a.py", "def add(a, b):\n    return a + b"), undefined);
        });
    });

    suite("outlineMarkdown", () => {
        test("should keep headings and count the prose between them", () => {
            const source = ["# Title", "", "Intro paragraph.", "More intro.", "", "## Usage", "", "Run it."].join("\n");

            assert.strictEqual(outlineMarkdown(source), ["# Title", "<4 lines>", "## Usage", "<2 lines>"].join("\n"));
        });

        test("should not treat a comment inside a fenced block as a heading", () => {
            const source = ["# Title", "", "```sh", "# not a heading", "npm install", "```", "", "## Real"].join("\n");

            const outline = outlineMarkdown(source)!;

            assert.ok(!outline.includes("not a heading"));
            assert.ok(outline.includes("## Real"));
        });

        test("should return undefined for a document with no headings", () => {
            assert.strictEqual(outlineMarkdown("Just some prose.\nAnd more of it."), undefined);
        });
    });

    suite("isMarkdownFile", () => {
        test("should recognise markdown extensions and reject others", () => {
            assert.ok(isMarkdownFile("docs/guide.md"));
            assert.ok(isMarkdownFile("docs/guide.MDX"));
            assert.ok(!isMarkdownFile("src/app.ts"));
            assert.ok(!isMarkdownFile("README"));
        });
    });
});

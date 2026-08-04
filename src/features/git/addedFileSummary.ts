import * as path from "path";
import { ts } from "ts-morph";

/**
 * Reduces a newly added file to the part a commit message can use. A new file is the one case where
 * the diff carries a whole program rather than an edit to one: every line arrives as `+`, so the
 * bodies of its functions are paid for in full even though the message only ever describes what the
 * file *is*. Declarations, types, comments and constants stay; statement bodies become a stub.
 *
 * Pure text in, pure text out, so it is testable without a repository.
 */

const MARKDOWN_FILE = /\.mdx?$/i;

/** Bodies below this many lines cost less than the stub that would replace them. */
const MIN_STUBBED_BODY_LINES = 3;

export function isMarkdownFile(filePath: string): boolean {
    return MARKDOWN_FILE.test(path.extname(filePath));
}

const SCRIPT_KINDS = new Map<string, ts.ScriptKind>([
    [".ts", ts.ScriptKind.TS],
    [".mts", ts.ScriptKind.TS],
    [".cts", ts.ScriptKind.TS],
    [".tsx", ts.ScriptKind.TSX],
    [".js", ts.ScriptKind.JS],
    [".mjs", ts.ScriptKind.JS],
    [".cjs", ts.ScriptKind.JS],
    [".jsx", ts.ScriptKind.JSX],
]);

/** A generated or vendored file that slipped past the exclusions is not worth the parse. */
const MAX_PARSED_LENGTH = 2 * 1024 * 1024;

interface Span {
    start: number;
    end: number;
    lines: number;
}

function hasBlockBody(node: ts.Node): node is ts.Node & { body: ts.Block } {
    if (
        !ts.isFunctionDeclaration(node) &&
        !ts.isMethodDeclaration(node) &&
        !ts.isConstructorDeclaration(node) &&
        !ts.isGetAccessorDeclaration(node) &&
        !ts.isSetAccessorDeclaration(node) &&
        !ts.isFunctionExpression(node) &&
        !ts.isArrowFunction(node)
    ) {
        return false;
    }

    const body = (node as ts.FunctionLikeDeclaration).body;
    return body !== undefined && ts.isBlock(body) && body.statements.length > 0;
}

/**
 * Outermost block bodies, in source order. Only the outermost matters: replacing it already removes
 * every closure nested inside, and a nested span would splice into text that no longer exists.
 */
function collectBodySpans(sourceFile: ts.SourceFile): Span[] {
    const spans: Span[] = [];

    const visit = (node: ts.Node): void => {
        if (hasBlockBody(node)) {
            const { body } = node;
            const start = body.getStart(sourceFile);
            const lines = sourceFile.text.slice(start, body.end).split("\n").length;

            if (lines >= MIN_STUBBED_BODY_LINES) {
                spans.push({ start, end: body.end, lines });
                return;
            }
        }

        node.forEachChild(visit);
    };

    visit(sourceFile);
    return spans;
}

/**
 * The declaration surface of a script: imports, exports, types, interfaces, constants, signatures
 * and every comment, with statement bodies replaced by a note giving their size. Returns undefined
 * when the file will not parse or when the summary would not actually be shorter.
 */
export function summarizeScript(filePath: string, source: string): string | undefined {
    const scriptKind = SCRIPT_KINDS.get(path.extname(filePath).toLowerCase());
    if (!scriptKind || source.length > MAX_PARSED_LENGTH) {
        return undefined;
    }

    const sourceFile = ts.createSourceFile(path.basename(filePath), source, ts.ScriptTarget.Latest, true, scriptKind);

    // A file that does not parse would be summarized from a garbage tree, dropping real code.
    const diagnostics = (sourceFile as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics;
    if (diagnostics && diagnostics.length > 0) {
        return undefined;
    }

    const spans = collectBodySpans(sourceFile);
    if (spans.length === 0) {
        return undefined;
    }

    let summary = "";
    let cursor = 0;

    for (const span of spans) {
        summary += source.slice(cursor, span.start) + `{ /* ${span.lines} lines */ }`;
        cursor = span.end;
    }
    summary += source.slice(cursor);

    return summary.length < source.length ? summary : undefined;
}

const HEADING = /^\s{0,3}#{1,6}\s/;
const FENCE = /^\s{0,3}(?:```|~~~)/;

/**
 * The heading outline of a document, with the prose between headings replaced by a line count. What
 * a new document is about survives; what it says does not, which is why the caller only reaches for
 * this on documents too long to send whole.
 */
export function outlineMarkdown(source: string): string | undefined {
    const outline: string[] = [];
    let skipped = 0;
    let fenced = false;

    const flushProse = (): void => {
        if (skipped > 0) {
            outline.push(`<${skipped} lines>`);
            skipped = 0;
        }
    };

    for (const line of source.split("\n")) {
        // A `#` inside a fenced block is a comment or a shell prompt, not a heading.
        if (FENCE.test(line)) {
            fenced = !fenced;
        }

        if (!fenced && HEADING.test(line)) {
            flushProse();
            outline.push(line);
            continue;
        }

        skipped++;
    }

    flushProse();

    if (outline.every(line => !HEADING.test(line))) {
        return undefined;
    }

    const summary = outline.join("\n");
    return summary.length < source.length ? summary : undefined;
}

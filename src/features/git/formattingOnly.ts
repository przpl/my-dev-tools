import * as path from "path";
import { ts } from "ts-morph";

/**
 * `git diff --ignore-all-space` compares line by line, so it only sees through whitespace *inside* a
 * line. A formatter that re-wraps one long line into several (or joins several into one) produces a
 * genuine line-level change that no git flag can ignore. This module answers the same question at
 * the syntax level instead: do both versions of the file parse into the same tokens?
 */

const SCRIPT_KINDS = new Map<string, ts.ScriptKind>([
    [".ts", ts.ScriptKind.TS],
    [".mts", ts.ScriptKind.TS],
    [".cts", ts.ScriptKind.TS],
    [".tsx", ts.ScriptKind.TSX],
    // ScriptKind.JS and .JSX both parse with the JSX language variant, which is what `.js` React files need.
    [".js", ts.ScriptKind.JS],
    [".mjs", ts.ScriptKind.JS],
    [".cjs", ts.ScriptKind.JS],
    [".jsx", ts.ScriptKind.JSX],
]);

/** Guards against spending seconds parsing a generated bundle that was checked in. */
const MAX_PARSEABLE_LENGTH = 2 * 1024 * 1024;

const COMMENT_ENTRY = -1;

/** Only files this module can parse are eligible; reflow in Markdown or YAML is not cosmetic. */
export function isParseable(filePath: string): boolean {
    return SCRIPT_KINDS.has(path.extname(filePath).toLowerCase());
}

function parse(filePath: string, text: string): ts.SourceFile | undefined {
    const scriptKind = SCRIPT_KINDS.get(path.extname(filePath).toLowerCase());
    if (!scriptKind || text.length > MAX_PARSEABLE_LENGTH) {
        return undefined;
    }

    const sourceFile = ts.createSourceFile(path.basename(filePath), text, ts.ScriptTarget.Latest, true, scriptKind);

    // A half-typed file must never be classified as a formatting change: its token stream is garbage.
    const diagnostics = (sourceFile as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics;
    return diagnostics && diagnostics.length > 0 ? undefined : sourceFile;
}

/**
 * JSX collapses the whitespace around newlines in element children before it reaches the DOM: lines
 * are trimmed, blank ones dropped, and the rest joined with a single space. Applying the same rule
 * lets an indented `<div>` body compare equal without ignoring whitespace that actually renders.
 */
function normalizeJsxText(text: string): string {
    const lines = text.split(/\r\n|\n|\r/);
    const kept: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (i > 0) {
            line = line.replace(/^[\t ]+/, "");
        }
        if (i < lines.length - 1) {
            line = line.replace(/[\t ]+$/, "");
        }
        if (line.length > 0) {
            kept.push(line);
        }
    }

    return kept.join(" ");
}

/** Re-indenting a block comment rewrites its interior, which is not a change worth reviewing. */
function normalizeComment(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

interface Token {
    kind: number;
    text: string;
}

function collectTokens(sourceFile: ts.SourceFile): Token[] {
    const tokens: Token[] = [];
    const text = sourceFile.text;

    const visit = (node: ts.Node): void => {
        const children = node.getChildren(sourceFile);
        if (children.length > 0) {
            children.forEach(visit);
            return;
        }

        // An empty SyntaxList (a missing argument or attribute list) carries no information.
        if (node.kind === ts.SyntaxKind.SyntaxList) {
            return;
        }

        if (node.kind === ts.SyntaxKind.JsxText) {
            // JSX children have no trivia, so the leading whitespace `getStart` would skip is part of the text.
            tokens.push({ kind: node.kind, text: normalizeJsxText(text.substring(node.pos, node.end)) });
            return;
        }

        // Comments are trivia and never appear as tokens; collect them so deleting one is still a real change.
        for (const range of ts.getLeadingCommentRanges(text, node.pos) ?? []) {
            tokens.push({ kind: COMMENT_ENTRY, text: normalizeComment(text.substring(range.pos, range.end)) });
        }

        tokens.push({ kind: node.kind, text: text.substring(node.getStart(sourceFile), node.end) });
    };

    visit(sourceFile);
    return tokens;
}

function tokensEqual(a: Token[], b: Token[]): boolean {
    return a.length === b.length && a.every((token, i) => token.kind === b[i].kind && token.text === b[i].text);
}

const CLOSING_KINDS = new Set<number>([ts.SyntaxKind.CloseParenToken, ts.SyntaxKind.CloseBracketToken, ts.SyntaxKind.CloseBraceToken]);

/**
 * Drops the punctuation a formatter adds purely because it broke an expression across lines: the
 * parentheses around the wrapped expression and the trailing comma before the closing bracket. Both
 * arrive in the same edit, so they have to be dropped in the same pass.
 */
function withoutLayoutTokens(tokens: Token[]): Token[] {
    return tokens.filter((token, i) => {
        if (token.kind === ts.SyntaxKind.OpenParenToken || token.kind === ts.SyntaxKind.CloseParenToken) {
            return false;
        }

        // The neighbour is read from the unfiltered stream because the closing bracket may itself be dropped.
        return !(token.kind === ts.SyntaxKind.CommaToken && CLOSING_KINDS.has(tokens[i + 1]?.kind));
    });
}

function unwrapParentheses(node: ts.Node): ts.Node {
    let current = node;
    while (ts.isParenthesizedExpression(current)) {
        current = current.expression;
    }
    return current;
}

function childrenOf(node: ts.Node): ts.Node[] {
    const children: ts.Node[] = [];
    node.forEachChild(child => void children.push(unwrapParentheses(child)));
    return children;
}

/** Structural comparison that looks straight through grouping parentheses. */
function treesEqual(a: ts.Node, b: ts.Node): boolean {
    if (a.kind !== b.kind) {
        return false;
    }

    const childrenA = childrenOf(a);
    const childrenB = childrenOf(b);

    return childrenA.length === childrenB.length && childrenA.every((child, i) => treesEqual(child, childrenB[i]));
}

/**
 * True when `before` and `after` differ only in layout: indentation, line breaks, blank lines and the
 * parentheses a formatter adds when it wraps an expression across lines.
 *
 * Identical token streams cover re-indentation and re-wrapping. The punctuation case additionally
 * requires the syntax trees to match with grouping parentheses removed, so a change that re-associates
 * an expression - `(a + b) * c` to `a + b * c` - is still rejected.
 */
export function isFormattingOnlyChange(filePath: string, before: string, after: string): boolean {
    // Working-tree line endings depend on core.autocrlf while the blob is stored with LF; that is not a review-worthy difference.
    const beforeFile = parse(filePath, before.replace(/\r\n/g, "\n"));
    const afterFile = parse(filePath, after.replace(/\r\n/g, "\n"));
    if (!beforeFile || !afterFile) {
        return false;
    }

    const beforeTokens = collectTokens(beforeFile);
    const afterTokens = collectTokens(afterFile);

    if (tokensEqual(beforeTokens, afterTokens)) {
        return true;
    }

    if (!tokensEqual(withoutLayoutTokens(beforeTokens), withoutLayoutTokens(afterTokens))) {
        return false;
    }

    return treesEqual(beforeFile, afterFile);
}

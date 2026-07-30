import * as path from "path";
import { ts } from "ts-morph";

/**
 * Decides whether two versions of a TypeScript or JavaScript file are the same program. `git diff
 * --ignore-all-space` cannot answer this: it compares whole lines, so re-wrapping one line into
 * several always looks like a real change, and it ignores whitespace *inside* string literals, so
 * turning `"hello world"` into `"helloworld"` looks like no change at all. Both versions are parsed
 * and compared as token streams instead.
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

const COMMENT_ENTRY = -1;

export function isScriptFile(filePath: string): boolean {
    return SCRIPT_KINDS.has(path.extname(filePath).toLowerCase());
}

function parse(filePath: string, text: string): ts.SourceFile | undefined {
    const scriptKind = SCRIPT_KINDS.get(path.extname(filePath).toLowerCase());
    if (!scriptKind) {
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

/**
 * Undoes the re-quoting a formatter does when it switches a file to its preferred quote character:
 * `'it\'s'` and `"it's"` both become `it's`. Only the two quote escapes are unwrapped, so a rewrite
 * that changes what the string contains - `"A"` against `"A"` - still compares as different.
 */
function normalizeStringLiteral(raw: string): string {
    const inner = raw.slice(1, -1);
    let normalized = "";

    for (let i = 0; i < inner.length; i++) {
        const char = inner[i];
        if (char !== "\\" || i + 1 >= inner.length) {
            normalized += char;
            continue;
        }

        const escaped = inner[i + 1];
        normalized += escaped === "'" || escaped === '"' ? escaped : char + escaped;
        i++;
    }

    return normalized;
}

/**
 * Two numeric literals with the same value are the same program, so `1_000` and `1000` - or the
 * lower-cased hex and dropped exponent sign a formatter produces - compare equal. A leading zero is
 * left alone because `010` is 8 in sloppy mode but `Number` reads it as ten.
 */
function normalizeNumericLiteral(raw: string): string {
    if (/^0\d/.test(raw)) {
        return raw;
    }

    const value = Number(raw.replace(/_/g, ""));
    return Number.isNaN(value) ? raw : String(value);
}

function normalizeBigIntLiteral(raw: string): string {
    try {
        return `${BigInt(raw.replace(/_/g, "").slice(0, -1))}n`;
    } catch {
        return raw;
    }
}

function normalizeLeafText(node: ts.Node, raw: string): string {
    switch (node.kind) {
        case ts.SyntaxKind.StringLiteral:
            // A backslash is not an escape character in a JSX attribute value, so only the quotes are dropped there.
            return ts.isJsxAttribute(node.parent) ? raw.slice(1, -1) : normalizeStringLiteral(raw);
        case ts.SyntaxKind.NumericLiteral:
            return normalizeNumericLiteral(raw);
        case ts.SyntaxKind.BigIntLiteral:
            return normalizeBigIntLiteral(raw);
        default:
            return raw;
    }
}

interface Token {
    kind: number;
    text: string;
}

/** Sort key for one binding. The separator is a character no token text can hold, so keys cannot collide. */
function groupKey(tokens: Token[]): string {
    return tokens.map(token => `${token.kind}:${token.text}`).join("\u0000");
}

function collectTokens(sourceFile: ts.SourceFile): Token[] {
    const tokens: Token[] = [];
    const text = sourceFile.text;

    const collect = (node: ts.Node, into: Token[]): void => {
        const children = node.getChildren(sourceFile);

        if (children.length > 0) {
            if (ts.isNamedImports(node) || ts.isNamedExports(node)) {
                collectSortedBindings(node, children, into);
                return;
            }

            children.forEach(child => collect(child, into));
            return;
        }

        // An empty SyntaxList (a missing argument or attribute list) carries no information.
        if (node.kind === ts.SyntaxKind.SyntaxList) {
            return;
        }

        if (node.kind === ts.SyntaxKind.JsxText) {
            // JSX children have no trivia, so the leading whitespace `getStart` would skip is part of the text.
            into.push({ kind: node.kind, text: normalizeJsxText(text.substring(node.pos, node.end)) });
            return;
        }

        // Comments are trivia and never appear as tokens; collect them so deleting one is still a real change.
        for (const range of ts.getLeadingCommentRanges(text, node.pos) ?? []) {
            into.push({ kind: COMMENT_ENTRY, text: normalizeComment(text.substring(range.pos, range.end)) });
        }

        into.push({ kind: node.kind, text: normalizeLeafText(node, text.substring(node.getStart(sourceFile), node.end)) });
    };

    /**
     * `import { b, a }` binds exactly the same names as `import { a, b }`, and a module namespace
     * object lists its keys in the order the language chooses rather than the order they were
     * exported, so `export { b, a }` is interchangeable too. Both are emitted in a canonical order
     * with the separators rebuilt, which also absorbs a trailing comma appearing or disappearing.
     */
    const collectSortedBindings = (node: ts.NamedImports | ts.NamedExports, children: readonly ts.Node[], into: Token[]): void => {
        const groups = node.elements.map(element => {
            const group: Token[] = [];
            collect(element, group);
            return group;
        });

        groups.sort((a, b) => {
            const [keyA, keyB] = [groupKey(a), groupKey(b)];
            return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
        });

        collect(children[0], into);
        groups.forEach((group, i) => {
            if (i > 0) {
                into.push({ kind: ts.SyntaxKind.CommaToken, text: "," });
            }
            into.push(...group);
        });
        collect(children[children.length - 1], into);
    };

    collect(sourceFile, tokens);
    return tokens;
}

function tokensEqual(a: Token[], b: Token[]): boolean {
    return a.length === b.length && a.every((token, i) => token.kind === b[i].kind && token.text === b[i].text);
}

const CLOSING_KINDS = new Set<number>([ts.SyntaxKind.CloseParenToken, ts.SyntaxKind.CloseBracketToken, ts.SyntaxKind.CloseBraceToken]);

/**
 * Drops the punctuation whose presence a formatter decides on its own: the parentheses around a
 * wrapped expression, the trailing comma before a closing bracket, and the semicolons a style adds
 * or leaves to automatic insertion. None of them carry text, which is what makes dropping them safe
 * to pair with the structural check below - identifiers and literals are never dropped, only
 * normalized, so their text is always compared.
 */
function withoutLayoutTokens(tokens: Token[]): Token[] {
    return tokens.filter((token, i) => {
        if (token.kind === ts.SyntaxKind.OpenParenToken || token.kind === ts.SyntaxKind.CloseParenToken) {
            return false;
        }

        if (token.kind === ts.SyntaxKind.SemicolonToken) {
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
 * True when `before` and `after` are the same program: they may differ in indentation, line breaks,
 * blank lines, quote style, numeric literal spelling, the order of names inside import or export
 * braces, and the punctuation a formatter chooses - grouping parentheses, trailing commas and
 * semicolons.
 *
 * Identical token streams cover everything except the punctuation, which additionally requires the
 * syntax trees to match with grouping parentheses removed, so a change that re-associates an
 * expression - `(a + b) * c` to `a + b * c` - is still rejected.
 */
export function isScriptFormattingOnlyChange(filePath: string, before: string, after: string): boolean {
    const beforeFile = parse(filePath, before);
    const afterFile = parse(filePath, after);
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

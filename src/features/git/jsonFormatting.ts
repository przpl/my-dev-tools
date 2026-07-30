import { createScanner, ScanError, SyntaxKind } from "jsonc-parser";
import * as path from "path";

/**
 * Whitespace between JSON tokens is never significant, so a re-indented or re-flowed document is the
 * same document. Comparing token streams rather than `JSON.parse` results keeps three things intact
 * that parsing would quietly discard: the order of the keys, the exact spelling of a number too
 * large for a double, and the comments a `.json` file is allowed to carry in practice.
 *
 * The scanner is the one VS Code reads its own configuration with, so a file the editor accepts is a
 * file this rule can classify.
 */

const JSON_EXTENSIONS = new Set([".json", ".jsonc"]);

export function isJsonFile(filePath: string): boolean {
    return JSON_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/** Re-indenting a block comment rewrites its interior, which is not a change worth reviewing. */
function normalizeComment(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

interface JsonToken {
    kind: SyntaxKind;
    text: string;
}

/** The document reduced to its tokens and comments, or `undefined` when it is not JSON at all. */
function tokenize(text: string): JsonToken[] | undefined {
    const scanner = createScanner(text, /* ignoreTrivia */ false);
    const tokens: JsonToken[] = [];

    for (let kind = scanner.scan(); kind !== SyntaxKind.EOF; kind = scanner.scan()) {
        if (scanner.getTokenError() !== ScanError.None || kind === SyntaxKind.Unknown) {
            return undefined;
        }

        if (kind === SyntaxKind.Trivia || kind === SyntaxKind.LineBreakTrivia) {
            continue;
        }

        // Read the raw slice rather than `getTokenValue`, which unescapes. An escape being rewritten
        // is a change to the source, and it is rejected here for the same reason it is in a script file.
        const offset = scanner.getTokenOffset();
        const raw = text.substring(offset, offset + scanner.getTokenLength());
        const isComment = kind === SyntaxKind.LineCommentTrivia || kind === SyntaxKind.BlockCommentTrivia;

        // Comments are collected rather than skipped, so deleting one is still a real change.
        tokens.push({ kind, text: isComment ? normalizeComment(raw) : raw });
    }

    return tokens;
}

/** True when `before` and `after` are the same JSON document laid out differently. */
export function isJsonFormattingOnlyChange(before: string, after: string): boolean {
    const beforeTokens = tokenize(before);
    const afterTokens = tokenize(after);

    if (!beforeTokens || !afterTokens || beforeTokens.length !== afterTokens.length) {
        return false;
    }

    return beforeTokens.every((token, i) => token.kind === afterTokens[i].kind && token.text === afterTokens[i].text);
}

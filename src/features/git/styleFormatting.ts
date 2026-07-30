import * as path from "path";

/**
 * Reduces a stylesheet to a canonical form so that re-indenting it, or collapsing a rule onto one
 * line, compares equal. Whitespace between style tokens only ever acts as a separator, with two
 * exceptions this scanner has to respect: it is content inside strings and `url()`, and between two
 * selectors it *is* the descendant combinator, so runs are collapsed to a single space rather than
 * removed. Whitespace is only removed next to the punctuation that already separates tokens on its
 * own - never next to `:`, because `a :hover` and `a:hover` match different elements.
 */

const STYLE_EXTENSIONS = new Set([".css", ".scss", ".less"]);

/** Punctuation that separates tokens by itself, so whitespace beside it cannot change the meaning. */
const SELF_SEPARATING = new Set(["{", "}", ";", ",", "(", ")"]);

/** Stands in for a run of separator whitespace. No real token can contain a space, so it cannot collide. */
const SPACE_RUN = " space run";

export function isStyleFile(filePath: string): boolean {
    return STYLE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/** Reads a quoted string; style strings cannot span lines, so a newline means the file is malformed. */
function readString(text: string, start: number): number {
    const quote = text[start];

    for (let i = start + 1; i < text.length; i++) {
        if (text[i] === "\\") {
            i++;
        } else if (text[i] === quote) {
            return i + 1;
        } else if (text[i] === "\n") {
            return -1;
        }
    }

    return -1;
}

function tokenize(text: string): string[] | undefined {
    const tokens: string[] = [];
    let i = 0;

    /** An unquoted `url()` payload is content - and can hold a `//` that is not a comment - so it is copied through. */
    const takeUnquotedUrl = (): boolean => {
        const isUrlCall = tokens[tokens.length - 1] === "(" && tokens[tokens.length - 2]?.toLowerCase().endsWith("url");
        if (!isUrlCall || text[i] === '"' || text[i] === "'") {
            return false;
        }

        const end = text.indexOf(")", i);
        if (end === -1 || end === i) {
            return false;
        }

        tokens.push(text.substring(i, end));
        i = end;
        return true;
    };

    while (i < text.length) {
        const char = text[i];

        if (/\s/.test(char)) {
            while (i < text.length && /\s/.test(text[i])) {
                i++;
            }
            tokens.push(SPACE_RUN);
        } else if (takeUnquotedUrl()) {
            continue;
        } else if (char === '"' || char === "'") {
            const end = readString(text, i);
            if (end === -1) {
                return undefined;
            }
            tokens.push(text.substring(i, end));
            i = end;
        } else if (text.startsWith("/*", i)) {
            const end = text.indexOf("*/", i + 2);
            if (end === -1) {
                return undefined;
            }
            // Re-indenting a block comment rewrites its interior, which is not a change worth reviewing.
            tokens.push(text.substring(i, end + 2).replace(/\s+/g, " "));
            i = end + 2;
        } else if (text.startsWith("//", i)) {
            const end = text.indexOf("\n", i);
            tokens.push(text.substring(i, end === -1 ? text.length : end).trimEnd());
            i = end === -1 ? text.length : end;
        } else if (SELF_SEPARATING.has(char)) {
            tokens.push(char);
            i++;
        } else {
            let end = i;
            while (end < text.length && !/[\s"']/.test(text[end]) && !SELF_SEPARATING.has(text[end])) {
                end++;
            }
            tokens.push(text.substring(i, end));
            i = end;
        }
    }

    return tokens;
}

/** Drops the separator runs that sit next to punctuation which separates tokens anyway. */
function canonicalize(tokens: string[]): string {
    return tokens
        .filter((token, i) => {
            if (token !== SPACE_RUN) {
                return true;
            }

            const previous = tokens[i - 1];
            const next = tokens[i + 1];
            return previous !== undefined && next !== undefined && !SELF_SEPARATING.has(previous) && !SELF_SEPARATING.has(next);
        })
        .map(token => (token === SPACE_RUN ? " " : token))
        .join("");
}

/** True when `before` and `after` are the same stylesheet laid out differently. */
export function isStyleFormattingOnlyChange(before: string, after: string): boolean {
    const beforeTokens = tokenize(before);
    const afterTokens = tokenize(after);

    if (!beforeTokens || !afterTokens) {
        return false;
    }

    return canonicalize(beforeTokens) === canonicalize(afterTokens);
}

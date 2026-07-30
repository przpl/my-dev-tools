import { isJsonFile, isJsonFormattingOnlyChange } from "./jsonFormatting";
import { isScriptFile, isScriptFormattingOnlyChange } from "./scriptFormatting";
import { isStyleFile, isStyleFormattingOnlyChange } from "./styleFormatting";

/**
 * Routes a file to the comparison that can prove two versions of it are equivalent. Only formats
 * with a scanner here are ever eligible: whitespace is content in Markdown, YAML, Python and plain
 * text, so a "cosmetic" change to one of those is not something this feature can vouch for.
 */

/** Guards against spending seconds parsing a generated bundle that was checked in. */
const MAX_COMPARABLE_LENGTH = 2 * 1024 * 1024;

export function isSupportedFile(filePath: string): boolean {
    return isScriptFile(filePath) || isJsonFile(filePath) || isStyleFile(filePath);
}

export function isFormattingOnlyChange(filePath: string, before: string, after: string): boolean {
    if (before.length > MAX_COMPARABLE_LENGTH || after.length > MAX_COMPARABLE_LENGTH) {
        return false;
    }

    // Working-tree line endings depend on core.autocrlf while the blob is stored with LF; that is not a
    // review-worthy difference, and no format here can hold a raw CRLF inside a string.
    const [normalizedBefore, normalizedAfter] = [before.replace(/\r\n/g, "\n"), after.replace(/\r\n/g, "\n")];

    if (isScriptFile(filePath)) {
        return isScriptFormattingOnlyChange(filePath, normalizedBefore, normalizedAfter);
    }

    if (isJsonFile(filePath)) {
        return isJsonFormattingOnlyChange(normalizedBefore, normalizedAfter);
    }

    if (isStyleFile(filePath)) {
        return isStyleFormattingOnlyChange(normalizedBefore, normalizedAfter);
    }

    return false;
}

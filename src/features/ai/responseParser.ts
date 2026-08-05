/**
 * Reads what the model sent back. Two jobs: undo the markdown fence models add however firmly they
 * are told not to, and pull apart the `<file path="...">` blocks a file-producing command asks for.
 *
 * Tag-delimited blocks rather than fenced ones, because these commands routinely write Markdown,
 * and a fenced block inside a fenced block cannot be parsed without counting.
 */

export class ResponseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ResponseError";
    }
}

const OPENING_FENCE = /^```[\w+-]*$/;
const CLOSING_FENCE = /^```$/;

/**
 * Removes a fence wrapping the *whole* reply. Fences inside it are content and are left alone, so a
 * generated Markdown file keeps its code samples.
 */
export function stripFence(reply: string): string {
    const lines = reply.trim().split(/\r?\n/);

    if (lines.length >= 2 && OPENING_FENCE.test(lines[0].trim()) && CLOSING_FENCE.test(lines[lines.length - 1].trim())) {
        return lines.slice(1, -1).join("\n");
    }

    return reply.trim();
}

export interface ProposedFile {
    /** Workspace-relative, forward slashes, verified not to escape the workspace. */
    path: string;
    content: string;
}

const FILE_BLOCK = /<file\s+path\s*=\s*["']([^"']+)["']\s*>\r?\n?([\s\S]*?)\r?\n?<\/file>/g;

/** A path that would write outside the workspace is a bug or a prompt injection; either way, no. */
function normalizePath(raw: string): string {
    const normalized = raw.trim().replace(/\\/g, "/").replace(/^\.\//, "");

    if (normalized === "") {
        throw new ResponseError("The model returned a file block with an empty path.");
    }
    if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
        throw new ResponseError(`The model returned an absolute path (${raw}); only workspace-relative paths can be written.`);
    }
    if (normalized.split("/").includes("..")) {
        throw new ResponseError(`The model returned a path escaping the workspace (${raw}).`);
    }

    return normalized;
}

export function parseFileBlocks(reply: string): ProposedFile[] {
    const files: ProposedFile[] = [];

    for (const [, rawPath, content] of reply.matchAll(FILE_BLOCK)) {
        files.push({ path: normalizePath(rawPath), content: stripFence(content) });
    }

    if (files.length === 0) {
        throw new ResponseError('The model replied without any <file path="..."> block, so there is nothing to write.');
    }

    return files;
}

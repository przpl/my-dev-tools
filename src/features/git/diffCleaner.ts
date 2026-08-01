import { isMarkdownFile, outlineMarkdown, summarizeScript } from "./addedFileSummary";

/**
 * Compacts a unified diff into the smallest text that still answers "what changed". Everything a
 * commit message can never use — blob hashes, line numbers, file-mode bookkeeping, reformats,
 * import shuffling in a large change, the body of a whole file being added or deleted — is removed
 * before the diff is sent to a model.
 *
 * Pure text in, pure text out: no `vscode` and no `child_process`, so it is testable on its own.
 */

const SCRIPT_FILE = /\.(?:[mc]?[jt]sx?)$/i;

/** Trailing hunk-header context is the enclosing declaration; the line numbers around it are not. */
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(.*)$/;

const DROPPED_METADATA = /^(?:index |old mode |new mode |similarity index |dissimilarity index |\\ No newline at end of file)/;

/** A binary change has no `---`/`+++` pair, so its path has to come from this line instead. */
const BINARY_FILES = /^Binary files (.*) and (.*) differ$/;

export type FileChangeKind = "modified" | "added" | "deleted" | "renamed";

export interface DiffHunk {
    /** The enclosing declaration git reported on the `@@` line, when it found one. */
    context: string;
    /** Body lines, each still carrying its leading `+`, `-` or space. */
    lines: string[];
}

export interface DiffFile {
    path: string;
    previousPath?: string;
    kind: FileChangeKind;
    hunks: DiffHunk[];
    /** Replaces the body when there is nothing worth showing, e.g. `binary` or `formatting only`. */
    note?: string;
}

export interface CleanDiffOptions {
    /** Character budget for the rendered diff. */
    maxCharacters: number;
    /** Above this many rendered lines, import and re-export churn stops being worth its tokens. */
    stripImportsAboveLines: number;
    /** Repository-relative paths already proven to be reformats of the same source. */
    formattingOnlyPaths?: ReadonlySet<string>;
    /** Above this many added lines, a new script file is reduced to its declarations. 0 disables it. */
    summarizeAddedScriptsAboveLines?: number;
    /** Above this many added lines, a new document is reduced to its headings. 0 disables it. */
    outlineAddedMarkdownAboveLines?: number;
    /** Payload length each diff line is capped at, so one minified or embedded line costs a fixed price. 0 disables it. */
    maxLineLength?: number;
}

/** Strips the `a/` or `b/` that `git diff` puts in front of every path. */
function stripPrefix(rawPath: string): string {
    return rawPath.replace(/^[ab]\//, "");
}

/** Git quotes paths containing unusual characters; the quotes are not part of the name. */
function unquote(rawPath: string): string {
    return rawPath.startsWith('"') && rawPath.endsWith('"') ? rawPath.slice(1, -1) : rawPath;
}

function readPath(line: string, marker: string): string | undefined {
    const value = unquote(line.slice(marker.length).trim());
    return value === "/dev/null" ? undefined : stripPrefix(value);
}

/**
 * The path out of a `diff --git a/x b/x` line, which is the only place it appears when `-D` prints a
 * deleted file as a header with no body. The two halves must match for the split to be unambiguous,
 * since a path may itself contain " b/"; a rename names both sides on its own lines anyway.
 */
function readHeaderPath(line: string): string | undefined {
    const match = /^diff --git (?:a\/(.+) b\/\1|"a\/(.+)" "b\/\2")$/.exec(line.trim());
    return match ? match[1] ?? match[2] : undefined;
}

export function parseDiff(raw: string): DiffFile[] {
    const files: DiffFile[] = [];
    let file: DiffFile | undefined;
    let hunk: DiffHunk | undefined;

    const startFile = (): DiffFile => {
        hunk = undefined;
        file = { path: "", kind: "modified", hunks: [] };
        files.push(file);
        return file;
    };

    const lines = raw.split("\n");

    // A trailing newline splits into one empty element, which is not the blank context line below.
    if (lines[lines.length - 1] === "") {
        lines.pop();
    }

    for (const line of lines) {
        if (line.startsWith("diff --git ")) {
            // Provisional: a later `+++` or `rename to` line overrides it, and `+++ /dev/null` cannot.
            startFile().path = readHeaderPath(line) ?? "";
            continue;
        }

        if (!file) {
            continue;
        }

        const hunkHeader = HUNK_HEADER.exec(line);
        if (hunkHeader) {
            hunk = { context: hunkHeader[1].trim(), lines: [] };
            file.hunks.push(hunk);
            continue;
        }

        if (hunk) {
            // A body line always starts with ' ', '+' or '-'; anything else ends the hunk.
            if (line.startsWith(" ") || line.startsWith("+") || line.startsWith("-")) {
                hunk.lines.push(line);
                continue;
            }
            if (line.length === 0) {
                // Git writes a context line for a blank source line as a lone space, but some tools
                // trim it. Treat a bare empty line inside a hunk as that context line.
                hunk.lines.push(" ");
                continue;
            }
            hunk = undefined;
        }

        if (DROPPED_METADATA.test(line)) {
            continue;
        }

        if (line.startsWith("new file mode ")) {
            file.kind = "added";
        } else if (line.startsWith("deleted file mode ")) {
            file.kind = "deleted";
        } else if (line.startsWith("rename from ") || line.startsWith("copy from ")) {
            file.kind = "renamed";
            file.previousPath = unquote(line.slice(line.indexOf("from ") + 5).trim());
        } else if (line.startsWith("rename to ") || line.startsWith("copy to ")) {
            file.kind = "renamed";
            file.path = unquote(line.slice(line.indexOf("to ") + 3).trim());
        } else if (line.startsWith("--- ")) {
            const previous = readPath(line, "--- ");
            if (previous && !file.previousPath) {
                file.previousPath = previous;
            }
        } else if (line.startsWith("+++ ")) {
            const current = readPath(line, "+++ ");
            if (current) {
                file.path = current;
            }
        } else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
            file.note = "binary";

            const operands = BINARY_FILES.exec(line);
            if (operands) {
                file.path ||= readPath(operands[2], "") ?? "";
                file.previousPath ??= readPath(operands[1], "");
            }
        }
    }

    // A delete has no `+++` path and a binary change may have neither; fall back to what we do have.
    for (const parsed of files) {
        if (!parsed.path && parsed.previousPath) {
            parsed.path = parsed.previousPath;
        }
    }

    return files.filter(parsed => parsed.path.length > 0);
}

function renderHeader(file: DiffFile): string {
    switch (file.kind) {
        case "added":
            return `+++ NEW ${file.path}`;
        case "deleted":
            return `--- DELETED ${file.path}`;
        case "renamed":
            return `RENAMED ${file.previousPath} -> ${file.path}`;
        default:
            return `--- ${file.path}`;
    }
}

export function renderDiff(files: DiffFile[]): string {
    const blocks: string[] = [];

    for (const file of files) {
        const header = renderHeader(file);

        if (file.note) {
            blocks.push(`${header}\n(${file.note})`);
            continue;
        }

        if (file.hunks.length === 0) {
            blocks.push(header);
            continue;
        }

        const body = file.hunks.map(hunk => [hunkHeaderText(hunk), ...hunk.lines].join("\n"));
        blocks.push([header, ...body].join("\n"));
    }

    return blocks.join("\n\n");
}

function isImportOrExportPlumbing(text: string): boolean {
    return (
        /^\s*import\b/.test(text) ||
        // `export {`, `export type {` and `export *` are re-exports; `export const|function|class` is code.
        /^\s*export\s+(?:type\s+)?[*{]/.test(text)
    );
}

/** Continuation lines of a multi-line specifier list, which carry no meaning on their own. */
function isSpecifierContinuation(text: string): boolean {
    return (
        /^\s*[{}]\s*,?\s*$/.test(text) ||
        /^\s*\}?\s*from\s+["'][^"']*["'];?\s*$/.test(text) ||
        /^\s*(?:type\s+)?[\w$]+(?:\s+as\s+[\w$]+)?\s*,?\s*$/.test(text) ||
        /^\s*\*\s+as\s+[\w$]+\s*$/.test(text) ||
        /^\s*["'][^"']*["'];?\s*$/.test(text)
    );
}

/**
 * True when every changed line in the hunk is import or re-export plumbing. Requires at least one
 * real `import`/`export` keyword so a hunk of stray braces is never mistaken for one.
 */
function isImportOnlyHunk(hunk: DiffHunk): boolean {
    const changed = hunk.lines.filter(line => line.startsWith("+") || line.startsWith("-")).map(line => line.slice(1));

    let sawKeyword = false;

    for (const text of changed) {
        if (text.trim().length === 0) {
            continue;
        }
        if (isImportOrExportPlumbing(text)) {
            sawKeyword = true;
            continue;
        }
        if (!isSpecifierContinuation(text)) {
            return false;
        }
    }

    return sawKeyword;
}

/** Drops import-only hunks from script files, collapsing a file left with nothing to a note. */
function stripImportChurn(files: DiffFile[]): DiffFile[] {
    return files.map(file => {
        if (file.note || !SCRIPT_FILE.test(file.path) || file.hunks.length === 0) {
            return file;
        }

        const kept = file.hunks.filter(hunk => !isImportOnlyHunk(hunk));
        if (kept.length === file.hunks.length) {
            return file;
        }

        return kept.length > 0 ? { ...file, hunks: kept } : { ...file, hunks: [], note: "import/export changes only" };
    });
}

/**
 * The source of a file the diff is introducing whole, or undefined when the hunks are an edit rather
 * than a whole file: every body line has to be an addition for the `+` text to be the entire file.
 */
function addedFileSource(file: DiffFile): string | undefined {
    if (file.note || file.kind !== "added" || file.hunks.length === 0) {
        return undefined;
    }

    const lines: string[] = [];

    for (const hunk of file.hunks) {
        for (const line of hunk.lines) {
            if (!line.startsWith("+")) {
                return undefined;
            }
            lines.push(line.slice(1));
        }
    }

    return lines.join("\n");
}

/**
 * Replaces the body of a large new file with its shape. A new file arrives as one `+` line per
 * source line, so it is the densest thing in any diff that adds one — and the least informative per
 * token, because a commit message describes what the file is for, not how each function is written.
 */
function summarizeAddedFiles(files: DiffFile[], options: CleanDiffOptions): DiffFile[] {
    const scriptThreshold = options.summarizeAddedScriptsAboveLines ?? 0;
    const markdownThreshold = options.outlineAddedMarkdownAboveLines ?? 0;

    if (scriptThreshold <= 0 && markdownThreshold <= 0) {
        return files;
    }

    return files.map(file => {
        const source = addedFileSource(file);
        if (source === undefined) {
            return file;
        }

        const lineCount = source.split("\n").length;
        let summary: string | undefined;
        let label: string | undefined;

        if (SCRIPT_FILE.test(file.path) && scriptThreshold > 0 && lineCount > scriptThreshold) {
            summary = summarizeScript(file.path, source);
            label = "new file, declarations only";
        } else if (isMarkdownFile(file.path) && markdownThreshold > 0 && lineCount > markdownThreshold) {
            summary = outlineMarkdown(source);
            label = "new file, headings only";
        }

        if (!summary || !label) {
            return file;
        }

        return { ...file, hunks: [{ context: label, lines: summary.split("\n").map(line => `+${line}`) }] };
    });
}

/**
 * Caps the payload of each body line. A minified bundle, an embedded data URI or a long generated
 * string is understood from its opening; the rest is paid for and never read.
 */
function capLineLengths(files: DiffFile[], maxLineLength: number): DiffFile[] {
    if (maxLineLength <= 0) {
        return files;
    }

    return files.map(file => ({
        ...file,
        // The sign is not part of the payload, so the cap is measured after it.
        hunks: file.hunks.map(hunk => ({
            ...hunk,
            lines: hunk.lines.map(line => (line.length > maxLineLength + 1 ? `${line.slice(0, maxLineLength + 1)}…` : line)),
        })),
    }));
}

function dropContextLines(files: DiffFile[]): DiffFile[] {
    return files.map(file => ({
        ...file,
        hunks: file.hunks
            .map(hunk => ({ ...hunk, lines: hunk.lines.filter(line => line.startsWith("+") || line.startsWith("-")) }))
            .filter(hunk => hunk.lines.length > 0),
    }));
}

function hunkHeaderText(hunk: DiffHunk): string {
    return hunk.context ? `@@ ${hunk.context}` : "@@";
}

/** Rendered length of a file's hunks, excluding its header. */
function bodySize(file: DiffFile): number {
    return file.hunks.reduce(
        (total, hunk) => total + hunkHeaderText(hunk).length + 1 + hunk.lines.reduce((sum, line) => sum + line.length + 1, 0),
        0
    );
}

/**
 * Truncates each file to a share of the budget. Files under their share give the remainder back, so
 * a handful of small focused edits survive intact next to one very large one.
 */
function truncateToBudget(files: DiffFile[], maxCharacters: number): DiffFile[] {
    const withBody = files.filter(file => file.hunks.length > 0);
    if (withBody.length === 0) {
        return files;
    }

    // Headers and notes are not negotiable, so only what is left over can be spent on hunk bodies.
    const overhead = renderDiff(files.map(file => ({ ...file, hunks: [] }))).length;
    const available = Math.max(maxCharacters - overhead, withBody.length * 200);

    const sizes = new Map(withBody.map(file => [file, bodySize(file)]));
    const sorted = [...withBody].sort((a, b) => sizes.get(a)! - sizes.get(b)!);

    const allowances = new Map<DiffFile, number>();
    let remaining = available;

    sorted.forEach((file, index) => {
        const share = Math.floor(remaining / (sorted.length - index));
        const allowance = Math.min(sizes.get(file)!, share);
        allowances.set(file, allowance);
        remaining -= allowance;
    });

    return files.map(file => {
        const allowance = allowances.get(file);
        if (allowance === undefined || allowance >= sizes.get(file)!) {
            return file;
        }

        const kept: DiffHunk[] = [];
        let used = 0;
        let dropped = 0;

        for (const hunk of file.hunks) {
            const header = hunkHeaderText(hunk);
            const lines: string[] = [];

            for (const line of hunk.lines) {
                if (used + header.length + line.length + 2 > allowance) {
                    dropped++;
                    continue;
                }
                lines.push(line);
                used += line.length + 1;
            }

            if (lines.length > 0) {
                used += header.length + 1;
                kept.push({ ...hunk, lines });
            }
        }

        if (dropped === 0) {
            return file;
        }

        const marker: DiffHunk = { context: `... ${dropped} more changed lines omitted`, lines: [] };
        return { ...file, hunks: [...kept, marker] };
    });
}

function hasBody(files: DiffFile[]): boolean {
    return files.some(file => file.hunks.some(hunk => hunk.lines.length > 0));
}

/** Removes only the noise that can never carry meaning, for the fallback path. */
function stripMetadataOnly(raw: string): string {
    return raw
        .split("\n")
        .filter(line => !DROPPED_METADATA.test(line) && !line.startsWith("diff --git "))
        .join("\n")
        .trim();
}

export function cleanDiff(raw: string, options: CleanDiffOptions): string {
    if (raw.trim().length === 0) {
        return "";
    }

    const parsed = parseDiff(raw);

    let files = parsed.map(file =>
        options.formattingOnlyPaths?.has(file.path) && file.kind === "modified"
            ? { ...file, hunks: [], note: "formatting only" }
            : file
    );

    // Summarizing runs first: it parses the `+` lines as source, which a capped line would break.
    files = summarizeAddedFiles(files, options);
    files = capLineLengths(files, options.maxLineLength ?? 0);

    if (renderDiff(files).split("\n").length > options.stripImportsAboveLines) {
        files = stripImportChurn(files);
    }

    let rendered = renderDiff(files);

    if (rendered.length > options.maxCharacters) {
        files = dropContextLines(files);
        rendered = renderDiff(files);
    }

    if (rendered.length > options.maxCharacters) {
        files = truncateToBudget(files, options.maxCharacters);
        rendered = renderDiff(files);
    }

    // Cleaning removed the entire change: a commit that is nothing but reformats and import churn.
    // Its diff is still the only evidence of what happened, so send the unfiltered version instead.
    if (!hasBody(files) && hasBody(parsed)) {
        const fallback = stripMetadataOnly(raw);
        return fallback.length > options.maxCharacters ? `${fallback.slice(0, options.maxCharacters)}\n... (truncated)` : fallback;
    }

    return rendered;
}

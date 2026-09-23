import type { DiffFile } from "./diffCleaner";

/**
 * Finds code the diff removes from one file and adds to another. Line by line, a move is a deletion
 * in one place and new code in another, and a model reading it that way describes an extraction as
 * a new feature. Matching the two halves up here costs nothing and says what actually happened - and
 * once a block is known to be a move, neither half needs to be sent in full.
 *
 * Only removed and added lines are compared, so a file deleted under `-D` - which has no body in the
 * diff - can never be the source of a move. Git's own rename detection covers most of those.
 */

export interface MovedCode {
    from: string;
    to: string;
    /** Significant lines matched, so blank lines and lone braces do not inflate it. */
    lines: number;
}

/** Where a diff line sits in a parsed file. */
export interface LineLocation {
    hunk: number;
    line: number;
}

/** One run of lines matched between two files, by position in the parsed diff both halves came from. */
export interface MovedBlock {
    from: string;
    to: string;
    fromFile: number;
    toFile: number;
    /** The significant lines only; collapsing widens each run over the blank lines and braces around it. */
    removed: LineLocation[];
    added: LineLocation[];
}

/** Shorter runs match by coincidence: two unrelated edits can share a line or two. */
const MIN_BLOCK_LINES = 3;
const MIN_BLOCK_CHARACTERS = 60;
/** Below this a move is incidental to the change, and not worth a line of the prompt. */
const MIN_REPORTED_LINES = 5;
const MAX_REPORTED_MOVES = 10;
/** A few declarations name what moved; past that, the list is the block again. */
const MAX_OUTLINE_LINES = 3;
/** The matching is quadratic at worst; a diff this large is a sweep, not a refactor to explain. */
const MAX_SCANNED_LINES = 20000;

interface Side {
    lines: string[];
    locations: LineLocation[];
    /** Positions of each distinct line, for the matching to start from. */
    positions: Map<string, number[]>;
    consumed: boolean[];
}

function normalize(line: string): string {
    return line.slice(1).trim().replace(/\s+/g, " ");
}

/**
 * Lines every block of code shares, which prove nothing about where a block came from. Imports are
 * among them: a moved function takes its imports along, but so does any edit to two files.
 */
function isSignificant(text: string): boolean {
    return /[\w$]{2}/.test(text) && !/^import\b/.test(text) && !/^\}?\s*from\s+["']/.test(text);
}

function collect(file: DiffFile, sign: "+" | "-"): Side {
    const lines: string[] = [];
    const locations: LineLocation[] = [];

    file.hunks.forEach((hunk, hunkIndex) => {
        hunk.lines.forEach((line, lineIndex) => {
            if (line.startsWith(sign)) {
                const text = normalize(line);
                if (isSignificant(text)) {
                    lines.push(text);
                    locations.push({ hunk: hunkIndex, line: lineIndex });
                }
            }
        });
    });

    const positions = new Map<string, number[]>();
    lines.forEach((line, index) => {
        const list = positions.get(line);
        if (list) {
            list.push(index);
        } else {
            positions.set(line, [index]);
        }
    });

    return { lines, locations, positions, consumed: new Array<boolean>(lines.length).fill(false) };
}

interface Match {
    target: number;
    start: number;
    length: number;
    characters: number;
}

/** The longest unclaimed run in any other file's additions that continues `removed` from `from`. */
function longestMatch(removed: string[], from: number, source: number, added: Map<number, Side>): Match | undefined {
    let best: Match | undefined;

    for (const [target, side] of added) {
        if (target === source) {
            continue;
        }

        for (const start of side.positions.get(removed[from]) ?? []) {
            let length = 0;
            let characters = 0;

            while (
                from + length < removed.length &&
                start + length < side.lines.length &&
                !side.consumed[start + length] &&
                removed[from + length] === side.lines[start + length]
            ) {
                characters += removed[from + length].length;
                length++;
            }

            if (length > (best?.length ?? 0)) {
                best = { target, start, length, characters };
            }
        }
    }

    return best;
}

function pairKey(block: MovedBlock): string {
    return `${block.fromFile}\0${block.toFile}`;
}

/** Totals per pair of files, largest first. */
export function summarizeMovedBlocks(blocks: MovedBlock[]): MovedCode[] {
    const moved = new Map<string, MovedCode>();

    for (const block of blocks) {
        const entry = moved.get(pairKey(block)) ?? { from: block.from, to: block.to, lines: 0 };
        entry.lines += block.removed.length;
        moved.set(pairKey(block), entry);
    }

    return [...moved.values()].sort((a, b) => b.lines - a.lines);
}

/** Every matched block belonging to a move large enough to report. */
export function findMovedBlocks(files: DiffFile[]): MovedBlock[] {
    const totalLines = files.reduce((sum, file) => sum + file.hunks.reduce((inner, hunk) => inner + hunk.lines.length, 0), 0);
    if (totalLines > MAX_SCANNED_LINES) {
        return [];
    }

    const added = new Map<number, Side>();
    files.forEach((file, index) => {
        const side = collect(file, "+");
        if (side.lines.length >= MIN_BLOCK_LINES) {
            added.set(index, side);
        }
    });

    const blocks: MovedBlock[] = [];

    files.forEach((file, fileIndex) => {
        const removed = collect(file, "-");

        for (let index = 0; index < removed.lines.length; ) {
            const match = longestMatch(removed.lines, index, fileIndex, added);

            if (!match || match.length < MIN_BLOCK_LINES || match.characters < MIN_BLOCK_CHARACTERS) {
                index++;
                continue;
            }

            // A line can only have come from one place, so a claimed run is not matched twice.
            const side = added.get(match.target)!;
            side.consumed.fill(true, match.start, match.start + match.length);

            blocks.push({
                from: file.path,
                to: files[match.target].path,
                fromFile: fileIndex,
                toFile: match.target,
                removed: removed.locations.slice(index, index + match.length),
                added: side.locations.slice(match.start, match.start + match.length),
            });

            index += match.length;
        }
    });

    const reported = new Set(
        summarizeMovedBlocks(blocks)
            .filter(move => move.lines >= MIN_REPORTED_LINES)
            .slice(0, MAX_REPORTED_MOVES)
            .map(move => `${move.from}\0${move.to}`)
    );

    return blocks.filter(block => reported.has(`${block.from}\0${block.to}`));
}

export function detectMovedCode(files: DiffFile[]): MovedCode[] {
    return summarizeMovedBlocks(findMovedBlocks(files));
}

interface Segment {
    sign: "+" | "-";
    label: string;
    hunk: number;
    first: number;
    last: number;
}

/**
 * Widens a run over the blank lines and lone braces at its edges, which are part of the block that
 * moved but were left out of the matching, so no stray `}` is left standing where the block was.
 */
function widen(lines: string[], sign: string, first: number, last: number): [number, number] {
    const isFiller = (index: number): boolean => lines[index].startsWith(sign) && !isSignificant(normalize(lines[index]));

    while (first > 0 && isFiller(first - 1)) {
        first--;
    }
    while (last < lines.length - 1 && isFiller(last + 1)) {
        last++;
    }

    return [first, last];
}

function segmentsOf(locations: LineLocation[], sign: "+" | "-", label: string): Segment[] {
    const byHunk = new Map<number, number[]>();
    for (const location of locations) {
        byHunk.set(location.hunk, [...(byHunk.get(location.hunk) ?? []), location.line]);
    }

    return [...byHunk].map(([hunk, lines]) => ({ sign, label, hunk, first: Math.min(...lines), last: Math.max(...lines) }));
}

function indentation(line: string): number {
    return /^\s*/.exec(line.slice(1))![0].length;
}

/**
 * The block's outermost lines - for a moved function, its signature. A marker alone says a block
 * moved but not which one, and the name of what moved is what the title needs.
 */
function outlineOf(lines: string[]): string[] {
    const significant = lines.filter(line => isSignificant(normalize(line)));
    if (significant.length === 0) {
        return [];
    }

    const outer = Math.min(...significant.map(indentation));
    return significant
        .filter(line => indentation(line) === outer)
        .slice(0, MAX_OUTLINE_LINES)
        .map(line => `${line[0]}  ${normalize(line)}`);
}

/**
 * Replaces each half of a move with one line saying where it went or came from, keeping its sign so
 * it survives every later step that keeps only changed lines. Under the source's marker, the block's
 * outermost lines stay, indented, so the prompt still names what moved.
 *
 * `blocks` were found in `original`; a file whose hunks have since been replaced - summarized, or
 * noted as a reformat - no longer has the lines they point at, and is left as it is.
 */
export function collapseMovedBlocks(files: DiffFile[], original: DiffFile[], blocks: MovedBlock[]): DiffFile[] {
    if (blocks.length === 0) {
        return files;
    }

    const segments = new Map<number, Segment[]>();
    const add = (fileIndex: number, found: Segment[]): void => {
        segments.set(fileIndex, [...(segments.get(fileIndex) ?? []), ...found]);
    };

    for (const block of blocks) {
        // Positions are only meaningful against the same parse; a path that disagrees means another diff.
        if (original[block.fromFile]?.path !== block.from || original[block.toFile]?.path !== block.to) {
            continue;
        }

        add(block.fromFile, segmentsOf(block.removed, "-", `moved to ${block.to}`));
        add(block.toFile, segmentsOf(block.added, "+", `moved from ${block.from}`));
    }

    return files.map((file, fileIndex) => {
        const fileSegments = segments.get(fileIndex);
        if (!fileSegments || file.hunks !== original[fileIndex]?.hunks) {
            return file;
        }

        const hunks = file.hunks.map((hunk, hunkIndex) => {
            const dropped = new Set<number>();
            const markers = new Map<number, string[]>();

            for (const segment of fileSegments.filter(candidate => candidate.hunk === hunkIndex)) {
                const [first, last] = widen(hunk.lines, segment.sign, segment.first, segment.last);
                const collapsed: number[] = [];

                for (let index = first; index <= last; index++) {
                    if (hunk.lines[index].startsWith(segment.sign) && !dropped.has(index)) {
                        dropped.add(index);
                        collapsed.push(index);
                    }
                }

                if (collapsed.length > 0) {
                    const marker = `${segment.sign}[${collapsed.length} lines ${segment.label}]`;
                    // One half is enough to say what moved; the source is never summarized, so it is always this one.
                    const outline = segment.sign === "-" ? outlineOf(collapsed.map(index => hunk.lines[index])) : [];
                    markers.set(first, [...(markers.get(first) ?? []), marker, ...outline]);
                }
            }

            if (dropped.size === 0) {
                return hunk;
            }

            const lines: string[] = [];
            hunk.lines.forEach((line, index) => {
                lines.push(...(markers.get(index) ?? []));
                if (!dropped.has(index)) {
                    lines.push(line);
                }
            });

            return { ...hunk, lines };
        });

        return { ...file, hunks };
    });
}

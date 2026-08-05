/**
 * The subset of glob syntax the settings, the AI command definitions and the `.claude/rules`
 * frontmatter all use. Following git's `:(glob)` rules: `*` stops at a slash, `?` is one non-slash
 * character, and a leading double star followed by a slash spans any number of directories
 * *including none*, so `**\/package-lock.json` also matches one sitting at the repository root.
 *
 * `{a,b}` alternation is supported one level deep, which is all `**\/*.{ts,tsx}` needs.
 */
export function matchesGlob(filePath: string, glob: string): boolean {
    return new RegExp(`^${globToRegExpSource(glob)}$`).test(filePath);
}

/** True when the path matches any of the globs. An absent or empty list matches every path. */
export function matchesAnyGlob(filePath: string, globs: readonly string[] | undefined): boolean {
    return !globs || globs.length === 0 || globs.some(glob => matchesGlob(filePath, glob));
}

/**
 * The glob as an unanchored regular expression source. Exported because a `when` clause in the
 * manifest has to filter by the same rules this matcher does, without being able to call it.
 */
export function globToRegExpSource(glob: string): string {
    let pattern = "";

    for (let i = 0; i < glob.length; i++) {
        const character = glob[i];

        if (character === "?") {
            pattern += "[^/]";
        } else if (character === "*") {
            if (glob[i + 1] !== "*") {
                pattern += "[^/]*";
            } else if (glob[i + 2] === "/") {
                pattern += "(?:.*/)?";
                i += 2;
            } else {
                pattern += ".*";
                i += 1;
            }
        } else if (character === "{" && glob.includes("}", i)) {
            const end = glob.indexOf("}", i);
            pattern += `(?:${glob
                .slice(i + 1, end)
                .split(",")
                .map(globToRegExpSource)
                .join("|")})`;
            i = end;
        } else {
            pattern += escapeRegExp(character);
        }
    }

    return pattern;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

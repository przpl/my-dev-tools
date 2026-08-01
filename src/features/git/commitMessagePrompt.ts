import type { ChangedFile } from "./collectDiff";

/**
 * The commit message specification, sent verbatim as the system prompt. It is the whole product of
 * this feature: the diff tells the model what changed, this tells it what a good message looks like.
 */
export const COMMIT_MESSAGE_SPEC = `# Writing Commit Messages

Structure: \`type(scope): description\`, optional body, optional footers.

Governing rule: every line after the title must answer something the diff leaves open — why this exists, why now, why this way, what breaks if it changes, or what a change too wide to scan consists of. A line answering none of those is noise; delete it.

## Title

- Target 50 characters for the whole title, never exceed 72. Spend the extra room on specificity, never on filler
- Imperative mood, present tense: \`add\`, not \`added\` or \`adds\`. The description must complete "if applied, this commit will …"
- Lowercase type, scope, and description. Preserve casing for proper names (GitHub, TypeScript, service names)
- No trailing period
- Name the concrete symptom, effect, or capability, never a category: \`prevent duplicate items on retry\`, not \`fix cart bug\`
- State the outcome, not the implementation. The mechanism belongs in the body, and only when non-obvious
- Cover the whole change in one statement. Never enumerate changed files
- Describe renames and moves too, not only content edits — naming the unit that moved is not a file list
- Never repeat the type or scope in the description: \`fix: fix …\`, \`feat(auth): add auth …\`
- Never use a placeholder that fits any diff: \`update code\`, \`various fixes\`, \`minor changes\`, \`improvements\`, \`cleanup\`, \`wip\`

## Type

One type per commit. Separable work of two types is two commits; one indivisible change fitting two types takes the primary intent.

| type       | use for                                                   |
| ---------- | --------------------------------------------------------- |
| \`feat\`     | new capability                                            |
| \`fix\`      | bug patch                                                 |
| \`refactor\` | code change that neither fixes a bug nor adds a feature   |
| \`perf\`     | performance improvement                                   |
| \`docs\`     | documentation only                                        |
| \`style\`    | formatting, whitespace, semicolons                        |
| \`test\`     | adding or updating tests                                  |
| \`build\`    | build system, bundler, or compiler configuration          |
| \`ci\`       | continuous integration configuration                      |
| \`chore\`    | dependency upgrades and maintenance fitting no other type |

\`feat\` bumps MINOR, \`fix\` bumps PATCH, a \`BREAKING CHANGE:\` footer bumps MAJOR.

## Scope

Optional noun naming the affected section of the codebase, in parentheses.

- Use a scope for changes confined to 1-2 modules
- Omit the scope for changes spanning 3+ modules

## Body

Optional, separated from the title by a blank line. Add one when the title alone leaves a future reader guessing — when the change:

- fixes a bug — give the symptom and the root cause, not just the remedy
- rejects the approach a reader would expect — name it and say why
- rests on a non-obvious constraint, trade-off, or third-party behavior
- turns on a mechanism the title cannot carry — name it in one bullet
- alters behavior others depend on — give the migration note
- spans 3+ modules or moves code between them — give the shape of it, so the reader knows what to look for before opening the diff

Rules:

- One \`-\` bullet per logical change or reason
- Wrap lines at 72 characters
- Keep change bullets in imperative mood; state causes and constraints as plain statements. No trailing periods
- Make the body self-contained: spell out the reasoning. Footers may point at an issue or PR; the reasoning must never live only there
- Never anchor on context a future reader cannot retrieve: chat requests, review comments, "as discussed", or a sibling commit
- Never restate the title, narrate the process ("this commit…", "as requested"), or name changed files
- Omit the body entirely when the title says everything

## Footers

Placed after a blank line following the title or body.

- \`BREAKING CHANGE: <consequence and migration path>\` — for any type that breaks backward compatibility
- \`Closes #123\`, \`Refs #456\`

## Examples

Focused change the diff explains on its own:

\`\`\`
fix(cart): prevent duplicate items on retry
\`\`\`

Fix whose cause the diff does not reveal:

\`\`\`
fix(upload): reject files above 25 MB before buffering

- unbounded reads let one 2 GB upload exhaust the pod's memory
- check Content-Length before allocating the buffer
\`\`\`

Change too wide for one claim — no scope, and the bullets map the diff rather than restate it:

\`\`\`
feat: support annual subscriptions

- add the yearly price tier and its 20% discount to the price table
- prorate mid-cycle plan switches in both directions
- surface the billing period in checkout and the account settings UI
\`\`\`

Noise — a title that fits any diff, a file list, a restatement, and unretrievable context:

\`\`\`
chore(api): update files

- updated userService.ts and client.ts
- this commit improves error handling
- as discussed in review
\`\`\`

The same commit, stated once as one claim — no body, because the diff answers the rest:

\`\`\`
fix(api): retry idempotent requests on 503
\`\`\``;

const OUTPUT_RULES = `## Output

Reply with the commit message and nothing else. No code fences, no preamble, no explanation, no
surrounding quotes. The first line is the title. The reply is written straight into the commit
message box, so anything that is not part of the message ends up in the repository history.

The diff you are given has been compacted. The compaction is not part of the change, so never
describe it:

- Hashes, line numbers and surrounding context are removed; a hunk header keeps only the enclosing declaration
- A file marked \`(formatting only)\`, \`(import/export changes only)\` or \`(binary)\` changed in that way and no other
- Under \`@@ new file, declarations only\`, a new file is shown as its declaration surface. \`{ /* 12 lines */ }\` stands for a body that was written but is not shown — it is not an empty or unfinished function
- Under \`@@ new file, headings only\`, a new document is shown as its headings, with \`<12 lines>\` standing for the prose between them
- A deleted file is listed by name with no body; its contents were removed in full
- A line ending in \`…\` was truncated here, not shortened by the author

Files listed as excluded from the diff did change — you just cannot see how, so describe them only
from their names.`;

export function buildSystemPrompt(additionalInstructions: string): string {
    const extra = additionalInstructions.trim();
    return [COMMIT_MESSAGE_SPEC, OUTPUT_RULES, extra && `## Additional project instructions\n\n${extra}`]
        .filter(Boolean)
        .join("\n\n");
}

export interface CommitContext {
    branch?: string;
    files: ChangedFile[];
    diff: string;
    /** Whatever the author had already typed into the commit box. */
    hint?: string;
}

function describeFile(file: ChangedFile): string {
    const rename = file.previousPath ? ` (from ${file.previousPath})` : "";
    const excluded = file.excluded ? "   [excluded from diff]" : "";
    return `  ${file.status}  ${file.path}${rename}${excluded}`;
}

export function buildUserPrompt(context: CommitContext): string {
    const sections: string[] = [];

    if (context.branch) {
        sections.push(`Branch: ${context.branch}`);
    }

    sections.push(`Files changed:\n${context.files.map(describeFile).join("\n")}`);

    if (context.hint?.trim()) {
        sections.push(`The author started typing this. Treat it as a hint about intent, not as text to keep or correct; where it disagrees with the diff, the diff wins:\n  ${context.hint.trim()}`);
    }

    sections.push(`Diff:\n${context.diff}`);
    sections.push("Write the commit message for this change.");

    return sections.join("\n\n");
}

/** Models like to wrap the answer in a fence or quotes despite being told not to. */
export function sanitizeCommitMessage(reply: string): string {
    let message = reply.replace(/\r\n/g, "\n").trim();

    const fenced = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(message);
    if (fenced) {
        message = fenced[1].trim();
    }

    if (message.length > 1 && message.startsWith('"') && message.endsWith('"') && !message.includes("\n")) {
        message = message.slice(1, -1).trim();
    }

    return message;
}

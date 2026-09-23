/**
 * Project instructions are a template over the branch the commit lands on: `${branch}` is its name,
 * and every named group of the configured branch pattern is a placeholder of its own. A line that
 * refers to a placeholder the branch did not provide is dropped, so a convention such as "prefix the
 * description with the ticket" simply does not apply on a branch without a ticket.
 */

const PLACEHOLDER = /\$\{(\w+)\}/g;

export class InvalidBranchPatternError extends Error {
    constructor(pattern: string, reason: string) {
        super(`'myDevTools.commitMessage.branchPattern' is not a valid regular expression (${pattern}): ${reason}`);
        this.name = "InvalidBranchPatternError";
    }
}

export function readBranchVariables(branch: string | undefined, pattern: string): Record<string, string> {
    if (!branch) {
        return {};
    }

    const variables: Record<string, string> = { branch };
    if (!pattern.trim()) {
        return variables;
    }

    let regex: RegExp;
    try {
        regex = new RegExp(pattern);
    } catch (error) {
        throw new InvalidBranchPatternError(pattern, error instanceof Error ? error.message : String(error));
    }

    for (const [name, value] of Object.entries(regex.exec(branch)?.groups ?? {})) {
        // A group that took no part in the match leaves no value, not an empty one.
        if (value) {
            variables[name] = value;
        }
    }

    return variables;
}

export function resolveProjectInstructions(template: string, variables: Record<string, string>): string {
    return template
        .split(/\r?\n/)
        .filter(line => [...line.matchAll(PLACEHOLDER)].every(([, name]) => name in variables))
        .map(line => line.replace(PLACEHOLDER, (_placeholder, name: string) => variables[name]))
        .join("\n")
        .trim();
}

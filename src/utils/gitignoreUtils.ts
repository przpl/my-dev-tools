import ignore, { Ignore } from "ignore";
import * as path from "node:path";
import * as vscode from "vscode";

export async function readGitignore(dirUri: vscode.Uri): Promise<string | null> {
    try {
        const gitignoreUri = vscode.Uri.joinPath(dirUri, ".gitignore");
        const bytes = await vscode.workspace.fs.readFile(gitignoreUri);
        return Buffer.from(bytes).toString("utf-8");
    } catch {
        return null;
    }
}

export async function loadAllGitignoreRules(): Promise<Map<string, Ignore>> {
    const gitignoreFiles = await vscode.workspace.findFiles("**/.gitignore", null);
    const rules = new Map<string, Ignore>();
    for (const uri of gitignoreFiles) {
        try {
            const bytes = await vscode.workspace.fs.readFile(uri);
            const content = Buffer.from(bytes).toString("utf-8");
            rules.set(path.dirname(uri.fsPath), ignore().add(content));
        } catch {
            // skip unreadable .gitignore files
        }
    }
    return rules;
}

export function isFileGitignored(filePath: string, rules: Map<string, Ignore>): boolean {
    for (const [dir, ig] of rules) {
        const relative = path.relative(dir, filePath);
        if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
        if (ig.ignores(relative.replace(/\\/g, "/"))) return true;
    }
    return false;
}

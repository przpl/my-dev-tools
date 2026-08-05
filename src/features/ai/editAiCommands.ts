import * as vscode from "vscode";

import { Config } from "../../utils/config";
import { FileUtils } from "../../utils/fileUtils";
import { aiCommandsFileUri } from "./aiCommandRegistry";

/**
 * Opens the workspace's commands file, writing a worked example first if there is none. The starter
 * is one real command rather than an empty array: the format is easier to extend than to invent,
 * and the file is validated by a contributed schema as soon as it exists, so the second command is
 * written with completion rather than copied from a comment.
 */

const STARTER = `{
    "commands": [
        {
            "id": "fix-grammar",
            "title": "Fix grammar",
            "globs": ["**/*.md", "**/*.txt"],
            "selection": "target",
            "rules": false,
            "prompt": "Fix the spelling, grammar and punctuation. Keep the wording, tone and Markdown formatting as they are."
        }
    ]
}
`;

export async function editAiCommands(): Promise<void> {
    const folder = FileUtils.resolveWorkspaceFolder(vscode.window.activeTextEditor?.document.uri);
    if (!folder) {
        vscode.window.showErrorMessage("Edit AI Commands: open a workspace folder first.");
        return;
    }

    const uri = aiCommandsFileUri(folder);

    if ((await FileUtils.readTextIfExists(uri)) === undefined) {
        try {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(STARTER, "utf8"));
        } catch (error) {
            vscode.window.showErrorMessage(
                `Edit AI Commands: could not create ${Config.aiCommandsFile}: ${error instanceof Error ? error.message : String(error)}`
            );
            return;
        }
    }

    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: false });
}

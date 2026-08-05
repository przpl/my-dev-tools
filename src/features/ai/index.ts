import * as vscode from "vscode";

import { editAiCommands } from "./editAiCommands";
import { aiCommandIdOf, paletteCommandIds, type PaletteManifest } from "./paletteContributions";
import { syncAiCommandsToPalette } from "./paletteSync";
import { registerProposalContentProvider } from "./resultReview";
import { runAiCommand } from "./runAiCommand";

/**
 * Wires up the AI command runner. Returns disposables rather than taking the subscriptions itself,
 * matching `initOpenRouter`, because this feature owns a content provider as well as its commands.
 */
export function initAiCommands(context: vscode.ExtensionContext): vscode.Disposable[] {
    const disposables = [
        registerProposalContentProvider(),
        vscode.commands.registerCommand("myDevTools.runAiCommand", (args?: { id?: string }) => runAiCommand(args)),
        vscode.commands.registerCommand("myDevTools.editAiCommands", editAiCommands),
        vscode.commands.registerCommand("myDevTools.syncAiCommandsToPalette", () => syncAiCommandsToPalette(context)),
    ];

    /**
     * The synced entries are ordinary commands whose ids the manifest already lists, so the manifest
     * is also the list of ids that have to answer when one is picked - and the two cannot drift,
     * because a palette entry with nothing behind it is exactly what "command not found" means.
     */
    for (const paletteId of paletteCommandIds(context.extension.packageJSON as PaletteManifest)) {
        disposables.push(vscode.commands.registerCommand(paletteId, () => runAiCommand({ id: aiCommandIdOf(paletteId) })));
    }

    return disposables;
}

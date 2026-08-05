import { utimes } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

import { FileUtils } from "../../utils/fileUtils";
import { loadAiCommands } from "./aiCommandRegistry";
import { applyPaletteContributions, buildPaletteContributions, type PaletteManifest } from "./paletteContributions";

/**
 * Writes the catalogue into the installed extension's own package.json, which is the only place the
 * command palette reads entries from. Run on demand rather than on activation: it edits a file on
 * disk and costs a window reload, neither of which should happen behind the user's back, and a
 * project-specific catalogue would otherwise have two windows rewriting the same manifest at
 * each other.
 *
 * Reinstalling the extension restores the packaged manifest and with it wipes the entries, so this is
 * a step of the install rather than a one-off.
 */

interface ReadManifest {
    manifest: PaletteManifest;
    /** The file's own newline, kept so the rewrite is a diff of the entries rather than of every line. */
    eol: string;
}

/** Read back before writing, so a manifest edited by hand or by an update is never overwritten blind. */
async function readManifest(uri: vscode.Uri): Promise<ReadManifest | undefined> {
    const text = await FileUtils.readTextIfExists(uri);

    if (text === undefined) {
        return undefined;
    }

    try {
        return { manifest: JSON.parse(text) as PaletteManifest, eol: text.includes("\r\n") ? "\r\n" : "\n" };
    } catch {
        return undefined;
    }
}

/**
 * VS Code caches its scan of the extensions folder and keys that cache on the folder's own mtime,
 * which writing a file *inside* one extension does not change. Without this the reloaded window can
 * be served the manifest as it was cached before the write, and the entries never appear.
 */
async function invalidateExtensionScanCache(extensionPath: string): Promise<boolean> {
    try {
        const now = new Date();
        await utimes(path.dirname(extensionPath), now, now);
        return true;
    } catch {
        return false;
    }
}

/** In development the manifest being rewritten is the repository's own, which is worth a warning. */
async function confirmedInDevelopment(context: vscode.ExtensionContext, manifestPath: string): Promise<boolean> {
    if (context.extensionMode !== vscode.ExtensionMode.Development) {
        return true;
    }

    const answer = await vscode.window.showWarningMessage(
        `This will edit ${manifestPath}, which is the extension's source manifest rather than an installed copy.`,
        { modal: true },
        "Write anyway"
    );

    return answer !== undefined;
}

export async function syncAiCommandsToPalette(context: vscode.ExtensionContext): Promise<void> {
    const { commands, problems } = await loadAiCommands(vscode.window.activeTextEditor?.document.uri);

    const contributions = buildPaletteContributions(commands);
    const skipped = [...problems, ...contributions.problems];

    const manifestUri = vscode.Uri.joinPath(context.extensionUri, "package.json");
    const read = await readManifest(manifestUri);

    if (!read) {
        vscode.window.showErrorMessage(`Sync Commands to Palette: could not read ${manifestUri.fsPath}.`);
        return;
    }

    const { manifest, eol } = read;

    if (!applyPaletteContributions(manifest, contributions)) {
        vscode.window.showInformationMessage(
            `AI: the palette is already up to date (${contributions.commands.length} ${plural(contributions.commands.length)}).${trailing(skipped)}`
        );
        return;
    }

    if (!(await confirmedInDevelopment(context, manifestUri.fsPath))) {
        return;
    }

    const serialized = `${JSON.stringify(manifest, null, 4)}\n`.replace(/\n/g, eol);

    try {
        await vscode.workspace.fs.writeFile(manifestUri, Buffer.from(serialized, "utf8"));
    } catch (error) {
        vscode.window.showErrorMessage(
            `Sync Commands to Palette: could not write ${manifestUri.fsPath}: ${error instanceof Error ? error.message : String(error)}`
        );
        return;
    }

    // Only the installed copy is served from that cache; in development the folder is scanned as it is.
    const invalidated = context.extensionMode === vscode.ExtensionMode.Development || (await invalidateExtensionScanCache(context.extensionUri.fsPath));

    const count = contributions.commands.length;
    const written = count === 0 ? "AI: removed every command from the palette." : `AI: wrote ${count} ${plural(count)} to the palette.`;
    const hint = invalidated ? "" : " If they do not appear, restart VS Code.";

    const reload = await vscode.window.showInformationMessage(`${written} Reload the window to apply.${hint}${trailing(skipped)}`, "Reload Window");

    if (reload) {
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
    }
}

function plural(count: number): string {
    return count === 1 ? "command" : "commands";
}

function trailing(skipped: string[]): string {
    return skipped.length === 0 ? "" : ` Skipped: ${skipped.join(" ")}`;
}

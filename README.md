# Description

As the 'My Dev Tools' extension is primarily intended to serve my needs it may be very limited in its configuration possibilities, but I will try to change this over time.

If there is a larger group of common functions in the extension then this will be separated into a separate extension as soon as the collection of these functions becomes large enough. I do not want the extension to grow indefinitely.

# Features:

## General

| Option                     | Available in                        | Description                                                                                                                |
| -------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Go to nearest index.ts     | Command palette                     | Open nearest index.ts file in one of the parent folders.                                                                   |
| Add to exports in index.ts | Command palette                     | Add selected symbol to exports in nearest index.ts. If no symbol is selected then everything will be exported (export \*)  |
| Convert EOL to LF          | Command palette                     | Convert line endings from CRLF/CR to LF for files matching a glob pattern. Prompts for pattern (default: `**/*`).          |
| Delete empty directories   | Command palette                     | Recursively finds and deletes all empty directories in the workspace. Directories containing any file are skipped. Directories matching `.gitignore` patterns (e.g. `node_modules`) are skipped. |
| Rename to...               | File context menu / Command palette | Rename file to camelCase, PascalCase, snake_case or kebab-case.                                                            |
| Auto rename                | File context menu / Command palette | Automatically rename file based on exported symbols (class, function, interface, etc.). Uses configurable naming strategy. |
| Toggle File Visibility     | Explorer toolbar                    | Toggle visibility of files in Explorer based on workspace `files.exclude` patterns. Eye icon appears when patterns exist.  |

### Auto Rename

The Auto rename feature intelligently renames files based on their exported symbols:

**Configuration:**
Set `myDevTools.autoRenameStrategy` in your VS Code settings:

1. Open VS Code settings (File > Preferences > Settings)
2. Search for "My Dev Tools"
3. Select your preferred "Auto Rename Strategy" from the dropdown

Or add this to your `settings.json`:

```json
"myDevTools.autoRenameStrategy": "kebab-case"
```

### Toggle File Visibility

This feature allows you to quickly hide or show files in the Explorer based on your workspace `files.exclude` settings:

**How it works:**
1. Configure patterns in your workspace settings (`.vscode/settings.json`):
   ```json
   {
     "files.exclude": {
       "**/node_modules": false,
       "**/dist": false,
       "**/.git": false
     }
   }
   ```
2. An eye icon appears in the Explorer toolbar when patterns exist
3. Click the icon to toggle between hiding and showing the configured files
   - Eye icon (open): Files are visible, click to hide
   - Eye-closed icon: Files are hidden, click to show

**Note:** The icon only appears when you have `files.exclude` patterns configured in your workspace settings. If no patterns exist, the icon won't be shown.

## React

| Option                             | Available in                | Description                                                                                                                           |
| ---------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Update Props Destructuring         | Automatic / Command palette | Updates the props destructuring object in React components to match the Props interface. Can be triggered manually or automatically.  |
| Add empty props to React component | Command palette             | Adds an empty Props interface to a React component that doesn't have any props.                                                       |
| Add undefined props to interface   | Command palette             | Detects undefined symbols used in JSX and adds them to the Props interface with smart type guessing.                                  |
| Add className to React Props       | Command palette             | Adds `className?: string` to the Props interface. Creates Props interface if it doesn't exist.                                        |

## AI Commands

| Option                       | Available in    | Description                                                                                          |
| ---------------------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| AI: Run Command              | Command palette | Runs one of your own commands against the open file through OpenRouter, and shows the result as a diff. |
| AI: Edit Commands File       | Command palette | Opens the workspace's commands file, creating it from a worked example if there is none.               |
| AI: Sync Commands to Palette | Command palette | Puts each of your commands in the palette as its own `AI: <title>` entry.                              |

Nothing is built in - every command is your own JSON: what to ask the model, which files to offer it for, what to ask you first, and what to do with the answer.

Commands are merged by `id` from `myDevTools.ai.commands` (settings, every project) and `.vscode/ai-commands.json` (this workspace, wins on conflict). The file has a contributed schema, so you get completion, comments and trailing commas.

#### Commands in the palette

`AI: Run Command` lists everything, filtered to the open file's `globs`. To skip that step, run **AI: Sync Commands to Palette** once: each command becomes a top-level `AI: <title>` entry, shown only for the files its `globs` match, so a `**/*.tsx` command is absent from the palette while you are in a `.ts` file. Reload the window when asked - the palette is built from the extension's manifest at startup, which is what the sync writes and why a reload is needed.

Run it again after adding, renaming or reglobbing a command, and after reinstalling the extension, which restores the packaged manifest and with it drops the entries. An `id` can only become a palette entry if it is made of letters, digits, `.`, `-` and `_`; the sync names any it had to skip. Commands from a workspace file are synced too, but the manifest is shared by every window, so a project-specific command stays in the palette until the next sync.

Every run opens a diff; nothing is written until you press Apply, and applying is a single undo away however many files it touched. A notification reports cost and duration.

```jsonc
{
    "commands": [
        {
            "id": "add-props",
            "title": "Add missing props",
            "globs": ["**/*.tsx"],
            "selection": "context",
            "output": "replaceFile",
            "prompt": "Add every prop the component reads but does not declare to its Props interface."
        },
        {
            "id": "write-tests",
            "title": "Write unit tests",
            "globs": ["**/*.ts", "**/*.tsx"],
            "output": "files",
            "newFilePath": "${fileDirname}/${fileBasenameNoExtension}.test.ts",
            "ruleFiles": ["testing.md"],
            "inputs": [{ "id": "focus", "label": "Anything the tests should focus on?" }],
            "prompt": ["Write unit tests for the selected code.", "${input:focus}"]
        }
    ]
}
```

#### Command fields

| Field                                | Default            | Purpose                                                                                                       |
| ------------------------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `id`, `title`, `prompt`              | required           | `prompt` may be an array of lines. A key can be bound to one command with `"args": { "id": "..." }`.             |
| `description`                        | —                  | Detail line in the picker.                                                                                       |
| `globs`                              | every file         | The command is only offered for files matching one of these, both in the picker and in the palette.              |
| `selection`                          | `context`          | `ignore`, `context` (whole file sent and rewritten, with the selected range — or the caret — pointed at by its `line:column` coordinates) or `target` (only the selection sent and replaced). |
| `output`                             | follows `selection` | `replaceFile`, `replaceSelection`, `files`, `insertBelow` or `clipboard`.                                        |
| `newFilePath`                        | —                  | Location suggested to the model when `output` is `files`. It may choose otherwise, and may write several files.  |
| `inputs`                             | none               | Questions asked before the request: `{ id, label, type: "text" \| "pick", required, options, default, placeholder }`. |
| `rules`, `ruleFiles`                 | `true`, —          | See below.                                                                                                       |
| `contextFiles`                       | —                  | Globs for extra files attached read-only, e.g. an existing test as a style example.                              |
| `model`, `temperature`, `maxTokens`  | —, `0.2`, —        | Per-command overrides.                                                                                           |

`prompt`, `system` and `newFilePath` accept `${input:<id>}` and VS Code's own file variables: `${file}`, `${relativeFile}`, `${fileBasename}`, `${fileBasenameNoExtension}`, `${fileDirname}`, `${languageId}`, `${workspaceFolder}` and `${selection}`.

#### Project rules

Markdown files in `.claude/rules` whose frontmatter `paths` match the edited file are attached to the prompt, so commands follow the project's conventions without repeating them:

```yaml
---
paths:
    - "**/*.ts"
    - "**/*.tsx"
---
```

`"rules": false` sends none; `"ruleFiles": ["testing.md"]` attaches a file whatever its `paths` say.

#### Settings

| Setting                              | Default                    | Purpose                                                             |
| ------------------------------------ | -------------------------- | --------------------------------------------------------------------- |
| `myDevTools.ai.commands`             | `[]`                       | Commands available in every project.                                  |
| `myDevTools.ai.commandsFile`         | `.vscode/ai-commands.json` | Where this project's commands live.                                   |
| `myDevTools.ai.rulesDirectory`       | `.claude/rules`            | Where the rule files live.                                            |
| `myDevTools.ai.model`                | empty                      | Default model for AI commands; falls back to `myDevTools.openRouter.model`. |
| `myDevTools.ai.maxFileCharacters`    | `120000`                   | A larger file is refused rather than sent.                            |
| `myDevTools.ai.requestTimeoutSeconds` | `180`                      | How long to wait for the model.                                       |

The API key is the same one the commit message feature uses — run "Set OpenRouter API Key" once. To bill AI commands to a key of their own, see [Splitting cost across keys](#splitting-cost-across-keys).

## Splitting cost across keys

By default every feature bills one shared key. If you want to know what commit messages cost you versus AI commands, give them separate keys: OpenRouter's activity panel groups spend by model and by API key, and by nothing finer, so a separate key is the only way to get a separate line in that report.

1. Mint one key per feature at [openrouter.ai/keys](https://openrouter.ai/keys) and name them so the report reads well ("vscode-commit-messages", "vscode-ai-commands"). While you are there you can also give a key a credit limit with a daily, weekly or monthly reset, which caps that feature's spend server-side.
2. Run "Set OpenRouter API Key: Commit Messages" or "Set OpenRouter API Key: AI Commands" from the palette. Plain "Set OpenRouter API Key" asks which scope you mean instead, and shows which ones already have a key of their own.
3. Read the split under Activity, grouped by API key, or export it as CSV.

Setting a key always replaces it: the input box starts empty and no command ever shows a stored key back to you.

A feature with no key of its own falls through to the shared key, so you only have to set the ones you care about. "Clear OpenRouter API Key" on a feature drops it back to the shared key; the picker shows which is which.

| Scope           | Used by                                | Falls back to |
| --------------- | -------------------------------------- | ------------- |
| Shared key      | Everything with no key of its own       | `OPENROUTER_API_KEY` in the environment |
| Commit messages | Every generated commit message, wherever it is triggered from | Shared key |
| AI commands     | Run AI Command                          | Shared key    |

## Git

| Option                  | Available in                             | Description                                                                                                     |
| ----------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Generate Commit Message (My Dev Tools) | Source Control title bar / Command palette | Writes a Conventional Commits message for the pending change, using any model available through OpenRouter.  |
| Quick Commit            | Source Control context menu              | Right-click on one or multiple files in the Source Control panel to stage and commit them with a single action. |
| Auto Stage              | Source Control panel / Command palette   | Stages every changed file that is the same code as the version already staged, only reformatted.                  |
| Stage Active File       | `Ctrl+Alt+S` in a diff / Command palette | Stages the file you are currently looking at, without leaving the diff editor.                                    |

### Generate Commit Message

Fills the Source Control message box with a message that follows Conventional Commits. Press the sparkle icon in the Source Control **title bar**, or run "Generate Commit Message (My Dev Tools)" from the palette.

Before the first use, run "Set OpenRouter API Key", choose **Shared key**, and paste a key from [openrouter.ai/keys](https://openrouter.ai/keys). It is kept in VS Code's secret storage; `OPENROUTER_API_KEY` in the environment is used as a fallback. The model is `myDevTools.openRouter.model` and can be anything OpenRouter serves.

Whatever you have already typed into the message box is sent along as a hint about your intent, then replaced by the finished message.

#### Settings

| Setting                                          | Default                      | Purpose                                                                              |
| ------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------ |
| `myDevTools.openRouter.model`                    | `openai/gpt-5.6-luna`        | Any model id OpenRouter serves.                                                       |
| `myDevTools.openRouter.baseUrl`                  | `https://openrouter.ai/api/v1` | For a proxy or a self-hosted gateway.                                                |
| `myDevTools.commitMessage.maxDiffCharacters`     | `80000`                      | Character budget for the diff.                                                        |
| `myDevTools.commitMessage.stripImportsAboveLines` | `200`                        | Line count past which import churn is dropped.                                        |
| `myDevTools.commitMessage.excludeGlobs`          | lock files, bundles, `dist/`  | Paths listed by name but never diffed.                                                |
| `myDevTools.commitMessage.maxDiffLineLength`     | `160`                        | Each diff line is truncated to this length. `0` sends every line in full.              |
| `myDevTools.commitMessage.summarizeAddedScriptsAboveLines` | `60`               | A new `.ts`/`.js` file longer than this is sent as declarations only. `0` disables it. |
| `myDevTools.commitMessage.outlineAddedMarkdownAboveLines` | `150`                | A new Markdown file longer than this is sent as headings only. `0` disables it.        |
| `myDevTools.commitMessage.additionalInstructions` | empty                        | Appended to the prompt, for project-specific conventions.                             |

#### Not working yet: the button inside the message box

**Out of the box you get the title bar icon only. The sparkle inside the commit message box - where Copilot's sits - does not appear, and cannot be made to appear by installing the extension.**

That spot is the `scm/inputBox` contribution point, which is still a **proposed API** (`contribSourceControlInputBoxMenu`). VS Code ignores proposed contributions from any extension not explicitly allowed on the machine, so there is no way to ship it enabled - that gate is the whole point of a proposed API.

To turn it on for yourself, run "Preferences: Configure Runtime Arguments" from the palette, add the extension to `argv.json`, and restart VS Code:

```jsonc
{
    "enable-proposed-api": ["przpl.my-dev-tools"]
}
```

Caveats once you have done that:

-   It is per machine. Every machine you use needs the same `argv.json` edit; it does not travel with Settings Sync.
-   It can break on a VS Code update. If the proposal is ever finalized, renamed, or dropped, the button disappears again until the extension is rebuilt against whatever replaced it.
-   Everything else works without it. The title bar icon and the palette command are on stable API and need no flags.

### Quick Commit

This feature allows you to quickly stage and commit selected files from the Source Control panel:

1. Open the Source Control panel (Ctrl+Shift+G)
2. Right-click on one or more changed files
3. Select "Quick Commit..." from the context menu
4. Write the commit message in the editor that opens, or press the sparkle icon to have one written from the diff of just those files
5. Press `Ctrl+Enter` (`Cmd+Enter` on macOS), or the check mark in the editor title bar, to stage and commit the selection

### Auto Stage

Stages the changes that are not worth reading, so that what is left in the Changes group is only what you actually need to review.

1. Open the Source Control panel (Ctrl+Shift+G)
2. Click the sparkle icon on the "Changes" group header, or right-click the group and select "Auto Stage"

A file qualifies when its working-tree version is the same code as the version already in the index, only laid out differently. Both versions are parsed and compared, so the verdict never depends on how the diff happens to be laid out.

Covered formats: `.ts` `.tsx` `.mts` `.cts` `.js` `.jsx` `.mjs` `.cjs`, `.json` `.jsonc` (including files that carry comments, such as `tsconfig.json`), and `.css` `.scss` `.less`.

Everything else is left for you to read: any real content change, added, deleted, untracked and conflicted files, mode-only changes, lock files, and every format where whitespace is content - Markdown, YAML, Python, plain text - where an "invisible" change can quietly be a different document.

The classification is deliberately a separate step from the staging, so further rules can be added over time without changing how the command behaves.

### Stage Active File

Staging one file at a time from the Source Control panel means moving the mouse back and forth between the diff and the list. This command stages whatever file is in front of you instead:

1. Open a changed file as a diff
2. Press `Ctrl+Alt+S` (`Cmd+Alt+S` on macOS)

It works from either side of the diff, from a diff tab that does not have focus in its content, and on the file the caret sits in inside a multi-diff editor. Outside a diff editor the shortcut is inactive, but the command is still available in the palette for the file in the active editor.

**Note:** when reviewing changes in the multi-diff editor ("Open All Changes"), VS Code's built-in Git extension already puts a `+` button in each file's header toolbar that does the same thing with one click.

### Update Props Destructuring

This feature helps keep your React component props up-to-date with their interface definitions:

-   Can be manually triggered using the "Update React Props destructuring" command in the command palette.
-   Automatic real-time updates are disabled by default but can be enabled in settings.
-   Real-time updates can be toggled on/off using the "Toggle React Real-Time Props Update" command.
-   Configuration: Set `myDevTools.enableRealTimePropsUpdate` to `true` or `false` (default) in your VS Code settings.

To enable real-time updates:

1. Open VS Code settings (File > Preferences > Settings)
2. Search for "My Dev Tools"
3. Check the box next to "Enable real-time updates for React Props destructuring"

Or add this to your `settings.json`:

```json
"myDevTools.enableRealTimePropsUpdate": true
```

## NestJS

| Option              | Available in        | Description                                                                                                                                      |
| ------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Create controller   | Folder context menu | Right click on a folder and select the option to create a new controller. The controller will be automatically registered in the nearest module. |
| Go to NestJS module | Command palette     | Open nearest module file (\*.module.ts) in one of the parent folders.                                                                            |

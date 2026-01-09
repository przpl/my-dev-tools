# Description

As the 'My Dev Tools' extension is primarily intended to serve my needs it may be very limited in its configuration possibilities, but I will try to change this over time.

If there is a larger group of common functions in the extension then this will be separated into a separate extension as soon as the collection of these functions becomes large enough. I do not want the extension to grow indefinitely.

# Features:

## General

| Option                     | Available in                        | Description                                                                                                                |
| -------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Go to nearest index.ts     | Command palette                     | Open nearest index.ts file in one of the parent folders.                                                                   |
| Add to exports in index.ts | Command palette                     | Add selected symbol to exports in nearest index.ts. If no symbol is selected then everything will be exported (export \*)  |
| Rename to...               | File context menu / Command palette | Rename file to camelCase, PascalCase, snake_case or kebab-case.                                                            |
| Auto rename                | File context menu / Command palette | Automatically rename file based on exported symbols (class, function, interface, etc.). Uses configurable naming strategy. |
| Toggle File Visibility     | Explorer toolbar                    | Toggle visibility of files in Explorer based on workspace `files.exclude` patterns. Eye icon appears when patterns exist.   |

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

## Git

| Option       | Available in                | Description                                                                                                  |
| ------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Quick Commit | Source Control context menu | Right-click on one or multiple files in the Source Control panel to stage and commit them with a single action. |

### Quick Commit

This feature allows you to quickly stage and commit selected files from the Source Control panel:

1. Open the Source Control panel (Ctrl+Shift+G)
2. Right-click on one or more changed files
3. Select "Quick Commit..." from the context menu
4. Enter your commit message in the input box
5. The selected files will be staged and committed

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

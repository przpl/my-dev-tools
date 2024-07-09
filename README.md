# Description

As the 'My Dev Tools' extension is primarily intended to serve my needs it may be very limited in its configuration possibilities, but I will try to change this over time.

If there is a larger group of common functions in the extension then this will be separated into a separate extension as soon as the collection of these functions becomes large enough. I do not want the extension to grow indefinitely.

# Features:

## General

| Option                     | Available in      | Description                                                                                                               |
| -------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Go to nearest index.ts     | Command palette   | Open nearest index.ts file in one of the parent folders.                                                                  |
| Add to exports in index.ts | Command palette   | Add selected symbol to exports in nearest index.ts. If no symbol is selected then everything will be exported (export \*) |
| Rename to...               | File context menu | Rename file to camelCase, PascalCase, snake_case or kebab-case.                                                           |

## React

| Option                             | Available in                | Description                                                                                                                           |
| ---------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Create SCSS Module                 | TSX file context menu       | Right click on a \*.tsx file to create corresponding \*.module.scss file. Styles import will be automatically added to the component. |
| Update Props Destructuring         | Automatic / Command palette | Updates the props destructuring object in React components to match the Props interface. Can be triggered manually or automatically.  |
| Add className prop                 | Command palette             | Adds a className prop to a React component, including updating the Props interface and component usage.                               |
| Add empty props to React component | Command palette             | Adds an empty Props interface to a React component that doesn't have any props.                                                       |

### Update Props Destructuring

This feature helps keep your React component props up-to-date with their interface definitions:

-   Can be manually triggered using the "Update React Props destructuring" command in the command palette.
-   Automatic real-time updates are disabled by default but can be enabled in settings.
-   Real-time updates can be toggled on/off using the "My Dev Tools: Toggle React Real-Time Props Update" command.
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

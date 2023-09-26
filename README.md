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

| Option             | Available in          | Description                                                                                                                           |
| ------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Create SCSS Module | TSX file context menu | Right click on a \*.tsx file to create corresponding \*.module.scss file. Styles import will be automatically added to the component. |

## NestJS

| Option              | Available in        | Description                                                                                                                                      |
| ------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Create controller   | Folder context menu | Right click on a folder and select the option to create a new controller. The controller will be automatically registered in the nearest module. |
| Go to NestJS module | Command palette     | Open nearest module file (\*.module.ts) in one of the parent folders.                                                                            |

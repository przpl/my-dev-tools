import * as fs from "fs";
import * as path from "path";
import type * as TsMorph from "ts-morph";

/**
 * ts-morph, loaded on first use instead of at activation.
 *
 * ts-morph embeds the whole TypeScript compiler: bundled and minified it is 6.8 MB, against roughly
 * 350 KB for everything else this extension ships. Reading and parsing that file dominated startup
 * even though most sessions never run an AST command, so the build emits it as a separate
 * `out/ts-morph.js` that nothing requires until the first command that needs a parser.
 *
 * Import sites keep the shape they had with a plain `import ... from "ts-morph"`: every export below
 * is a proxy that resolves through {@link load} on its first property access, so `SyntaxKind.X`,
 * `new Project()` and `ts.createSourceFile()` all read the same as before and all pay for the
 * bundle only when they run. Types are re-exported unchanged and cost nothing.
 *
 * The one rule that comes with this: nothing here may be touched while a module body is evaluating,
 * because module bodies run at activation. Lookup tables built from `ts.SyntaxKind` or
 * `ts.ScriptKind` therefore have to be built inside a function - see `scriptFormatting.ts`.
 */

export type * from "ts-morph";

/** Named for the file the build emits; falls back to the package when running unbundled, as tests do. */
const BUNDLE_FILE = "ts-morph.js";

let cached: typeof TsMorph | undefined;

function load(): typeof TsMorph {
    if (!cached) {
        const bundled = path.join(__dirname, BUNDLE_FILE);
        // `require` of a computed id, so the bundler leaves both branches alone rather than inlining ts-morph here.
        const moduleId = fs.existsSync(bundled) ? bundled : "ts-morph";
        cached = require(moduleId) as typeof TsMorph;
    }
    return cached;
}

/**
 * Stands in for one ts-morph export until something reads from it. The target is a function so that
 * class exports stay constructible; the traps forward everything else to the real export.
 */
function lazyExport<K extends keyof typeof TsMorph>(name: K): (typeof TsMorph)[K] {
    const resolve = () => load()[name] as never;

    return new Proxy(function () {} as never, {
        get: (_target, property) => Reflect.get(resolve(), property),
        set: (_target, property, value) => Reflect.set(resolve(), property, value),
        has: (_target, property) => Reflect.has(resolve(), property),
        ownKeys: () => Reflect.ownKeys(resolve()),
        // Reported as configurable because the proxy's own function target is not, and a mismatch throws.
        getOwnPropertyDescriptor: (_target, property) => {
            const descriptor = Reflect.getOwnPropertyDescriptor(resolve(), property);
            return descriptor && { ...descriptor, configurable: true };
        },
        getPrototypeOf: () => Reflect.getPrototypeOf(resolve()),
        construct: (_target, args) => Reflect.construct(resolve(), args),
        apply: (_target, thisArg, args) => Reflect.apply(resolve(), thisArg, args),
    });
}

/**
 * Each of these declares a value and, next to it, the type meaning the same name has in ts-morph -
 * a `const` alone would shadow the `export type *` above and leave `Node` resolving to the DOM's.
 */
export const Node = lazyExport("Node");
export type Node<T extends TsMorph.ts.Node = TsMorph.ts.Node> = TsMorph.Node<T>;

export const Project = lazyExport("Project");
export type Project = TsMorph.Project;

export const SyntaxKind = lazyExport("SyntaxKind");
export type SyntaxKind = TsMorph.SyntaxKind;

export const ts = lazyExport("ts");
/** The `ts` namespace is a value above and a set of types here; the two merge into one import. */
export declare namespace ts {
    export type Block = TsMorph.ts.Block;
    export type FunctionLikeDeclaration = TsMorph.ts.FunctionLikeDeclaration;
    export type NamedExports = TsMorph.ts.NamedExports;
    export type NamedImports = TsMorph.ts.NamedImports;
    export type Node = TsMorph.ts.Node;
    export type PropertyAssignment = TsMorph.ts.PropertyAssignment;
    export type ScriptKind = TsMorph.ts.ScriptKind;
    export type SourceFile = TsMorph.ts.SourceFile;
}

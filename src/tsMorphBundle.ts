/**
 * Entry point of `out/ts-morph.js`, the separately bundled copy of ts-morph that `utils/tsMorph.ts`
 * requires the first time an AST command runs. Keeping it out of `out/extension.js` is what makes
 * activation cheap; see that module for the reasoning.
 */
export * from "ts-morph";

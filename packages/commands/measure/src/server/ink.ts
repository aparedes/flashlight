/**
 * Ink is ESM-only from v4 on, and — unlike what a plain "ESM-only" label suggests — its
 * entry point is an *async* module: `ink/build/reconciler.js` has a top-level
 * `await import("./devtools.js")`. Neither Bun nor Node can `require()` an async module,
 * and this package compiles to CommonJS, so a static `import { Box } from "ink"` type-checks
 * but blows up at runtime with:
 *
 *     TypeError: require() async module ".../ink/build/index.js" is unsupported.
 *
 * A dynamic `import()` does work from CommonJS (tsc preserves it under `module: nodenext`),
 * so ink is loaded once through `loadInk()` and read back synchronously with `getInk()`.
 * `runServerApp()` awaits `loadInk()` before it renders anything, which is what guarantees
 * the module is there by the time a component calls `getInk()`.
 *
 * This indirection disappears the day `@lantern/measure` itself ships as ESM.
 */
type Ink = typeof import("ink");

let ink: Ink | undefined;

export const loadInk = async (): Promise<Ink> => (ink ??= await import("ink"));

export const getInk = (): Ink => {
  if (!ink) {
    throw new Error("Ink was used before `loadInk()` resolved");
  }

  return ink;
};

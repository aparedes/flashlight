# Modernization Plan

Goal: React 19 + React Compiler, TypeScript 7.0.2 (native compiler), drop Parcel / lodash / husky / lint-staged, upgrade all remaining dependencies, and modernize scripts around Bun.

Everything below was scoped against the actual repo state. TypeScript 7.0.2 was run against the codebase to measure the real migration surface (numbers in Phase 2).

## Current state (relevant bits)

- Bun workspace monorepo, 18 packages + 2 examples. All packages emit CommonJS via `tsc --build` (composite project references), `target: es6`, `moduleResolution: node`, `jsx: react` (classic runtime).
- Two web apps bundled with **Parcel**: `packages/commands/report` (self-contained report HTML) and `packages/commands/measure` webapp. `writeReport.ts` post-processes Parcel output (regex-extracts the single script tag, injects results JSON).
- React 18.3.1, `ReactDOM.render` (removed in React 19) in both entry points; entry files are `.js` containing JSX (Parcel tolerated this).
- Ink 3 for the measure CLI UI (2 small components), MUI 5, Tailwind 3 (3 duplicate configs), apexcharts pinned 3.54.1, express 4, commander 12.
- lodash used in 8 files (`mapValues`, `round`, `keyBy`, `uniq`, `merge`, `partition`, `orderBy`, `sumBy`, one `_()` chain).
- husky + lint-staged run `oxlint --fix` + `oxfmt` on pre-commit. oxlint 1.80 / oxfmt 0.65 are already current.

---

## Phase 1 — husky + lint-staged → lefthook

Small, independent, do it first.

- Add `lefthook` (v2.x) as root devDependency; delete `.husky/`, remove `husky`, `lint-staged`, and the root `lint-staged` config block.
- Root script: `"prepare": "lefthook install"` (Bun runs root lifecycle scripts, so no `trustedDependencies` entry needed).
- `lefthook.yml`:

```yaml
pre-commit:
  parallel: true
  jobs:
    - name: lint
      glob: "*.{js,ts,tsx}"
      run: bunx oxlint --fix {staged_files}
      stage_fixed: true
    - name: format
      run: bunx oxfmt {staged_files}
      stage_fixed: true
```

`stage_fixed: true` replaces what lint-staged did (re-staging autofixes).

## Phase 2 — TypeScript 7.0.2

`typescript@latest` is now 7.0.2 (the Go-native compiler). Verified against this repo: `tsc --build` (project references, composite, declaration emit) works, but config changes are mandatory:

1. **`moduleResolution: "node"` (node10) has been removed** — every one of the 19 tsconfigs fails with TS5108 today. Switch `tsconfig.module.json` (and root) to `"module": "nodenext"`, `"moduleResolution": "nodenext"`. Emit stays CommonJS because all packages are CJS (no `"type": "module"`), so published output is unchanged.
2. Bump `target` to `es2022` and drop `useDefineForClassFields: false` (there are no class-field footguns in this codebase; and current `es6` target already produces false errors like `String.matchAll`/`Object.values` missing).
3. Add `"types": ["bun"]` so `bun:test` and Node globals resolve under nodenext.
4. Switch `jsx` from `"react"` to `"react-jsx"` (automatic runtime) — required posture for React 19 and the React Compiler; removes the need for `import React` everywhere.

Measured fallout with those settings (one run of tsc 7.0.2): ~150 errors in ~25 files, all mechanical:

| Count  | Error       | Meaning                                                             |
| ------ | ----------- | ------------------------------------------------------------------- |
| 68     | TS2591      | Node globals (`fs`, `child_process`, `__dirname`) — fixed by item 3 |
| 25     | TS2307      | `bun:test` not found — fixed by item 3                              |
| 20 + 4 | TS7006/7031 | implicit `any` fallout of the failed imports above                  |
| 6      | TS2578      | stale `@ts-expect-error` directives to delete                       |
| 5      | TS2550      | lib too old — fixed by item 2                                       |
| 3      | TS2835      | relative imports needing explicit handling under nodenext           |
| 1      | TS18046     | minor `unknown` narrowing                                           |

So realistically: config edits + ~10 files of hand fixes.

**Type-check gate**: to answer the "tsc vs oxc" question — oxc has no type checker; oxlint's type-aware rules are themselves powered by tsgo (typescript-go), so `tsc` 7 _is_ the fast checker now. Because the build already runs `tsc --build`, type checking is inherent, but make it an explicit, cheap gate:

- `"typecheck": "tsc --build"` (incremental; TS7 is ~10× faster than 5.x here)
- Put `bun run typecheck` at the front of the `test` script and as a dedicated CI step.
- Optional follow-up: `oxlint --type-aware` (tsgolint) for type-aware lint rules once on TS7.

## Phase 3 — Parcel → Vite + React Compiler

**Vite 8 + `@vitejs/plugin-react`** replaces Parcel (same HTML-entry model, so the swap is local to the two web packages). For the compiler itself we go fully Babel-free: `@vitejs/plugin-react` 6.1 supports oxc's native Rust port of the React Compiler via [`oxc-transform-react`](https://oxc.rs/docs/guide/usage/transformer/react-compiler.html) (optional peer dep):

```ts
// vite.config.ts — no Babel anywhere in the pipeline
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react({ compiler: true })],
});
```

- `packages/commands/report`: add `vite.config.ts` + **`vite-plugin-singlefile`**. The report is exactly the single-file use case — this inlines JS+CSS into one `index.html`, which lets `writeReport.ts` drop the script-tag regex/`report.js` juggling and become a single placeholder replacement in the HTML. (Alternative: keep separate assets and teach `writeReport` to copy CSS too — more code, no benefit.)
- `packages/commands/measure` webapp: plain Vite build; express keeps serving `dist`. Dev: `vite` with a proxy to the socket.io server.
- Rename the two entry files `index.js` → `index.tsx` (they contain JSX; Vite won't parse JSX in `.js`).
- Update `scripts/build-standalone.ts` asset collection for Vite's output names.
- Remove: `parcel` (×2), the `process` polyfill dep in web-reporter-ui (Parcel-era artifact; Vite `define` covers any residual `process.env`), `rm -rf .parcel-cache` in the root build script.
- Compiler guardrail: `react/rules-of-hooks` is already `error` in oxlint, which is the main precondition the compiler cares about. Verify compiler output by checking for `react/compiler-runtime`/memo cache calls in the bundle.

### oxc React Compiler (no Babel) — and the fallback if it misbehaves

Oxc ships an experimental Rust port of the React Compiler as `oxc-transform-react` (React Compiler → TS removal → automatic JSX → Fast Refresh, all in one native pass), and `@vitejs/plugin-react` 6.1 wires it up behind the `compiler` option. So with Vite 8 (rolldown-based, oxc for TS/JSX/minification) the entire toolchain is Babel-free — the primary plan.

Caveats and mitigations:

- Both oxc's compiler port and the plugin option are **flagged experimental** ("review generated output before production"). This repo is a good fit anyway: small React surface, DOM test suites, and reports that are easy to verify visually. Recoverable compiler bail-outs surface as warnings while still producing code.
- Verification gate (per webapp, once at enablement): `bun run test:unit:dom` green, compiler memo-cache calls present in the bundle (`react/compiler-runtime`), and a reference report renders identically.
- **Fallback is a config-level swap, not an architecture change**: the same plugin exports `reactCompilerPreset` for the Babel path (`@rolldown/plugin-babel` + `babel-plugin-react-compiler` + `@babel/core`). If the oxc port miscompiles something, switch that one `vite.config.ts` to the Babel preset and file the repro upstream.
- Compiler options pass straight through if needed, e.g. `react({ compiler: { compilationMode: "annotation" } })` to opt in per-component instead of `infer`.
- The CLI/node packages never touch any of this — they compile with `tsc`.

## Phase 4 — React 19 + UI ecosystem

- `react`/`react-dom` → **19.2.x**, add explicit `@types/react`/`@types/react-dom` 19 (currently only transitive).
- Both entry points: `ReactDOM.render(...)` → `createRoot(...).render(...)` (`react-dom/client`) — `render` no longer exists in 19.
- **Ink 3 → 7** (React 19 support): `render`/`Box`/`Text` API is stable, surface here is 2 small components; Ink ≥4 is ESM-only, which is fine — the CLI runs under Bun, and TS `module: nodenext` permits `require()` of ESM. `ink-testing-library` 2 → 4.
- **MUI 5 → 9**: usage is modest (Table family, AppBar/Menu, InputBase, icons, `styled`, `createTheme`; no `Grid`). Run the official codemods per major (v6 → v7 → v9). Requires React ≥18, happy with 19.
- **@testing-library/react 14 → 16.3** (React-19 compatible; note it now needs `@testing-library/dom` as a peer).
- **apexcharts 3.54.1 → 7 / react-apexcharts 1.4 → 2.1**: the current exact pin suggests a past regression — the riskiest upgrade in this plan. Do it as its own commit and eyeball every chart in an example report; if v7 misbehaves, v4/v5 are intermediate stops.
- **Tailwind 3 → 4**: run `bunx @tailwindcss/upgrade`, replace the three duplicated `tailwind.config.js` with CSS-first `@theme` in `web-reporter-ui/index.css`, use `@tailwindcss/vite` plugin, drop `postcss` + `autoprefixer` devDeps.

## Phase 5 — drop lodash

8 files. Two-tier replacement:

- Trivially native: `round` → `Math.round(x * 100) / 100` helper, `uniq` → `[...new Set(x)]`, `sumBy` → `reduce`, `keyBy`/`mapValues` → `Object.fromEntries(...map)`, the `_()` chain in `highCpu.ts` → `flatMap`/`filter` + `Object.groupBy` (ES2024 — fine under Bun and the es2022+ lib with `esnext` additions; alternatively es-toolkit `groupBy`).
- Semantics worth keeping: `merge` (deep-merge of apexcharts options), `orderBy`, `partition` → **es-toolkit** (drop-in lodash-compatible, ~97 % smaller, tree-shakable).
- Remove `lodash` (×3 packages) and `@types/lodash`.

## Phase 6 — remaining dependency upgrades + Bun-native scripts

Upgrades (all verified latest):

| Package                               | From → To   | Notes                                                          |
| ------------------------------------- | ----------- | -------------------------------------------------------------- |
| express                               | 4 → 5.2     | measure server only; check route wildcards, `@types/express` 5 |
| commander                             | 12 → 15     | API-stable for this usage                                      |
| supertest                             | 6 → 7       | trivial                                                        |
| socket.io / cors / jszip / file-saver | patch/minor | trivial                                                        |
| tiny-emitter                          | —           | suggestion: replace with native `EventTarget`, one less dep    |

Scripts (modern Bun idioms):

- Replace shell one-liners with small Bun scripts using **`Bun.$`** (already the style of `build-standalone.ts`): e.g. `scripts/clean.ts` with `Bun.Glob` + `rm` instead of `rm -rf packages/*/*/dist`.
- Use `bun run --filter` consistently for per-package builds: `bun run --filter '@perf-profiler/web-reporter' --filter '@perf-profiler/measure' build`.
- `bunx` → `bun x` (current spelling), and most `bunx` uses disappear with Parcel/lint-staged anyway.
- Root `test` script becomes: `oxfmt --check` → `typecheck`/`build` → `oxlint` → `bun test` (unchanged preload split for node/dom suites).

## CI / repo hygiene suggestions

- Split `tests.yml` into parallel jobs: `lint+format+typecheck` on `ubuntu-latest` (cheap, fast) and unit tests split node/dom; keep `macos-latest` only where actually needed (standalone build, iOS e2e).
- Add `bun audit` (Bun ≥1.3) as a non-blocking CI step; `bun outdated` locally.
- Renovate: add grouping for majors and the React ecosystem so future upgrades arrive as coherent PRs.
- Standalone builds: `bun build --compile` also supports linux-x64/arm64 and windows targets — cheap to add once the Parcel coupling is gone.
- Optional: measure server express → `Bun.serve`/Hono later; socket.io is the blocker to validate first — not part of this plan's scope.

## Suggested order & risk

1. lefthook swap (no risk)
2. TS 7.0.2 + nodenext + jsx automatic (mechanical, measured above)
3. Parcel → Vite (report output format is the thing to test: `writeReport` + standalone embedding)
4. React 19 + Ink 7 + RTL 16 (small API surface)
5. React Compiler on (after 3+4; verify bundle + charts interactivity)
6. MUI 9, Tailwind 4, apexcharts 7 — one commit each, visual check each (apexcharts is the highest-risk item)
7. lodash removal, misc upgrades, script/CI polish

Each phase leaves `bun run test` green; nothing needs to land as a big bang.

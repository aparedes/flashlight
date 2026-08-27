# Modernize Tooling (oxlint · oxfmt · Bun · `bun test` · arm64 standalone) Orchestration Plan

**Date:** 2026-08-27 · **Branch:** main · **Commit:** 96a9504 · **Research:** `tasks/2026-08-27-modernize-tooling/research.md` (commit 96a9504)

## Overview

Replace the repo's tooling — ESLint → oxlint, Prettier → oxfmt, Yarn classic + Node → Bun (package manager, script runner, CLI runtime and test runner), Jest → `bun test` — delete the `website/` Docusaurus site and the unused custom ESLint-rule package, ship an arm64-native ffmpeg, and build the standalone macOS `flashlight` executable **from this repo** with `bun build --compile` so Apple Silicon users no longer need Rosetta. Every decision below was verified empirically on 2026-08-27 in a scratch copy of the repo (bun 1.4.0, oxlint 1.80.0, oxfmt 0.65.0, macOS 27 arm64); the "Key Discoveries" list records what was learned so no phase has to rediscover it.

## Current State Analysis

- **Package manager/runtime:** Yarn classic v1 (`yarn.lock`, 12.5k lines), workspaces `packages/*/*` + `examples/*`, Node 18 in CI, `#!/usr/bin/env node` on 8 CLI bins. Lerna 8 (`lerna.json`, `release` script) is the only publishing tool; nothing in CI publishes. One dead `link:` dependency (`package.json:41`) points at a non-existent directory.
- **Lint/format:** single legacy `.eslintrc.js` (ESLint 8 + `@typescript-eslint` 7 + react/react-hooks/import/testing-library/prettier plugins), `.prettierrc.json` `{ printWidth: 100, trailingComma: "es5" }`, `.prettierignore`; 28 inline `eslint-disable*` comments outside `website/`; lint-staged runs `eslint --cache --fix` + `prettier --write`.
- **Tests:** Jest 29 + ts-jest, multi-project (`jest.config.js`: jsdom for `commands/measure`, `core/web-reporter-ui`, node for 9 packages incl. the non-existent `plugins/flipper` and the unused `plugins/eslint`), global setup `jest-setup.ts` (+ `packages/core/web-reporter-ui/mockApexChart.tsx`), 4 snapshot files, 8 `jest.mock` factories, ~15 `jest.spyOn`, 5 test files without a `.test.` suffix.
- **Build:** `tsc --build` over 18 project references (CommonJS/ES6, `tsconfig.module.json`), then Parcel 2 builds the `report` and `measure` web apps. Parcel finds the project root via `.git` / `yarn.lock` (it does not know `bun.lock`).
- **Apple Silicon:** `packages/core/shell/src/processVideoFile.ts:26` downloads an **x86_64** ffmpeg 4.4.1 for `darwin-arm64` (ffbinaries has no arm64 macOS build at any version); the released `flashlight-macos` executable was an x86_64 vercel/pkg bundle built *outside* this repo. The C++ profiler binaries are Android targets (host arch irrelevant).
- **Website:** `website/` (57 files, own `yarn.lock`), referenced from `README.md:2,11,22-24,42`, `CONTRIBUTING.md:97-99`, `.prettierignore:8-9`, `.eslintrc.js:37`.

## Desired End State

- `bun install` is the only install step; `bun.lock` is committed, `yarn.lock`, `lerna.json`, `website/`, `packages/plugins/eslint` are gone. All root scripts, CI (`oven-sh/setup-bun`), husky/lint-staged, docs and the 8 bin shebangs use bun.
- `bun run test` = `oxfmt --check && bun run build && oxlint --max-warnings 0 && bun run test:unit` and passes locally and in `.github/workflows/tests.yml`.
- `.oxlintrc.json` / `.oxfmtrc.json` replace the ESLint/Prettier configs and their 10 dev dependencies; no `eslint-disable` comments remain (6 `oxlint-disable` comments replace the ones still needed).
- `bun test` runs the 18 test files in two preload groups (node / happy-dom) with no Jest packages installed; `tsc --build` enforces `isolatedModules`.
- `installFFMpeg()` downloads a native binary for `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64` from `eugeneware/ffmpeg-static` b6.1.1.
- `bun run build:standalone` produces `build/standalone/flashlight-macos-arm64` (single Mach-O arm64 file, ~80 MB, signed) that runs `flashlight measure|test|tools|report` with the cpp-profiler binaries and both Parcel web apps embedded.

Verification of the end state: `bun install --frozen-lockfile && bun run test && bun run build:standalone && ./build/standalone/flashlight-macos-arm64 --help` all exit 0 on an arm64 Mac.

Key Discoveries (all verified 2026-08-27 in a scratch copy):
- `bun install` accepts the nested `packages/*/*` workspace globs and links every `@perf-profiler/*` workspace from plain semver ranges (`node_modules/@perf-profiler/<name>` → symlink). `bun install` runs the root `prepare` script (husky) when `.git` exists.
- Parcel 2.12 locates the project root via `yarn.lock`/`package-lock.json`/`pnpm-lock.yaml` or `.git` — **not** `bun.lock`. With `.git` present the outputs land where the code expects them (`packages/commands/report/dist/index.html` + `index.<hash>.js`, same for `measure`).
- `bun run <script>` **inside** a workspace package does not put the hoisted root `node_modules/.bin` on `PATH` (`parcel: command not found`); `bunx parcel …` in the package scripts fixes it, and then `bun run --filter <pkgName> build` from the root works.
- oxfmt: `oxfmt --migrate prettier` reproduces the Prettier config; `oxfmt --check` passes on all current files (TS/JS/JSON/MD) with **zero diffs**, so Phase 2 causes no formatting churn. `oxfmt` moves trailing same-line comments to their own line, so `// oxlint-disable-line` is unusable — use `oxlint-disable-next-line`.
- oxlint: unknown rule names in `.oxlintrc.json` are a **hard error** (`Rule 'no-deprecated' not found in plugin 'react'`). `react/no-deprecated`, `import/no-extraneous-dependencies`, `testing-library/*` do not exist. React-hooks rules live under the `react` plugin (`react/rules-of-hooks`, `react/exhaustive-deps`). With the config in Phase 2, the current code has exactly 15 findings + 6 sites that need a disable comment; the fixes in Phase 2 bring it to zero (verified).
- `bun test`: as soon as a file imports anything from `"bun:test"`, the implicit globals (`describe`, `test`, `expect`, `jest`, …) are **no longer injected** — every test file must import everything it uses. `jest.requireActual`/`jest.resetModules` don't exist.
- `bun test` mocking rules (verified): (a) code in the **same package's source** (transpiled by bun) — `import * as ns from "<module>"; spyOn(ns, "fn")` intercepts the consumer's named import; `jest.spyOn(require("<module>"), "fn")` does **not**; (b) code reached through **another workspace package's compiled `dist/`** (CommonJS) — `spyOn(require("<module>"), "fn")` works because the dist code holds the CJS module object, and the ESM-namespace spy does **not**; `mock.module` after the dist module is loaded does not help either; (c) spying on a method of an exported *object* (`profiler.installProfilerOnDevice`, `fs.promises.readFile`, `express.static`, `axios.get`, `Logger.debug`) works for every consumer; (d) `mock.module()` persists for the rest of the process (`mock.restore()` doesn't undo it) and all files in one `bun test` invocation share one module cache.
- `bun test` + class fields: bun evaluates class-field initializers **before** constructor parameter properties are assigned (`PerformanceMeasurer.ts:27`, `SingleIterationTester.ts:39-48` reference `this.options` in initializers → `TypeError`). `"useDefineForClassFields": false` in the **root** `tsconfig.json` (bun reads the cwd's tsconfig for `bun test`) fixes it without code changes; putting it only in `tsconfig.module.json` or a package tsconfig does **not**.
- bun's per-file transpiler fails at runtime on re-exports of types (`SyntaxError: export 'TestCase' not found in './SingleIterationTester'`). `tsc --isolatedModules` reports exactly the 8 offending export statements (listed in Phase 4).
- bun's snapshot serializer hangs (>100 s, CPU-bound) on `expect(asFragment()).toMatchSnapshot()` for the report DOM; `expect(baseElement.innerHTML).toMatchSnapshot()` runs in ~1 s. Text snapshots (`getText(baseElement)`) are byte-identical to Jest's apart from the header. Inline snapshots (`toMatchInlineSnapshot`, `toThrowErrorMatchingInlineSnapshot`) match unchanged. Existing Jest-format `.snap` files are read as-is; `--update-snapshots` rewrites them in Bun format.
- happy-dom (`@happy-dom/global-registrator` 20.x) + `@testing-library/react` 14 + ink-testing-library + a real socket.io server: `measure.test.tsx`, `ServerApp.test.ts`, `ReporterView.test.tsx`, `measurePerformance.test.ts`, `PerformanceMeasurer.test.ts` all pass under the setup in Phase 4.
- `bun build --compile`: bundling ink 3 (`yoga-layout-prebuilt`, an Emscripten asm.js module) with the default ESM format crashes at startup (`ReferenceError: _a is not defined`); **`--format=cjs` fixes it** (ink renders inside the binary). `--asset-naming="[dir]/[name].[ext]"` is required — plain `[name].[ext]` silently collides the two `index.html` files. Embedded files (`import x from "./f" with { type: "file" }`) are readable with `fs.readFileSync`/`fs.statSync` (path `/$bunfs/root/<dir>/<name>`; extension-less files get a trailing `.`) but **`fs.copyFileSync` fails with ENOENT**. Inside the binary `__dirname` is the on-disk directory of the executable, so the three `__dirname`-based asset lookups need an override. bun 1.4.0 emits an invalid ad-hoc signature (SIGKILL on launch); `codesign --sign - --force <binary>` (or a real identity) fixes it. A binary with the real CLI dependencies is ~70 MB before assets.
- Lerna 8.1.9 only supports `npmClient: npm|yarn|pnpm` (Lerna 10 adds bun but needs Node ≥ 22.13). Decision: drop Lerna.
- `oven-sh/setup-bun@v2` inputs: `bun-version`, `bun-version-file` (`.bun-version`, `package.json`, `.tool-versions`); caches by default.
- `@types/bun` coexists with `tsc --build` (verified: full build passes with it installed).

## What We're NOT Doing

- No Rust port of `cpp-profiler` (parked in `later-rust-profiler-prompt.md`); no changes to C++ sources, the committed `bin/BAMPerfProfiler-*` ELF files, the NDK build scripts, or their host-arch story.
- No upgrade of `ink` (stays 3.x), React, Parcel, TypeScript, commander or any runtime dependency; no switch away from CommonJS output; no replacement of Parcel by `bun build` for the web apps (deferred to the dependency-update plan, where it must be paired with the Tailwind v3 → v4 migration because bun has no PostCSS pipeline and `bun-plugin-tailwind` targets v4; Phase 5's asset collection is already bundler-agnostic for that).
- No type-aware linting (`--type-aware`/`oxlint-tsgolint`), no enabling of oxlint's React-Compiler rules (`react/refs`, `react/set-state-in-effect`) or any rule not previously enforced; no fixing of lint findings beyond the 15 listed in Phase 2.
- No npm publishing story (`lerna publish` is removed and not replaced by `bun publish`/changesets); package `version` fields and `CHANGELOG.md` files are left untouched (including the `docs.flashlight.dev` link in `CHANGELOG.md:256`).
- No GitHub release workflow for the standalone; no Linux/Windows standalone; no change to the external `get.flashlight.dev` installer or to `.github/ISSUE_TEMPLATE/*` (they reference the cloud product, not the docs site).
- No re-enabling of `.github/workflows/ios_e2e.yml` (trigger stays `main-disabled`); its scripts are only updated mechanically. `fakeStore.app`, `example.apk`, `twitter-clone-rn.apk` stay.
- No changes to what runs on **AWS Device Farm hosts**: `packages/plugins/aws-device-farm/src/createTestSpecFile.ts:43-44` (`npm install --global yarn` / `yarn install …`), its snapshot, the `yarn jest appium` example in `packages/plugins/aws-device-farm/src/bin.ts:15`, and the `npx ts-node examples/e2e/appium-ci.test.ts` test command inside the root `test:e2e` script stay Node/Yarn-based because bun is not installed on those hosts.
- No fix for the stale `packages/commands/measure/package.json` `bin` path (`dist/bin.js` vs actual `dist/server/bin.js`) beyond what Phase 5 needs.
- No behavioural changes to the CLI commands, the web apps, or the report format.

## Implementation Approach

Five sequential phases, each a revertible commit. Phase 1 swaps the package manager/runtime while keeping ESLint/Prettier/Jest running under bun, so the existing test suite validates the swap. Phase 2 swaps lint/format (Jest still validates). Phase 3 makes the small ffmpeg change **before** the test migration so the network-hitting test path is deleted while it is still trivially editable under Jest. Phase 4 migrates the tests (the largest and riskiest phase, on `opus`). Phase 5 builds the standalone on top of a fully bun-based, verified tree. All runtime code changes are minimal and lazy (env-var overrides evaluated at call time) so import order never matters.

## Orchestration

**Orchestrator model:** `sonnet` — phases are fully specified with verified snippets; the orchestrator briefs, checks diffs against the checklists, and re-runs the verification commands. Phases 4 and 5 run on `opus` themselves, so no extra orchestrator judgment is needed.

**Commit convention:** one commit per phase on a new branch `chore/modernize-tooling` created from `main` (create it before Phase 1). Conventional-commit messages, lowercase, verb first (per `CONTRIBUTING.md:5-20`):
- Phase 1 → `chore(tooling): replace yarn and node with bun, drop lerna and the docs website`
- Phase 2 → `chore(tooling): replace eslint and prettier with oxlint and oxfmt`
- Phase 3 → `fix(shell): download a native arm64 ffmpeg build`
- Phase 4 → `chore(tooling): migrate the test suite from jest to bun test`
- Phase 5 → `feat(cli): build the standalone macos executable with bun`
Commit `bun.lock` in Phase 1. Never commit `node_modules`, `dist`, `build/`, `.parcel-cache`, or `packages/commands/flashlight/src/embedded.generated.ts`.

---

## Phase 1: Bun replaces Yarn/Node in tooling; repo cleanup

### Overview
Switch the package manager, script runner and CLI runtime to Bun; delete Lerna, the Docusaurus website, the unused custom-ESLint-rule package and the stale entries that reference them; update CI, husky, docs and shebangs. ESLint, Prettier and Jest are untouched in this phase and must still pass — they are the regression check for the swap. Comes first because every later phase installs/removes packages with bun.

### Recommended model
`sonnet` — broad but mechanical edits across scripts, CI and docs; no design decisions.

### Effort
medium — many files, each change small; the risk is missing a `yarn`/`node` reference, and the verification greps catch that.

### Changes Required

#### 1. Branch, lockfile, bun version pin
**Files**: `yarn.lock` (delete), `bun.lock` (new, generated), `.bun-version` (new)
**Changes**:
- [x] `git checkout -b chore/modernize-tooling` from `main` (skip if the branch already exists).
- [x] Create `.bun-version` containing exactly `1.4.0` (newline-terminated). This is what CI's `setup-bun` reads.
- [x] After all `package.json` edits below are done: `git rm yarn.lock`, then run `bun install` at the root and commit the generated `bun.lock` (text lockfile, first line `{`, second line `"lockfileVersion": 2,`). Do **not** add `bun.lock` to `.gitignore`.
  > Deviation: running `bun install` **after** `git rm yarn.lock` (as literally written) is not a no-op like the Key Discoveries section assumed. With no `yarn.lock` present, bun 1.4.0 treats a workspace repo as brand-new and defaults to the **isolated** linker (`configVersion: 2`), which leaves `node_modules/@perf-profiler/` empty and breaks `tsc --build`/`eslint` outright. Separately, unpinned `"@types/react": "*"` and `@mui/material`'s peer range float to breaking new majors (19.2.18 vs yarn's frozen 18.2.34; 5.18.0 vs 5.16.9), breaking `tsc --build` (missing global `JSX` namespace) and 2 Jest tests. Fix (verified end-to-end, 18/18 suites green): run `bun install` **while `yarn.lock` is still present** so bun migrates from it (`configVersion: 0`, hoisted linker, yarn's exact resolved versions), and only run `git rm yarn.lock` afterward. Also added `"@typescript-eslint/parser": "^7.2.0"` as an explicit root devDependency — it's only a peerDependency of `@typescript-eslint/eslint-plugin`, which yarn classic happened to resolve/hoist anyway but bun's migrated install does not auto-install; this line is transitional and gets removed with the rest of the ESLint toolchain in Phase 2 (added to that phase's removal list). Also added `tasks` to `.prettierignore` to exclude this orchestration session's untracked scratch directory (`tasks/2026-08-27-modernize-tooling/`) from `prettier --check .` — it has no history in this repo and isn't part of the plan's file list.

#### 2. Root `package.json`
**File**: `package.json`
**Changes**:
- [x] Remove `"eslint-plugin-custom-rules": "link:./packages/eslint-plugin-flashlight-eslint-rules/dist",` (line 41, devDependencies) — the target directory does not exist.
- [x] Remove `"lerna": "^8.1.2",` (line 50, devDependencies).
- [x] Replace the `scripts` block (lines 21-32) with:
  ```json
  "scripts": {
    "clean-dist": "rm -rf packages/*/*/dist && rm -rf packages/*/*/tsconfig.tsbuildinfo",
    "watch": "tsc --build --watch",
    "test": "prettier --check . && bun run build && eslint . --max-warnings 0 && jest",
    "test:coverage": "bun run clean-dist && jest --coverage",
    "test:lint": "eslint . --ext .js,.ts,.tsx --cache",
    "run-cli-example": "bun examples/cli/index.ts",
    "build": "rm -rf .parcel-cache && bun run clean-dist && tsc --build && bun run --filter @perf-profiler/web-reporter build && bun run --filter @perf-profiler/measure build",
    "test:e2e": "mkdir -p report && bun packages/plugins/aws-device-farm/dist/bin.js runTest --apkPath .github/workflows/example.apk --projectName 'Flashlight-Serverless' --reportDestinationPath report --testCommand 'npx ts-node examples/e2e/appium-ci.test.ts' --testFolder .",
    "prepare": "husky"
  },
  ```
  (`release` is removed with Lerna; `run-cli-example` pointed at a non-existent `packages/cli-example`; the `npx ts-node …` inside `test:e2e` runs on AWS Device Farm hosts and stays.)
- [x] Leave `lint-staged`, `workspaces`, `dependencies` unchanged.

#### 3. Workspace scripts that used `yarn`
**Files**: `packages/commands/measure/package.json`, `packages/commands/report/package.json`, `examples/e2e/package.json`
**Changes**:
- [x] `packages/commands/measure/package.json` lines 41-42 → `"build": "bunx parcel build src/webapp/index.html"`, `"start": "bunx parcel src/webapp/index.html"` (`bunx` is required: `bun run` inside a workspace does not see the hoisted `node_modules/.bin`).
- [x] `packages/commands/report/package.json` lines 26-27 → `"start": "bunx parcel src/index.html"`, `"build": "bunx parcel build src/index.html"`.
- [x] `examples/e2e/package.json` line 11 → `"test": "tsc && bun run test:e2e"`.

#### 4. Lerna removal
**Files**: `lerna.json` (delete)
**Changes**:
- [x] `git rm lerna.json`.

#### 5. Husky
**File**: `.husky/pre-commit`
**Changes**:
- [x] Line 3 `npx lint-staged` → `bunx lint-staged`.

#### 6. CI — active workflow
**File**: `.github/workflows/tests.yml`
**Changes**:
- [x] Replace the whole file with:
  ```yaml
  name: Tests

  on:
    push:
      branches:
        - main
    pull_request:
      branches:
        - main
        - "**/main"

  jobs:
    tests:
      runs-on: macos-latest
      steps:
        - uses: actions/checkout@v4
        - name: Use Bun
          uses: oven-sh/setup-bun@v2
          with:
            bun-version-file: ".bun-version"
        - name: Install dependencies
          run: bun install --frozen-lockfile
        - name: Run tests
          run: bun run test
  ```
  (The commented-out "Push yarn.lock update" block is dropped.)

#### 7. CI — disabled iOS workflow (kept disabled, updated mechanically)
**Files**: `.github/workflows/ios_e2e.yml`, `.github/workflows/build-and-link.sh`, `.github/workflows/ios_e2e.sh`, `.github/workflows/netlify-report.sh`
**Changes**:
- [x] `ios_e2e.yml` lines 17-22: replace the `Use Node.js` step (`actions/setup-node@v4` with `node-version: "18.x"`) by `- name: Use Bun` / `uses: oven-sh/setup-bun@v2` / `with: bun-version-file: ".bun-version"`, and `run: yarn` → `run: bun install --frozen-lockfile`. Line 30 `npx @perf-profiler/web-reporter report report -o report` → `bun packages/commands/report/dist/openReport.js report report -o report`. Leave the `main-disabled` triggers.
- [x] `build-and-link.sh`: replace lines 5-7 (`yarn tsc --build`, `yarn workspace @perf-profiler/web-reporter build`, `npx link-lerna-package-binaries`) with the single line `bun run build` (the Lerna link helper is gone; the bins are invoked by path below).
- [x] `ios_e2e.sh` line 25: `npx flashlight-ios-poc ios-test …` → `bun packages/platforms/ios-instruments/dist/launchIOS.js ios-test …` (rest of the line unchanged).
- [x] `netlify-report.sh` line 5: `npx netlify-cli@15.11.0` → `bunx netlify-cli@15.11.0`.

#### 8. CLI shebangs (Node → Bun runtime)
**Files**: the 8 bin sources
**Changes**:
- [x] Change line 1 `#!/usr/bin/env node` → `#!/usr/bin/env bun` in: `packages/commands/measure/src/server/bin.tsx`, `packages/commands/report/openReport.ts`, `packages/commands/test/src/bin.ts`, `packages/commands/tools/src/bin.ts`, `packages/core/logger/bin.ts`, `packages/platforms/android/src/commands.ts`, `packages/platforms/ios-instruments/src/launchIOS.ts`, `packages/plugins/aws-device-farm/src/bin.ts`.

#### 9. Website deletion and its references
**Files**: `website/` (delete), `README.md`, `CONTRIBUTING.md`
**Changes**:
- [x] `git rm -r website`.
- [x] `README.md`: delete lines 1-3 (the `<p align="center"><img src="./website/static/img/logo-black.svg" …>` block) so the file starts with `# Get a performance score for your app 🔦`; line 11 → `✨ Generates beautiful reports`; lines 22-24 → plain bullets without links: ``- `flashlight measure`: quickly audit your perf with real-time measures``, ``- `flashlight test`: automate your measures with e2e performance testing over several iterations``, ``- `flashlight cloud`: run measures on real devices in the cloud & integrate in your CI setup``; line 42 (`Head over to the docs at [docs.flashlight.dev](https://docs.flashlight.dev)`) → ``Run `flashlight --help` (or `flashlight <command> --help`) for the CLI reference, and see [CONTRIBUTING.md](./CONTRIBUTING.md) to run the commands from source.``
- [x] `.prettierignore`: delete lines 8-9 (`.docusaurus`, `website/build`). `.eslintrc.js` line 37: `ignorePatterns: ["dist", "node_modules", "cpp-profiler", "report.js"]` (drop `"docs"` and `".docusaurus"`). Both files are deleted in Phase 2; this keeps the website grep below clean.
  > Deviation: also added a `tasks` entry to `.prettierignore` — see the note on item 1.
- [x] `CONTRIBUTING.md`: delete lines 97-99 (`### Running the docs website locally` + link). Also apply the yarn/node replacements: line 29 `yarn` → `bun install`; line 30 `yarn watch` → `bun run watch`; line 40 → `bun run --filter @perf-profiler/measure start`; line 46 → `DEVELOPMENT_MODE=true bun packages/commands/measure/dist/server/bin.js measure`; line 54 → `bun packages/commands/test/dist/bin.js test`; line 68 → `bun packages/commands/tools/dist/bin.js tools`; line 82 → `bun run --filter @perf-profiler/web-reporter start`; line 95 → ``Run `bunx jest Plugin -u` after modifications.`` (Phase 4 rewrites this line again.)

#### 10. Unused custom ESLint-rule package and stale Jest projects
**Files**: `packages/plugins/eslint/` (delete), `jest.config.js`
**Changes**:
- [x] `git rm -r packages/plugins/eslint` (never referenced by `.eslintrc.js` or `tsconfig.json`; only by the `link:` line removed in step 2).
- [x] `jest.config.js` line 21: `const WEB_PACKAGES = ["commands/measure", "core/web-reporter-ui"];` (drop `"plugins/flipper"`, which does not exist). Lines 23-33: remove the `"plugins/eslint",` entry from `NODE_PACKAGES`.

#### 11. Package READMEs that documented yarn/node
**Files**: `packages/platforms/ios/README.md`, `packages/platforms/ios-instruments/README.md`, `packages/plugins/appium-helper/README.md`
**Changes**:
- [x] `packages/platforms/ios/README.md` line 18: `PLATFORM=ios node packages/commands/measure/dist/server/bin.js measure` → `PLATFORM=ios bun packages/commands/measure/dist/server/bin.js measure`.
- [x] `packages/platforms/ios-instruments/README.md` line 16 → `` `bun run --filter @perf-profiler/web-reporter build` ``; line 17 → `` - `bun packages/commands/report/dist/openReport.js report result.json` ``.
- [x] `packages/plugins/appium-helper/README.md` line 27 → ``1. Install the helper `bun add @bam.tech/appium-helper` ``; line 48 → ``4. Run your test file in a separate terminal `bun test appium.test.ts` ``.

#### 12. Formatting of the edited files
- [x] Run `bunx prettier --write README.md CONTRIBUTING.md .github/workflows/tests.yml .github/workflows/ios_e2e.yml package.json packages/commands/measure/package.json packages/commands/report/package.json examples/e2e/package.json jest.config.js packages/platforms/ios/README.md packages/platforms/ios-instruments/README.md packages/plugins/appium-helper/README.md` so `prettier --check .` stays green.

### Success Criteria

#### Automated Verification:
- [x] `bun install --frozen-lockfile` exits 0 and `node_modules/@perf-profiler` contains 16 symlinks (`ls node_modules/@perf-profiler | wc -l` → 16).
  > Deviation: the correct count is **15**, not 16 — the repo has exactly 15 `@perf-profiler/*` workspace packages after this phase's deletions (the plan's "16" was simply off by one). Verified `ls node_modules/@perf-profiler | wc -l` → `15` after `bun install --frozen-lockfile` exits 0.
- [x] `bun run test` exits 0 (this runs `prettier --check .`, the full `bun run build` incl. both Parcel apps, `eslint . --max-warnings 0`, and the complete Jest suite under Node). Re-run by the orchestrator: `Test Suites: 18 passed, 18 total`, `Tests: 40 passed, 40 total`.
- [x] `ls packages/commands/report/dist/index.html packages/commands/measure/dist/index.html` — both exist (Parcel found the project root via `.git`).
- [x] `git ls-files website packages/plugins/eslint yarn.lock lerna.json | wc -l` → `0`; `git ls-files bun.lock .bun-version | wc -l` → `2`.
- [x] `grep -rn --exclude-dir=node_modules --exclude-dir=.git --exclude=bun.lock --exclude=CHANGELOG.md -w yarn . | grep -v -e 'createTestSpecFile' -e 'aws-device-farm/src/bin.ts'` prints nothing.
- [x] `grep -rln '#!/usr/bin/env node' packages examples` prints nothing; `grep -rln 'lerna\|website/\|docs\.flashlight\.dev' --exclude-dir=node_modules --exclude-dir=.git --exclude=CHANGELOG.md --exclude='*.md' . ` prints nothing, and `grep -n 'docs.flashlight.dev\|website/' README.md CONTRIBUTING.md` prints nothing.

#### Manual Verification:
- [ ] Open a PR from `chore/modernize-tooling` (or push the branch) and confirm the `Tests` workflow is green on `macos-latest` with `setup-bun`.
- [ ] `bun run --filter @perf-profiler/web-reporter start` serves the report dev app on http://localhost:1234.

---

## Phase 2: oxlint + oxfmt replace ESLint + Prettier

### Overview
Add `.oxlintrc.json`/`.oxfmtrc.json`, remove the ESLint/Prettier toolchain (10 dev dependencies, 3 config files), rewrite the lint/format scripts and lint-staged, fix the 15 findings oxlint reports on the current code, and replace the 28 `eslint-disable` comments with the 6 `oxlint-disable` comments still needed. Comes after Phase 1 so `bun add/remove` manages the lockfile; before the test migration so Jest still validates the code fixes.

### Recommended model
`sonnet` — every finding and its fix is enumerated below; the work is applying them and re-running the tools.

### Effort
medium — small edits in 17 files, with two exact-placement rules (comment position before `catch`, `@ts-expect-error` adjacency) that must be followed literally.

### Depends on prior phases
- The repo installs with `bun install`; `bun.lock` exists; `yarn.lock`, `website/`, `packages/plugins/eslint/` are gone (Phase 1).
- Root `package.json` scripts `test`, `test:lint`, `build` are as written in Phase 1 step 2; `lint-staged` still runs `eslint --cache --fix` / `prettier --write`.

### Changes Required

#### 1. Dependencies
**File**: `package.json` (root)
**Changes**:
- [ ] `bun remove @typescript-eslint/eslint-plugin @typescript-eslint/parser @typescript-eslint/utils eslint eslint-config-prettier eslint-plugin-import eslint-plugin-prettier eslint-plugin-react eslint-plugin-react-hooks eslint-plugin-testing-library prettier`
  > Reconciled: Phase 1 added `@typescript-eslint/parser` as an explicit root devDependency (it was only a peerDependency of `@typescript-eslint/eslint-plugin`, needed for the `bun install` migration to resolve correctly — see Phase 1's item 1 deviation note). It must be included in this removal command alongside the other ESLint packages.
- [ ] `bun add -d oxlint oxfmt` (expected ≥ `oxlint@1.80.0`, `oxfmt@0.65.0`).

#### 2. oxlint config
**File**: `.oxlintrc.json` (new, root)
**Changes**:
- [ ] Create with exactly this content (no comments — the file is formatted by oxfmt as JSON):
  ```json
  {
    "$schema": "./node_modules/oxlint/configuration_schema.json",
    "plugins": ["eslint", "typescript", "unicorn", "oxc", "react", "import"],
    "categories": { "correctness": "error" },
    "env": { "node": true, "es2022": true },
    "rules": {
      "react/self-closing-comp": ["error", { "component": true, "html": true }],
      "react/rules-of-hooks": "error",
      "react/exhaustive-deps": "warn",
      "react/refs": "off",
      "react/set-state-in-effect": "off",
      "no-unused-vars": "error",
      "prefer-const": "error",
      "typescript/no-explicit-any": "error"
    },
    "overrides": [
      {
        "files": ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx", "**/utils/test/**", "test-setup/**"],
        "rules": {
          "typescript/no-require-imports": "off",
          "typescript/no-var-requires": "off"
        }
      }
    ],
    "ignorePatterns": ["dist", "node_modules", "cpp-profiler", "report.js", "coverage", "build"]
  }
  ```
  `react/refs` and `react/set-state-in-effect` are React-Compiler-era rules in oxlint's `correctness` category that ESLint never enforced here (6 hits in `web-reporter-ui`); they are explicitly off to keep this a tooling swap. Document that in CONTRIBUTING (step 8).

#### 3. oxfmt config
**Files**: `.oxfmtrc.json` (new), `.prettierrc.json` (delete), `.prettierignore` (delete)
**Changes**:
- [ ] Create `.oxfmtrc.json`:
  ```json
  {
    "$schema": "./node_modules/oxfmt/configuration_schema.json",
    "printWidth": 100,
    "trailingComma": "es5",
    "sortPackageJson": false,
    "ignorePatterns": [
      "dist",
      "node_modules",
      "cpp-profiler",
      "coverage",
      "build",
      "report.js",
      "report.html",
      "results*.json"
    ]
  }
  ```
- [ ] `git rm .prettierrc.json .prettierignore`.

#### 4. ESLint config and cache
**Files**: `.eslintrc.js` (delete), `.gitignore`
**Changes**:
- [ ] `git rm .eslintrc.js`.
- [ ] `.gitignore`: remove line 7 `.eslintcache`; add a line `/build/` (used by Phase 5's standalone output; harmless now).

#### 5. Scripts and lint-staged
**File**: `package.json` (root)
**Changes**:
- [ ] In `scripts`: replace `"test"` with `"test": "oxfmt --check && bun run build && oxlint --max-warnings 0 && jest"`; delete `"test:lint"`; add `"lint": "oxlint --max-warnings 0"`, `"lint:fix": "oxlint --fix"`, `"format": "oxfmt"`, `"format:check": "oxfmt --check"`.
- [ ] Replace the `lint-staged` block with:
  ```json
  "lint-staged": {
    "*.{js,ts,tsx}": "oxlint --fix",
    "*": "oxfmt --no-error-on-unmatched-pattern"
  }
  ```

#### 6. Code fixes for the 15 oxlint findings
**Changes** (each anchored to a symbol; line numbers are today's):
- [ ] `packages/core/reporter/src/reporting/fps.ts` — both `iterations.forEach` callbacks (lines 17 and 26): `value && averageFpsUsages.push(value);` → `if (value) averageFpsUsages.push(value);` (`no-unused-expressions`).
- [ ] `packages/core/reporter/src/reporting/ram.ts` line 16: `averageRamUsage && values.push(averageRamUsage);` → `if (averageRamUsage) values.push(averageRamUsage);`.
- [ ] `packages/commands/measure/src/server/ServerApp.tsx` in `createExpressApp()`'s `app.get("/")` handler (line 29): `} catch (err) {` → `} catch {` (`no-unused-vars` on caught errors; optional catch binding is valid TS for target ES6).
- [ ] `packages/core/web-reporter-ui/src/components/Charts/Chart.tsx` lines 20 and 27 (the `hideSeries`/`showSeries` try/catch): `} catch (e) {` → `} catch {`.
- [ ] `packages/platforms/android/src/commands/getPidId.ts` line 9: `} catch (error) {` → `} catch {`.
- [ ] `packages/platforms/android/src/commands/ScreenRecorder.ts` line 12: `} catch (error) {` → `} catch {`.
- [ ] `packages/plugins/appium-helper/AppiumDriver.ts` `takeScreenshotOnFailure()` (lines 138-146): delete the two `eslint-disable-next-line` lines (138 and 140), add `// oxlint-disable-next-line no-unused-vars` directly above `async takeScreenshotOnFailure(`, and add `// oxlint-disable-next-line no-useless-catch` as the **last line inside the `try` block** (immediately above `} catch (error) {`). oxlint reports `no-useless-catch` on the `catch` line, not on `try`, and a trailing same-line comment would be moved by oxfmt. Result:
  ```ts
  // oxlint-disable-next-line no-unused-vars
  async takeScreenshotOnFailure(command: () => Promise<void>, errorScreenshotName: string) {
    try {
      await command();
      // oxlint-disable-next-line no-useless-catch
    } catch (error) {
      // await this.takeScreenShot(`ERROR_${errorScreenshotName}`);
      throw error;
    }
  }
  ```
  (The 6 `react/refs` / `react/set-state-in-effect` hits in `Collapsible.tsx`, `Chart.tsx`, `useSetVideoTimeOnMouseHover.tsx` are handled by the config, not by code.)

#### 7. Replace the remaining `eslint-disable` comments
**Changes**:
- [ ] Delete these lines outright (the rule is either not active in oxlint or the code no longer triggers it — verified): `jest-setup.ts:1` (`/* eslint-disable import/no-extraneous-dependencies */`) and `:13`; `packages/platforms/ios-instruments/src/launchIOS.ts:4`; `packages/platforms/android/src/commands/__tests__/shell.test.ts:6,18`; `packages/core/web-reporter-ui/tailwind.config.js:1`; `packages/core/web-reporter-ui/src/sections/VideoSection.tsx:37`; `packages/core/web-reporter-ui/src/components/ThreadTable.tsx:68,81`; `packages/plugins/appium-helper/AppiumDriver.ts:30`; `packages/commands/test/src/utils/test/mockEmitMeasures.ts:7,11,15,19,28`; `packages/commands/measure/tailwind.config.js:1`; `packages/commands/measure/src/webapp/index.js:6,8`; `packages/commands/report/tailwind.config.js:1`; `packages/commands/report/src/index.js:6,8`; `packages/commands/report/src/App.tsx:9`. Keep every `// @ts-expect-error` line that followed them.
- [ ] `packages/commands/measure/src/__tests__/utils/removeCLIColors.ts`: replace line 4's comment with `// oxlint-disable-next-line no-control-regex` (it must stay immediately above the `str?.replace(/\x1B…/g, "")` line).
- [ ] `packages/commands/report/src/App.tsx`: the block must read `// @ts-expect-error` / `// oxlint-disable-next-line prefer-const` / `let testCaseResults: TestCaseResult[] =` (i.e. line 11 `// eslint-disable-next-line prefer-const` → `// oxlint-disable-next-line prefer-const`, line 9 deleted, `@ts-expect-error` kept directly above the disable line — TS still applies it to the `let`).
- [ ] `packages/platforms/android/src/commands/platforms/UnixProfiler.ts` lines 236 and 242: `// eslint-disable-next-line @typescript-eslint/no-unused-vars` → `// oxlint-disable-next-line no-unused-vars` (above `public getScreenRecorder(` and `public async stopApp(`).
- [ ] `AppiumDriver.ts` lines 138/140: done in step 6.

#### 8. Editor settings and contributor docs
**Files**: `.vscode/settings.json`, `.vscode/extensions.json` (new), `CONTRIBUTING.md`
**Changes**:
- [ ] `.vscode/settings.json`: add `"editor.defaultFormatter": "oxc.oxc-vscode"` and `"editor.formatOnSave": true` next to the existing `files.associations`.
- [ ] Create `.vscode/extensions.json`: `{ "recommendations": ["oxc.oxc-vscode"] }`.
- [ ] `CONTRIBUTING.md` line 89 (inside the web-reporter code sample): delete `// eslint-disable-next-line @typescript-eslint/no-var-requires` so the sample is just the `// Uncomment with when locally testing` comment and the `testCaseResults = [require("../measures.json")];` line.
- [ ] `CONTRIBUTING.md`: after the "Commit naming" section add a `## Linting and formatting` section: `bun run lint` / `bun run lint:fix` (oxlint, `correctness` category + the rules in `.oxlintrc.json`), `bun run format` / `bun run format:check` (oxfmt, Prettier-compatible output), `oxlint-disable-next-line <rule>` for one-off exceptions, and one sentence that `react/refs` and `react/set-state-in-effect` are intentionally off.

#### 9. Format
- [ ] Run `bun run format` (oxfmt over the repo) — expected to touch only the files edited in this phase.

### Success Criteria

#### Automated Verification:
- [ ] `bun run lint` exits 0 with no diagnostics printed.
- [ ] `bun run format:check` exits 0 (`All matched files use the correct format.`).
- [ ] `bun run test` exits 0 (oxfmt check, full build, oxlint, complete Jest suite).
- [ ] `grep -rn 'eslint-disable\|prettier-ignore' --exclude-dir=node_modules --exclude-dir=.git . | wc -l` → `0`; `grep -rn 'oxlint-disable' --include='*.ts' --include='*.tsx' --include='*.js' --exclude-dir=node_modules --exclude-dir=.git . | wc -l` → `6`.
- [ ] `git ls-files .eslintrc.js .prettierrc.json .prettierignore | wc -l` → `0`; `grep -c 'eslint\|prettier' package.json` → `0`.
- [ ] `bunx lint-staged --help` exits 0 (lint-staged still resolves under bun).

#### Manual Verification:
- [ ] Stage a `.ts` file with a formatting error and run `git commit`; the husky hook formats it via oxfmt.
- [ ] VS Code with the `oxc.oxc-vscode` extension formats on save and shows oxlint diagnostics.

---

## Phase 3: Native arm64 ffmpeg download; drop the pointless network path

### Overview
`processVideoFile.ts` currently maps `darwin-arm64` to an x86_64 ffbinaries zip (needs Rosetta). Switch to `eugeneware/ffmpeg-static` b6.1.1 raw binaries, which exist for darwin-arm64/x64 and linux-x64/arm64, and remove the `installFFMpeg()` call in `checkResults` that only exists to feed a real-network test (the command copies the video instead of transcoding since 2024). Done before the test migration so the Jest test edit is a two-line deletion.

### Recommended model
`sonnet` — a contained change in one runtime module plus two small deletions.

### Effort
medium — the download/unzip pipeline changes shape (zip → raw binary); the automated check downloads the real binary.

### Depends on prior phases
- Lint/format are oxlint/oxfmt (`bun run lint`, `bun run format`); tests still run with Jest via `bun run test` (Phase 2).
- `packages/core/shell/src/processVideoFile.ts` still has `FFMPEG_VERSION = "4.4.1"`, `archToExec`, `getFFMpegBinaryPath()`, and `installFFMpeg()` calling `downloadFile` + `unzip` (lines 24-50).

### Changes Required

#### 1. ffmpeg download
**File**: `packages/core/shell/src/processVideoFile.ts`
**Changes**:
- [ ] Remove `import { unzip } from "./unzip";` (line 3). Keep `downloadFile`, `fs`, `spawn`.
- [ ] Add `const FFMPEG_BINARY_PATH = `${FFMPEG_BINARY_FOLDER_PATH}/ffmpeg`;` right after `FFMPEG_BINARY_FOLDER_PATH` (line 6).
- [ ] Replace lines 24-38 (`FFMPEG_VERSION`, `archToExec`, `getFFMpegBinaryPath`) with:
  ```ts
  // Static builds from https://github.com/eugeneware/ffmpeg-static (raw executables, no archive).
  // ffbinaries (used before) has no macOS arm64 build at any version, which forced Rosetta.
  const FFMPEG_STATIC_RELEASE = "b6.1.1";
  const platformToAsset: Partial<Record<`${NodeJS.Platform}-${NodeJS.Architecture}`, string>> = {
    "darwin-arm64": "ffmpeg-darwin-arm64",
    "darwin-x64": "ffmpeg-darwin-x64",
    "linux-x64": "ffmpeg-linux-x64",
    "linux-arm64": "ffmpeg-linux-arm64",
  };

  const getFFMpegDownloadUrl = () => {
    const key = `${process.platform}-${process.arch}` as const;
    const asset = platformToAsset[key];
    if (!asset) {
      throw new Error(`Unsupported os ${process.platform}-${process.arch} to install FFMpeg`);
    }
    return `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_STATIC_RELEASE}/${asset}`;
  };
  ```
- [ ] Replace `installFFMpeg` (lines 40-50) with:
  ```ts
  export const installFFMpeg = async () => {
    fs.mkdirSync(FFMPEG_BINARY_FOLDER_PATH, { recursive: true });
    await downloadFile(getFFMpegDownloadUrl(), FFMPEG_BINARY_PATH);
    fs.chmodSync(FFMPEG_BINARY_PATH, 0o755);
  };
  ```
- [ ] In `processVideoFile` (line 53-55) use `FFMPEG_BINARY_PATH` instead of the two inline `${FFMPEG_BINARY_FOLDER_PATH}/ffmpeg` template strings. Keep the `-vsync 0 … -loglevel error` command unchanged (ffmpeg 6.1 still accepts `-vsync`; the warning is silenced by `-loglevel error`).
- [ ] `packages/core/shell/src/index.ts` keeps `export * from "./unzip";` (used by `checkResults`).

#### 2. `checkResults` no longer downloads ffmpeg
**File**: `packages/plugins/aws-device-farm/src/commands/checkResults.ts`
**Changes**:
- [ ] Line 6: `import { installFFMpeg, downloadFile, unzip } from "@perf-profiler/shell";` → `import { downloadFile, unzip } from "@perf-profiler/shell";`
- [ ] Delete line 68 `await installFFMpeg();` (`processVideo` at lines 62-66 only copies the file).

#### 3. The Jest test that hit the network
**File**: `packages/plugins/aws-device-farm/src/commands/__tests__/checkResults.ts`
**Changes**:
- [ ] Delete lines 11-12 (`// Downloading FFMpeg binary takes time` and `jest.setTimeout(30000);`).
- [ ] Delete lines 29-30 (`// Actually download FFMpeg binary` and `jest.spyOn(axios, "get").mockImplementationOnce(jest.requireActual("axios").get);`). Everything else stays.

#### 4. Format
- [ ] `bun run format`.

### Success Criteria

#### Automated Verification:
- [ ] `bun run test` exits 0 (build, lint, Jest — `checkResults` now runs fully offline).
- [ ] `grep -rn 'ffbinaries\|FFMPEG_VERSION' packages | wc -l` → `0`; `grep -n installFFMpeg packages/plugins/aws-device-farm/src/commands/checkResults.ts | wc -l` → `0`.
- [ ] Real download on this arm64 Mac (needs network): `rm -rf /tmp/ffmpeg-binary && bun -e 'require("./packages/core/shell/dist/index.js").installFFMpeg().then(() => console.log("installed"))' && file /tmp/ffmpeg-binary/ffmpeg | grep -q 'arm64' && /tmp/ffmpeg-binary/ffmpeg -version | head -1` prints `installed` and an `ffmpeg version 6.1.1…` line, and `file` reports `Mach-O 64-bit executable arm64`.

#### Manual Verification:
- [ ] `bun packages/commands/tools/dist/bin.js tools video_fix_metadata <some.mp4>` re-encodes the file using `/tmp/ffmpeg-binary/ffmpeg` without Rosetta (`ps`/Activity Monitor shows no "Intel" process).

---

## Phase 4: Jest → `bun test`

### Overview
Remove Jest, ts-jest, jsdom and `@types/jest`; run the 18 test files with `bun test` in two preload groups (plain node, and happy-dom for the two web packages); convert every Jest-specific API using the verified mocking rules; rename the 5 suffix-less test files; make `tsc` enforce `isolatedModules` and set `useDefineForClassFields: false` so bun's transpiler and tsc agree on class semantics; switch DOM snapshots from fragments to `innerHTML` strings. Comes after Phase 3 so the network-hitting test line is already gone.

### Recommended model
`opus` — 18 files with per-file mock semantics, a module-cache-sharing test runner, and snapshot regeneration that must be judged (text snapshots must not change).

### Effort
high — every rule below was verified, but the runner's shared module cache means ordering/leak mistakes show up as confusing failures in *other* files.

### Depends on prior phases
- `bun run test` is `oxfmt --check && bun run build && oxlint --max-warnings 0 && jest` and passes (Phases 1-3).
- `.oxlintrc.json` exists with an override for `**/__tests__/**`, `**/*.test.ts(x)`, `**/utils/test/**`, `test-setup/**` (Phase 2).
- `jest.config.js` lists `WEB_PACKAGES = ["commands/measure", "core/web-reporter-ui"]` and 8 `NODE_PACKAGES` (no `plugins/eslint`, no `plugins/flipper`) (Phase 1).
- `packages/plugins/aws-device-farm/src/commands/__tests__/checkResults.ts` no longer contains `jest.requireActual` or `jest.setTimeout` (Phase 3).
- `packages/plugins/eslint/` and its `.spec.ts` test are gone (Phase 1).

### Changes Required

#### 1. Dependencies and scripts
**File**: `package.json` (root)
**Changes**:
- [ ] `bun remove @types/jest jest jest-environment-jsdom ts-jest`
- [ ] `bun add -d @types/bun @happy-dom/global-registrator` (expected `@types/bun@1.4.x`, `@happy-dom/global-registrator@20.x`).
- [ ] Scripts: replace `"test"` with `"test": "oxfmt --check && bun run build && oxlint --max-warnings 0 && bun run test:unit"`; replace `"test:coverage"` with `"test:coverage": "bun run test:unit:node --coverage && bun run test:unit:dom --coverage"`; add
  ```json
  "test:unit": "bun run test:unit:node && bun run test:unit:dom",
  "test:unit:node": "bun test --preload ./test-setup/node.ts packages/platforms/android packages/plugins/aws-device-farm packages/commands/test packages/core/reporter packages/commands/report",
  "test:unit:dom": "bun test --preload ./test-setup/dom.tsx packages/core/web-reporter-ui packages/commands/measure/src/__tests__/measure.test.tsx packages/commands/measure/src/__tests__/server && bun test --preload ./test-setup/dom.tsx packages/commands/measure/src/__tests__/webapp"
  ```
  (`socket.test.ts` gets its own invocation because it `mock.module`s `socket.io-client` and evaluates `webapp/socket.ts` with the mock; in a shared module cache that would poison `measure.test.tsx`.)
- [ ] `packages/platforms/android/package.json` line 15: `"test": "tsc && jest"` → `"test": "tsc"`.

#### 2. Runner config and preloads
**Files**: `bunfig.toml` (new), `test-setup/node.ts` (new), `test-setup/dom.tsx` (new), `jest.config.js` (delete), `jest-setup.ts` (delete), `packages/core/web-reporter-ui/mockApexChart.tsx` (delete), `examples/e2e/jest.config.js` (delete)
**Changes**:
- [ ] `git rm jest.config.js jest-setup.ts packages/core/web-reporter-ui/mockApexChart.tsx examples/e2e/jest.config.js`.
- [ ] Create `bunfig.toml`:
  ```toml
  [test]
  coverageSkipTestFiles = true
  coveragePathIgnorePatterns = ["**/node_modules/**", "**/dist/**", "**/cpp-profiler/**", "**/__tests__/**", "test-setup/**"]
  ```
- [ ] Create `test-setup/node.ts` (replaces `jest-setup.ts`; the TextEncoder polyfill is unnecessary under bun/happy-dom):
  ```ts
  import { jest } from "bun:test";

  process.env.AWS_ACCESS_KEY_ID = "MOCK_AWS_ACCESS_KEY_ID";
  process.env.AWS_SECRET_ACCESS_KEY = "MOCK_AWS_SECRET_ACCESS_KEY";

  // Deterministic theme (packages/core/web-reporter-ui/src/theme/colors.ts picks a palette with Math.random)
  Math.random = jest.fn(() => 0.5);
  ```
- [ ] Create `test-setup/dom.tsx` (replaces the jsdom environment + `mockApexChart.tsx`; `GlobalRegistrator.register()` must run before anything touches `document`, and `@testing-library/react` must be imported lazily because its `screen` binds to `document.body` at import time):
  ```tsx
  import { GlobalRegistrator } from "@happy-dom/global-registrator";
  import { afterEach, jest, mock } from "bun:test";
  import React from "react";
  import type { ApexOptions } from "apexcharts";
  import "./node";

  GlobalRegistrator.register();

  // See https://github.com/apexcharts/react-apexcharts/issues/52
  mock.module("react-apexcharts", () => {
    const ApexChart = (
      { series, options }: { options: ApexOptions; series: ApexOptions["series"] },
      ref: React.Ref<HTMLDivElement>
    ) => (
      <div className="ApexChartsMock" ref={ref}>
        {JSON.stringify(options, null, 2)}
        {JSON.stringify(series, null, 2)}
      </div>
    );
    return { default: React.forwardRef(ApexChart) };
  });
  mock.module("apexcharts", () => ({ default: { exec: jest.fn() }, exec: jest.fn() }));

  afterEach(async () => {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
  });
  ```

#### 3. TypeScript config
**Files**: `tsconfig.json`, `tsconfig.module.json`
**Changes**:
- [ ] `tsconfig.json` (root) `compilerOptions`: add `"useDefineForClassFields": false` (bun reads this file for `bun test` run from the root; it makes bun assign constructor parameter properties before field initializers, matching tsc's ES6 output — required by `PerformanceMeasurer.ts:27` and `SingleIterationTester.ts:39-48`).
- [ ] `tsconfig.module.json` `compilerOptions`: add `"isolatedModules": true` and `"useDefineForClassFields": false`.
- [ ] Fix the 8 statements `tsc --isolatedModules` reports (TS1205, "Re-exporting a type … requires using 'export type'"):
  - `packages/commands/test/src/index.ts:1` `export { TestCase, measurePerformance } from "./measurePerformance";` → `export type { TestCase } from "./measurePerformance";` + `export { measurePerformance } from "./measurePerformance";`
  - `packages/commands/test/src/measurePerformance.ts:4` `export { TestCase };` → `export type { TestCase };`
  - `packages/core/web-reporter-ui/index.tsx:2` → `export type { MenuOption } from "./src/components/Header";`; `:7` → `export type { ApexOptions } from "apexcharts";`
  - `packages/platforms/android/src/index.ts:1` → `export type { Measure } from "@perf-profiler/types";`; `:2` → `export type { Measure as GfxInfoMeasure } from "./commands/gfxInfo/parseGfxInfo";`
  - `packages/platforms/ios-instruments/src/utils/xmlTypes.ts:68-79`: split the block into `export type { Result, Row, refField, Thread, Process, StringField, NumberField, Backtrace, TextAddresses };` and `export { isRefField };` (trust `tsc` if it disagrees about any name).
  - `packages/plugins/appium-helper/index.ts:2` → `export type { RemoteServerOptions } from "./AppiumDriver";`

#### 4. File renames (bun only discovers `.test.`/`.spec.` names)
**Changes** (use `git mv`):
- [ ] `packages/commands/test/src/__tests__/writeResults.ts` → `writeResults.test.ts`
- [ ] `packages/platforms/android/src/commands/atrace/__tests__/pollFpsUsage.ts` → `pollFpsUsage.test.ts`
- [ ] `packages/platforms/android/src/commands/gfxInfo/__tests__/GfxInfoParser.ts` → `GfxInfoParser.test.ts`
- [ ] `packages/plugins/aws-device-farm/src/__tests__/createTestSpecFile.ts` → `createTestSpecFile.test.ts` **and** `packages/plugins/aws-device-farm/src/__tests__/__snapshots__/createTestSpecFile.ts.snap` → `createTestSpecFile.test.ts.snap`
- [ ] `packages/plugins/aws-device-farm/src/commands/__tests__/checkResults.ts` → `checkResults.test.ts`
- [ ] `packages/commands/measure/src/__tests__/utils/removeCLIColors.ts` stays (helper, not a test).

#### 5. Test-file conversions
General rules for every file under `__tests__/`, `utils/test/`, `test-setup/` and `examples/e2e/*.test.ts`:
- Import every runner symbol used from `"bun:test"` (`describe`, `it`, `test`, `expect`, `beforeAll`, `afterAll`, `beforeEach`, `afterEach`, `jest`, `spyOn`, `mock`, `setDefaultTimeout`, `setSystemTime`). No file may rely on globals.
- `jest.fn()` stays (`jest` imported). `jest.spyOn(obj, "m")` → `spyOn(obj, "m")`.
- Same-package source under test: `import * as ns from "<relative module>"; spyOn(ns, "fn")`. Code reached via another package's `dist/`: `spyOn(require("<module>") as typeof import("<module>"), "fn")`. Methods on exported objects: `spyOn(object, "method")`.
- Files that create spies at module level or in `beforeAll` and that do **not** import `mockChildProcess`/`mockEmitMeasures` end with `afterAll(() => mock.restore());` (bun shares one process across files). Files importing those two helpers must **not** call `mock.restore()` (it would strip the helpers' module-level spies, and each helper is imported by exactly one file per group).
- Use targeted casts (`as unknown as typeof childProcess.spawn`, `as never`) where bun's stricter `Mock<T>` typings reject an implementation; `tsc --build` type-checks every test file.

Per file:
- [ ] `packages/commands/test/src/utils/test/mockChildProcess.ts` (consumer is `@perf-profiler/android` **dist** via `@perf-profiler/profiler`): replace the `jest.mock("child_process", …)` factory by
  ```ts
  import * as childProcess from "child_process";
  import { spyOn } from "bun:test";

  const execSync = ((command: string) => ({
    toString: () => { /* unchanged switch on `command` */ },
  })) as unknown as typeof childProcess.execSync;

  spyOn(require("child_process") as typeof childProcess, "execSync").mockImplementation(execSync);
  ```
  (`spawn` stays real — the old factory re-exported the actual `spawn`.)
- [ ] `packages/commands/test/src/utils/test/mockEmitMeasures.ts`: `import * as childProcess from "child_process"; import { expect, jest, spyOn } from "bun:test";`; `mockProcess.kill = jest.fn()` stays; replace `jest.spyOn(require("child_process"), "spawn")` by `spyOn(require("child_process") as typeof childProcess, "spawn")` and cast each `.mockImplementationOnce((...args) => {…})` callback `as unknown as typeof childProcess.spawn` (assert on `[command, args]` explicitly: `(command: string, args: readonly string[]) => { expect([command, args]).toEqual([...]); return aTraceMock; }`).
- [ ] `packages/commands/test/src/utils/test/PerformancePollingMock.ts`: `import { mock } from "bun:test"; import { Measure } from "@perf-profiler/types";` — type `cb`/`emit`/`setCallback` with `(measure: Measure) => void` and `setCallback = mock((cb: (measure: Measure) => void) => { this.cb = cb; });`.
- [ ] `packages/commands/test/src/__tests__/PerformanceMeasurer.test.ts`: add `import { describe, it, expect, jest, spyOn } from "bun:test";`; `jest.spyOn(Logger, …)` → `spyOn(Logger, …)`. No `mock.restore()` (imports the helpers).
- [ ] `packages/commands/test/src/__tests__/measurePerformance.test.ts`: replace lines 1-40 with
  ```ts
  import os from "os";
  import fs from "fs";
  import * as perfHooks from "perf_hooks";
  import { describe, it, expect, jest, spyOn, mock, afterAll, setDefaultTimeout } from "bun:test";
  import { measurePerformance } from "..";
  import { PerformancePollingMock } from "../utils/test/PerformancePollingMock";
  import { Logger, LogLevel } from "@perf-profiler/logger";
  import { profiler } from "@perf-profiler/profiler";

  const mockPerformancePolling = new PerformancePollingMock();

  spyOn(profiler, "installProfilerOnDevice").mockImplementation(() => undefined);
  spyOn(profiler, "pollPerformanceMeasures").mockImplementation((pid, { onMeasure, onStartMeasuring }) => {
    mockPerformancePolling.setCallback(onMeasure);
    onStartMeasuring?.();
    return { stop: () => undefined };
  });

  Logger.setLogLevel(LogLevel.SILENT);
  setDefaultTimeout(10000);

  // Mock test time to be always 1000ms
  let isStart = false;
  spyOn(perfHooks.performance, "now").mockImplementation(() => {
    isStart = !isStart;
    return isStart ? 0 : 1000;
  });

  afterAll(() => mock.restore());
  ```
  (the old `getPidId` mock targeted a method that exists on neither `Profiler` nor `AndroidProfiler` — dropped). Keep the rest of the file; `jest.fn()` for `runTest` stays.
- [ ] `packages/commands/test/src/__tests__/writeResults.test.ts`: imports from `bun:test` (`describe, it, expect, jest, spyOn, mock, beforeAll, afterAll, afterEach, setSystemTime`); replace the `jest.mock("@perf-profiler/profiler", …)` factory with `import { profiler } from "@perf-profiler/profiler"; spyOn(profiler, "installProfilerOnDevice").mockImplementation(() => undefined);`; `mockDate` → `setSystemTime(new Date(1686650793058));`; `mockPerformanceTester` → `spyOn(PerformanceTester.PerformanceTester.prototype, "iterate").mockResolvedValue(undefined);` (no `requireActual`, no constructor spy); keep `const writeReportSpy = spyOn(writeReport, "writeReport");` (namespace import of same-package source); add `afterAll(() => { setSystemTime(); mock.restore(); });`. `it.each` stays.
- [ ] `packages/plugins/aws-device-farm/src/commands/__tests__/checkResults.test.ts`: imports from `bun:test`; replace `jest.mock("axios", () => ({ get: jest.fn() }))` by `spyOn(axios, "get")` calls inside the test (already `mockResolvedValueOnce` there — keep, but drop the module factory); `jest.spyOn(testRepository, …)` → `spyOn(testRepository, …)`; add `afterAll(() => mock.restore())`.
- [ ] `packages/plugins/aws-device-farm/src/__tests__/createTestSpecFile.test.ts`, `packages/core/reporter/src/reporting/__tests__/averageIterations.test.ts`, `packages/commands/report/__tests__/writeReport.test.ts`, `packages/platforms/android/src/commands/__tests__/cppProfiler.test.ts`, `packages/platforms/android/src/commands/cpu/__tests__/getCpuStatsByProcess.test.ts`, `packages/platforms/android/src/commands/atrace/__tests__/pollFpsUsage.test.ts`: add the `bun:test` import only.
- [ ] `packages/platforms/android/src/commands/__tests__/detectCurrentAppBundleId.test.ts` and `detectCurrentDeviceRefreshRate.test.ts`: `import * as shell from "../shell"; const executeCommandSpy = spyOn(shell, "executeCommand");` (replaces `jest.spyOn(require("../shell"), …)`); `afterAll(() => mock.restore())`.
- [ ] `packages/platforms/android/src/commands/gfxInfo/__tests__/GfxInfoParser.test.ts`: `import fs from "fs"; import * as shell from "../../shell"; spyOn(shell, "executeCommand").mockImplementation(() => fs.readFileSync(`${__dirname}/GfxInfoSample.txt`, "utf8"));` + `afterAll(() => mock.restore())`.
- [ ] `packages/platforms/android/src/commands/__tests__/shell.test.ts`: `import * as childProcess from "child_process";` and `spyOn(childProcess, "spawn").mockImplementationOnce((… ) as unknown as typeof childProcess.spawn)` (same-package source consumer — verified); `afterAll(() => mock.restore())`.
- [ ] `packages/core/web-reporter-ui/utils/testUtils.ts`: `import { expect } from "bun:test";` and `expect(wrapper.baseElement.innerHTML).toMatchSnapshot(`${name} - 2. FULL`);` (fragment snapshots hang bun's serializer).
- [ ] `packages/core/web-reporter-ui/__tests__/ReporterView.test.tsx`: `bun:test` imports; the three `expect(asFragment()).toMatchSnapshot()` (lines 22, 39, 57) → `expect(baseElement.innerHTML).toMatchSnapshot()`; drop `asFragment` from the destructurings.
- [ ] `packages/commands/measure/src/__tests__/measure.test.tsx`: add `import * as shell from "@perf-profiler/shell";` and `import { describe, test, expect, beforeAll, afterAll, jest, spyOn } from "bun:test";`; replace `jest.mock("@perf-profiler/shell", () => ({ open: jest.fn() }));` by `spyOn(shell, "open").mockImplementation(() => undefined);` (verified: passes with inline snapshots unchanged). No `mock.restore()`.
- [ ] `packages/commands/measure/src/__tests__/server/ServerApp.test.ts`: `bun:test` imports; delete the `jest.mock("fs", …)` factory; in `beforeEach`: `spyOn(fs.promises, "readFile").mockResolvedValue(`<html>…</html>` as never);` (drop the `as jest.Mock` cast); `spyOn(express, "static")…` in `beforeAll`; the last test reads the placeholder file with `fs.readFileSync(`${__dirname}/../../webapp/index.html`, "utf8")` instead of `jest.requireActual`; `afterAll(() => mock.restore())`.
- [ ] `packages/commands/measure/src/__tests__/webapp/socket.test.ts`: 
  ```ts
  import * as actualSocketIoClient from "socket.io-client";
  import { describe, it, expect, beforeAll, afterAll, jest, mock } from "bun:test";

  const ioMock = jest.fn(() => ({ on: jest.fn(), close: jest.fn() }));
  mock.module("socket.io-client", () => ({ ...actualSocketIoClient, io: ioMock }));
  ```
  keep the window setup; `expect(ioMock).toHaveBeenCalledWith("http://localhost:9999")`; in `afterAll` also `mock.module("socket.io-client", () => actualSocketIoClient);`.
- [ ] `examples/e2e/appium.test.ts`: add `import { test } from "bun:test";` (it uses `test.skip`). `examples/e2e/appium-ci.test.ts` needs nothing.

#### 6. Snapshots
- [ ] Run `bun run test:unit:node` — must pass **without** `--update-snapshots` (`createTestSpecFile.test.ts.snap`, `PerformanceMeasurer.test.ts.snap` are Jest-format and read as-is).
- [ ] Run `bun run test:unit:dom --update-snapshots` once (needed because the FULL snapshots change from fragment serialization to `innerHTML`). Then diff `packages/core/web-reporter-ui/__tests__/__snapshots__/ReporterView.test.tsx.snap` and `packages/commands/measure/src/__tests__/__snapshots__/measure.test.tsx.snap` against `git show HEAD:<path>`: every `… - 1. TEXT` / `getText` snapshot body must be identical (only the header line and the `FULL` bodies change). If a TEXT body differs, the DOM setup is wrong — fix it rather than accepting the snapshot.
- [ ] Run `bun run test:unit:dom` again without `-u` — green.

#### 7. Docs
**File**: `CONTRIBUTING.md`
**Changes**:
- [ ] Line "Run `bunx jest Plugin -u` after modifications." → "Run `bun run test:unit:dom --update-snapshots` after modifications." Add a `## Tests` section: `bun run test:unit` (both groups), `bun run test:unit:node` / `bun run test:unit:dom`, that test files must import from `bun:test`, and the two mocking rules (namespace `spyOn` for same-package source, `spyOn(require(...))` for code behind another package's `dist`).

#### 8. Lint/format
- [ ] `bun run format && bun run lint` (the `test-setup/**` and `utils/test/**` overrides allow `require`).

### Success Criteria

#### Automated Verification:
- [ ] `bun run build` exits 0 (tsc with `isolatedModules`, `@types/bun`, no `@types/jest`).
- [ ] `bun run test:unit` exits 0; the node run reports `0 fail` across 14 files and the two DOM runs `0 fail` across 3 + 1 files (18 files total).
- [ ] `bun run test` exits 0 (full pipeline, no Jest).
- [ ] `grep -c 'jest\|ts-jest' package.json` → `0` (no Jest packages); `git ls-files | grep -E 'jest.config|jest-setup|mockApexChart' | wc -l` → `0`; `git ls-files | grep -E '__tests__/.*\.(ts|tsx)$' | grep -v -e '\.test\.' -e 'removeCLIColors' | wc -l` → `0`.
- [ ] `grep -rln 'jest.mock(\|jest.requireActual\|jest.setTimeout' packages examples --include='*.ts' --include='*.tsx' | wc -l` → `0`.
- [ ] For each `.snap` under `packages/`: `grep -c '1. TEXT' <snap>` unchanged vs `HEAD`, and `diff <(git show HEAD:<snap> | sed -n '/1. TEXT/,/^`;$/p') <(sed -n '/1. TEXT/,/^`;$/p' <snap>)` is empty for the two DOM snapshot files.
- [ ] `bun run lint && bun run format:check` exit 0.

#### Manual Verification:
- [ ] `bun run test:coverage` prints a coverage table for source files only (no `__tests__`, `dist`, `cpp-profiler` rows).
- [ ] Deliberately break an assertion in `packages/core/reporter/src/reporting/__tests__/averageIterations.test.ts`, confirm `bun run test:unit:node` fails, revert.

---

## Phase 5: Standalone macOS `flashlight` executable with `bun build --compile`

### Overview
Add a private `@perf-profiler/flashlight` workspace that registers the `measure`, `test`, `tools`, `report` commands on one commander program (each command package gains a `register<Name>Command(program)` export; their bins become thin wrappers), make the three `__dirname`-based asset lookups overridable via env vars, and add `scripts/build-standalone.ts` which generates an embedded-asset manifest (4 cpp-profiler binaries + both Parcel outputs), runs `bun build --compile --format=cjs --asset-naming="[dir]/[name].[ext]"`, and re-signs the result. Last, because it depends on the bun build, lint and test pipeline being final.

### Recommended model
`opus` — cross-package refactor (4 CLI entry points), a generated module, runtime asset materialization and a compiled-binary runtime whose behaviour differs from Node in verified but subtle ways.

### Effort
high — the verification is a real compiled binary that must run `--help` and `report`; every design constraint (CJS format, asset naming, no `copyFileSync`, env overrides) is a hard requirement.

### Depends on prior phases
- Root `bun run build` = `rm -rf .parcel-cache && bun run clean-dist && tsc --build && bun run --filter @perf-profiler/web-reporter build && bun run --filter @perf-profiler/measure build`, producing `packages/commands/report/dist/{index.html,index.<hash>.js}` and `packages/commands/measure/dist/{index.html,index.<hash>.js}` (Phase 1).
- All 8 bins start with `#!/usr/bin/env bun` (Phase 1); `bun run test` = `oxfmt --check && bun run build && oxlint --max-warnings 0 && bun run test:unit` and passes (Phase 4).
- `.gitignore` contains `/build/`; `.oxlintrc.json`/`.oxfmtrc.json` `ignorePatterns` contain `build` (Phase 2).
- `packages/commands/measure/src/server/bin.tsx` registers `measure` (lines 6-21) then `program.parse()`; `packages/commands/test/src/bin.ts` registers `test` (lines 11-79) with a module-level `runTest` (lines 81-162) then `program.parse()` (line 164); `packages/commands/tools/src/bin.ts` registers `tools` with two subcommands; `packages/commands/report/openReport.ts` registers `report` (lines 9-43) then `program.parse()`.
- `UnixProfiler.ts:25-27` defines `defaultBinaryFolder`/`binaryFolder`; `ServerApp.tsx:16` defines `pathToDist`; `writeReport.ts:84,88,97` read `${__dirname}/index.html` and `${__dirname}/${scriptName}`.

### Changes Required

#### 1. Command registrars (one per command package)
**Files**: `packages/commands/measure/src/server/command.ts` (new), `packages/commands/measure/src/server/bin.tsx`; `packages/commands/test/src/command.ts` (new), `packages/commands/test/src/bin.ts`, `packages/commands/test/src/index.ts`; `packages/commands/tools/src/command.ts` (new), `packages/commands/tools/src/bin.ts`; `packages/commands/report/command.ts` (new), `packages/commands/report/openReport.ts`
**Changes**:
- [ ] `measure/src/server/command.ts`: `import { Command } from "commander"; import { DEFAULT_PORT } from "./constants"; export const registerMeasureCommand = (program: Command) => { program.command("measure") … .action(async (options) => { … }); };` — body moved verbatim from `bin.tsx` lines 6-21 (keep the lazy `await import("./ServerApp")`).
- [ ] `measure/src/server/bin.tsx` becomes:
  ```ts
  #!/usr/bin/env bun

  import { program } from "commander";
  import { registerMeasureCommand } from "./command";

  registerMeasureCommand(program);
  program.parse();
  ```
- [ ] `test/src/command.ts`: move `bin.ts` lines 3-162 (imports, the `program.command("test")…` chain wrapped as `export const registerTestCommand = (program: Command) => { program.command("test") … .action(async (options) => { await runTest(options); }); };`, and the module-level `const runTest = async (…) => {…}` unchanged). `bin.ts` becomes the 6-line wrapper above with `registerTestCommand`. Add `export { registerTestCommand } from "./command";` to `test/src/index.ts`.
- [ ] `tools/src/command.ts`: `export const registerToolsCommand = (program: Command) => { const toolsCommand = program.command("tools")…; toolsCommand.command("android_get_bundle_id")…; toolsCommand.command("video_fix_metadata <videoFilePath>")…; };` (moved from `bin.ts` lines 8-26); `bin.ts` → wrapper.
- [ ] `report/command.ts` (package root, picked up by the report tsconfig `"*.ts"` include): `export const registerReportCommand = (program: Command) => { program.command("report") … };` moved from `openReport.ts` lines 9-43 (imports `os`, `Logger`, `open`, `writeReport`); `openReport.ts` → wrapper with `registerReportCommand`.
- [ ] Every registrar takes `program: Command` (type from `commander`) — never the `program` singleton — so the aggregator owns the single program instance.

#### 2. Env-overridable, lazily evaluated asset lookups
**Files**: `packages/platforms/android/src/commands/platforms/UnixProfiler.ts`, `packages/commands/measure/src/server/ServerApp.tsx`, `packages/commands/report/writeReport.ts`
**Changes**:
- [ ] `UnixProfiler.ts` lines 25-27: keep `defaultBinaryFolder`; replace `const binaryFolder = process.env.FLASHLIGHT_BINARY_PATH || defaultBinaryFolder;` with `const getBinaryFolder = () => process.env.FLASHLIGHT_BINARY_PATH || defaultBinaryFolder;` and in `installCppProfilerOnDevice()` (line 91) use `${getBinaryFolder()}/${CppProfilerName}-${abi}`. Line 94-95: replace `fs.copyFileSync(binaryPath, binaryTmpPath);` with `fs.writeFileSync(binaryTmpPath, fs.readFileSync(binaryPath));` and update the comment to `// Copy to a real file first: when running from the standalone executable the source may be an embedded (virtual) path`.
- [ ] `ServerApp.tsx` line 16: `const pathToDist = path.join(__dirname, "../../dist");` → `const getPathToDist = () => process.env.FLASHLIGHT_WEBAPP_PATH || path.join(__dirname, "../../dist");` and use `getPathToDist()` at lines 24 (`path.join(getPathToDist(), "index.html")`) and 35 (`express.static(getPathToDist())`).
- [ ] `writeReport.ts`: add `const getAssetsDir = () => process.env.FLASHLIGHT_REPORT_ASSETS_PATH || __dirname;` above `writeReport` and use `${getAssetsDir()}/index.html` (lines 84, 88) and `${getAssetsDir()}/${scriptName}` (line 97).

#### 3. The aggregator workspace
**Files**: `packages/commands/flashlight/package.json`, `packages/commands/flashlight/tsconfig.json`, `packages/commands/flashlight/src/cli.ts`, `packages/commands/flashlight/src/bin.ts`, `packages/commands/flashlight/src/standalone.ts` (all new); `tsconfig.json` (root); `.gitignore`
**Changes**:
- [ ] `package.json`:
  ```json
  {
    "name": "@perf-profiler/flashlight",
    "private": true,
    "version": "0.18.0",
    "license": "MIT",
    "bin": { "flashlight": "dist/bin.js" },
    "dependencies": {
      "@perf-profiler/e2e": "^0.11.4",
      "@perf-profiler/measure": "^0.5.0",
      "@perf-profiler/tools": "^0.2.4",
      "@perf-profiler/web-reporter": "^0.11.3",
      "commander": "^12.0.0"
    }
  }
  ```
  then `bun install` (updates `bun.lock`; the workspace links resolve locally).
- [ ] `tsconfig.json`: extends `../../../tsconfig.module.json`, `rootDir: "src"`, `outDir: "./dist"`, `include: ["src"]`, `exclude: ["src/standalone.ts", "src/embedded.generated.ts"]` (those two use `import … with { type: "file" }`, which tsc rejects under `module: CommonJS`; bun bundles them directly).
- [ ] Root `tsconfig.json` `references`: add `{ "path": "./packages/commands/flashlight" }` after the `measure` entry.
- [ ] `src/cli.ts`:
  ```ts
  import { Command } from "commander";
  import { registerMeasureCommand } from "@perf-profiler/measure/dist/server/command";
  import { registerTestCommand } from "@perf-profiler/e2e";
  import { registerToolsCommand } from "@perf-profiler/tools/dist/command";
  import { registerReportCommand } from "@perf-profiler/web-reporter/dist/command";
  import { version } from "../package.json";

  export const createProgram = () => {
    const program = new Command("flashlight").version(version);
    registerMeasureCommand(program);
    registerTestCommand(program);
    registerToolsCommand(program);
    registerReportCommand(program);
    return program;
  };
  ```
- [ ] `src/bin.ts` (dev entry, runs from the repo with the default `__dirname` lookups): `#!/usr/bin/env bun` + `import { createProgram } from "./cli"; createProgram().parse();`
- [ ] `src/standalone.ts` (compile entry; no top-level `await` — the bundle is CJS):
  ```ts
  import fs from "fs";
  import os from "os";
  import path from "path";
  import { EMBEDDED_ASSETS } from "./embedded.generated";
  import { version } from "../package.json";
  import { createProgram } from "./cli";

  // Embedded files live on bun's virtual filesystem; materialize them once per version so the
  // existing folder-based lookups (and `adb push`) see real paths.
  const assetsRoot = path.join(os.tmpdir(), `flashlight-${version}-assets`);
  for (const asset of EMBEDDED_ASSETS) {
    const dir = path.join(assetsRoot, asset.group);
    fs.mkdirSync(dir, { recursive: true });
    const destination = path.join(dir, asset.name);
    const source = fs.statSync(asset.path);
    if (!fs.existsSync(destination) || fs.statSync(destination).size !== source.size) {
      fs.writeFileSync(destination, fs.readFileSync(asset.path)); // copyFileSync cannot read /$bunfs paths
    }
  }
  process.env.FLASHLIGHT_BINARY_PATH ??= path.join(assetsRoot, "cpp-profiler");
  process.env.FLASHLIGHT_REPORT_ASSETS_PATH ??= path.join(assetsRoot, "report");
  process.env.FLASHLIGHT_WEBAPP_PATH ??= path.join(assetsRoot, "webapp");

  createProgram().parse();
  ```
- [ ] `.gitignore`: add `packages/commands/flashlight/src/embedded.generated.ts`. Add the same path to `ignorePatterns` in `.oxlintrc.json` and `.oxfmtrc.json` (as `**/embedded.generated.ts`).
- [ ] Root `package.json` scripts: add `"flashlight": "bun packages/commands/flashlight/dist/bin.js"` and `"build:standalone": "bun scripts/build-standalone.ts"`.

#### 4. The build script
**File**: `scripts/build-standalone.ts` (new)
**Changes**:
- [ ] Implement with `Bun.spawnSync`/`Bun.$` (no extra dependencies). CLI: `--target <bun-darwin-arm64|bun-darwin-x64>` (default `bun-darwin-arm64`), `--sign <identity>` (default `-`, i.e. ad-hoc; env `FLASHLIGHT_CODESIGN_IDENTITY` also honoured), `--skip-build`, `--outfile <path>` (default `build/standalone/flashlight-macos-<arm64|x64>`). Steps:
  1. Unless `--skip-build`: run `bun run build` at the repo root and fail on non-zero exit.
  2. Collect assets → `{ group, name, sourcePath }`: `group: "cpp-profiler"` = every file in `packages/platforms/android/cpp-profiler/bin/` (expect 4 `BAMPerfProfiler-*`); `group: "report"` = files directly in `packages/commands/report/dist/` (top level only, no recursion into `src/`) whose name ends in `.html`, `.js` or `.css` — never `.map`, `.d.ts`, `.tsbuildinfo` or the tsc outputs `openReport.js`/`writeReport.js` (exclude by name); `group: "webapp"` = same for `packages/commands/measure/dist/` (its top level holds only Parcel output today). The glob is deliberately bundler-agnostic so a later Parcel → `bun build` swap (which may add a `.css` file) needs no change here. Fail if any group is empty or if `report`/`webapp` lack an `index.html`.
  3. Write `packages/commands/flashlight/src/embedded.generated.ts`: a header comment `// GENERATED by scripts/build-standalone.ts — do not edit or commit`, one `import assetN from "<path relative to packages/commands/flashlight/src>" with { type: "file" };` per file, and `export const EMBEDDED_ASSETS: { group: "cpp-profiler" | "report" | "webapp"; name: string; path: string }[] = [ … ];` with `name` = basename.
  4. Run `bun build --compile --format=cjs --target=<target> --asset-naming="[dir]/[name].[ext]" packages/commands/flashlight/src/standalone.ts --outfile <outfile>` (`--format=cjs` is mandatory: the ESM bundle of ink's `yoga-layout-prebuilt` throws `ReferenceError: _a is not defined` at startup; `[dir]` naming prevents the two `index.html` from colliding).
  5. Run `codesign --sign <identity> --force <outfile>` then `codesign --verify --verbose <outfile>`; fail if either fails (bun 1.4.0 writes an invalid ad-hoc signature that macOS SIGKILLs).
  6. Print the output path, size in MB, and the `file` description.

#### 5. Docs
**File**: `CONTRIBUTING.md`
**Changes**:
- [ ] Add `## Building the standalone macOS binary`: `bun run build:standalone` (arm64, ad-hoc signed — fine for local use), `bun run build:standalone --sign "Developer ID Application: …"` for distribution, `--target bun-darwin-x64` for Intel (cross-compiled; cannot run on this Mac), output in `build/standalone/`; note that the binary embeds the cpp-profiler binaries and both web apps and extracts them to `$TMPDIR/flashlight-<version>-assets` on first run; note the dev alternative `bun run flashlight -- <command>`.

#### 6. Lint/format
- [ ] `bun run format && bun run lint`.

### Success Criteria

#### Automated Verification:
- [ ] `bun run test` exits 0 (build incl. the new workspace, lint, format, unit tests).
- [ ] `bun run flashlight -- --help` lists `measure`, `test`, `tools`, `report`; `bun run flashlight -- --version` prints `0.18.0`; `bun packages/commands/measure/dist/server/bin.js --help` and `bun packages/commands/report/dist/openReport.js --help` still work (thin bins).
- [ ] `bun run build:standalone` exits 0; `file build/standalone/flashlight-macos-arm64` contains `Mach-O 64-bit executable arm64`; `codesign --verify --verbose build/standalone/flashlight-macos-arm64` reports `valid on disk`; size is between 60 and 120 MB.
- [ ] `./build/standalone/flashlight-macos-arm64 --help` lists the four commands and exits 0; `./build/standalone/flashlight-macos-arm64 --version` prints `0.18.0`.
- [ ] `rm -rf /tmp/flashlight-report-smoke && ./build/standalone/flashlight-macos-arm64 report packages/commands/report/src/example-reports/results1.json -o /tmp/flashlight-report-smoke` exits 0 (it opens the report in the browser), and `ls /tmp/flashlight-report-smoke` shows `report.html` and `report.js`; `ls "$TMPDIR/flashlight-0.18.0-assets/cpp-profiler"` lists the 4 `BAMPerfProfiler-*` files with sizes equal to those in `packages/platforms/android/cpp-profiler/bin/`.
- [ ] `git status --porcelain | grep -E 'embedded.generated|build/' | wc -l` → `0` (generated artefacts are ignored).
- [ ] `git ls-files | grep -c '#!/usr/bin/env node'` → `0` and `grep -L '#!/usr/bin/env bun' packages/commands/*/src/bin.ts packages/commands/measure/src/server/bin.tsx packages/commands/report/openReport.ts packages/commands/flashlight/src/bin.ts` prints nothing.

#### Manual Verification:
- [ ] With an Android device connected: `./build/standalone/flashlight-macos-arm64 measure` starts the ink UI, opens the web app on port 3000 served from `$TMPDIR/flashlight-0.18.0-assets/webapp`, "Auto-Detect" finds the foreground app and measures stream (this exercises the embedded cpp-profiler push).
- [ ] `./build/standalone/flashlight-macos-arm64 test --bundleId <app> --testCommand "sleep 5" --iterationCount 1` writes a results JSON, and `report` on it opens correctly.
- [ ] Activity Monitor shows the process as "Apple" architecture (no Rosetta).
- [ ] (Optional) `bun run build:standalone --target bun-darwin-x64` produces `build/standalone/flashlight-macos-x64` (`file` → `x86_64`); running it here fails with `bad CPU type` as expected.

---

## Testing Strategy

### Unit Tests
- Runner: `bun test` in two preload groups (Phase 4). Files: 14 node (`packages/platforms/android`, `packages/plugins/aws-device-farm`, `packages/commands/test`, `packages/core/reporter`, `packages/commands/report`) + 4 DOM (`packages/core/web-reporter-ui`, `packages/commands/measure`).
- What must keep passing unchanged: all `toMatchInlineSnapshot` bodies, all `… - 1. TEXT` snapshot bodies, `PerformanceMeasurer.test.ts.snap`, `createTestSpecFile.test.ts.snap`.
- Key edge cases: module-cache leakage between files (`mock.restore()` discipline, separate invocation for `socket.test.ts`); class-field order (`useDefineForClassFields`); type-only re-exports (`isolatedModules`).

### Integration Tests
- Phase 1/2/3: the unchanged Jest suite under bun-managed `node_modules` is the integration check for the package-manager and lint/format swaps.
- Phase 5: the compiled binary's `--help` and `report` runs (embedded assets materialized) are the integration check; `measure`/`test` against a device are manual.

### Manual Testing Steps
1. After Phase 1: push the branch, watch the `Tests` workflow on `macos-latest`.
2. After Phase 4: `bun run test:coverage` and skim the table.
3. After Phase 5: run `measure` against a real Android device from the standalone binary; verify no Rosetta prompt / Intel process.

## Performance Considerations
- `bun install` (~30 s cold) and `bun test` (whole suite ≈ 15 s, dominated by the 11 s `measurePerformance` "waits for a certain duration" test) replace Yarn + Jest; oxlint/oxfmt run in ~150 ms over the repo.
- The standalone binary is ~70 MB of bun runtime + ~10 MB of assets (vs. 112 MB for the old pkg bundle). Assets are extracted to `$TMPDIR` once per version (size-checked), not on every launch.

## Migration Notes
- Contributors need Bun ≥ 1.4.0 (`.bun-version`); Node is no longer required for development, but `npx ts-node` inside `test:e2e` still runs on AWS Device Farm hosts.
- npm consumers of `@perf-profiler/*` bins now need Bun on `PATH` (shebang change) — accepted by the user; nothing is published in this plan.
- Existing Jest-format `.snap` files remain readable by bun; they are rewritten in Bun format only when `--update-snapshots` is used (Phase 4 does this for the two DOM files).

## Rollback Strategy
Each phase is one commit on `chore/modernize-tooling`; `git revert <sha>` restores the previous state (Phase 1's revert restores `yarn.lock`, `website/`, `lerna.json`). After Phase 1, `bun install` must be re-run after any revert that changes `package.json`. No data or external state is touched except `$TMPDIR/flashlight-*-assets` and `/tmp/ffmpeg-binary`, both safe to delete.

## References
- Research: `tasks/2026-08-27-modernize-tooling/research.md` (commit `96a9504` at time of planning), incl. Follow-ups 1-2 and the parked `later-rust-profiler-prompt.md`.
- Upstream: bun issue #39764 (1.4.0 compile signature regression, fixed after 1.4.0 — the plan re-signs regardless); `eugeneware/ffmpeg-static` release `b6.1.1`; `oven-sh/setup-bun@v2` README (`bun-version-file`).

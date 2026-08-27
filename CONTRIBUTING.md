# Contributing

## Commit naming

We use [conventional changelogs](https://www.conventionalcommits.org/en/v1.0.0-beta.4/#summary) for commits and PR names

It should be like:

```
<type>[optional scope]: <description>

[optional body]

[optional footer]
```

- [ ] with type = feat/fix/refactor/chore/docs/test/…
- [ ] description should be lowercase and start with a verb

Here are some examples https://www.conventionalcommits.org/en/v1.0.0-beta.4/#examples

## Linting and formatting

We use [oxlint](https://oxc.rs/docs/guide/usage/linter.html) for linting and [oxfmt](https://oxc.rs/docs/guide/usage/formatter.html) for formatting.

- `bun run lint` / `bun run lint:fix` — run oxlint (the `correctness` category plus the extra rules configured in `.oxlintrc.json`), optionally auto-fixing what it can.
- `bun run format` / `bun run format:check` — run oxfmt, which produces Prettier-compatible output, either rewriting files in place or just checking them.

For a one-off exception, disable the specific rule on the next line with `// oxlint-disable-next-line <rule>` rather than disabling a whole file.

Note that `react/refs` and `react/set-state-in-effect` are intentionally disabled in `.oxlintrc.json` — they are React-Compiler-era rules that ESLint never enforced in this codebase.

## Tests

We use [`bun test`](https://bun.com/docs/cli/test) as the test runner. Tests are split into two
groups, because the DOM group needs a `happy-dom` global registration that the node group must not
have:

- `bun run test:unit` — runs both groups.
- `bun run test:unit:node` — node-environment tests (preloads `test-setup/node.ts`).
- `bun run test:unit:dom` — DOM-environment tests (preloads `test-setup/dom.tsx`). Append
  `--update-snapshots` to refresh the snapshots.

Test files must be named `*.test.ts` / `*.test.tsx` — `bun test` only discovers those.

### No implicit globals

Unlike Jest, `bun test` does not inject globals. Every test file must explicitly import everything
it uses from `bun:test`:

```ts
import { describe, it, expect, beforeAll, afterAll, jest, spyOn, mock } from "bun:test";
```

### Mocking

Two rules cover almost every case:

- **Same-package source under test** (bun transpiles it fresh from TypeScript): spy on a namespace
  import of the module.

  ```ts
  import * as shell from "../shell";
  spyOn(shell, "executeCommand").mockImplementation(() => "output");
  ```

- **Code reached through another workspace package's compiled `dist/`** (CommonJS output): spy on
  the CommonJS module object that the `dist` code actually holds a reference to.

  ```ts
  import type * as childProcess from "child_process";
  spyOn(require("child_process") as typeof childProcess, "execSync").mockImplementation(mock);
  ```

  A namespace-import spy does _not_ work in this case — the ESM namespace and the CommonJS module
  object are different objects.

Spying on a method of an exported object (`profiler.installProfilerOnDevice`, `fs.promises.readFile`,
`Logger.debug`, …) works for every consumer regardless of import style.

Note that all files in a single `bun test` invocation share one module cache and one process, so
spies leak between files: a file that creates spies at module level should end with
`afterAll(() => mock.restore());`. `mock.module()` is _not_ undone by `mock.restore()`, so prefer
`spyOn` unless you really need to replace a whole module.

## Running `flashlight` commands locally

Start by building the whole project:

At the root of the repo:

```
bun install
bun run watch
```

Keep this open in one terminal.

### `measure` command

Start the webapp with

```bash
bun run --filter @perf-profiler/measure start
```

Then run the `measure` commmand with:

```bash
DEVELOPMENT_MODE=true bun packages/commands/measure/dist/server/bin.js measure
```

### `test` command

To run the command locally:

```
bun packages/commands/test/dist/bin.js test
```

This command is the equivalent of

```
flashlight test
```

### `tools` command

To run the command locally:

```
bun packages/commands/tools/dist/bin.js tools
```

This command is the equivalent of

```
flashlight tools
```

### web-reporter

Run in another terminal:

```
bun run --filter @perf-profiler/web-reporter start
```

Then in `packages/commands/report/src/App.tsx`, uncomment the lines to add your own measures:

```ts
// Uncomment with when locally testing
testCaseResults = [require("../measures.json")];
```

You should now be able to open [the local server](http://localhost:1234/)

Run `bun run test:unit:dom --update-snapshots` after modifications.

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

Run `bunx jest Plugin -u` after modifications.

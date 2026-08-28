#!/usr/bin/env bun

/**
 * Removes build output across the workspace: every package's `dist/` folder plus any
 * `.tsbuildinfo` file `tsc --build` left behind (inside `dist/` or next to a package's
 * `tsconfig.json`, depending on that package's `outDir`).
 *
 * Replaces the old shell one-liner that removed every package's dist folder with `rm -rf`.
 */

import { rm } from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dir, "..");

const DIST_GLOBS = ["packages/*/*/dist", "examples/*/dist"];
const TSBUILDINFO_GLOBS = ["packages/*/*/**/*.tsbuildinfo", "examples/*/**/*.tsbuildinfo"];

const scan = async (pattern: string, onlyFiles: boolean) => {
  const glob = new Bun.Glob(pattern);
  const matches: string[] = [];
  for await (const match of glob.scan({ cwd: REPO_ROOT, onlyFiles, dot: true })) {
    matches.push(match);
  }
  return matches;
};

const removeAll = async (patterns: string[], onlyFiles: boolean) => {
  const matches = new Set<string>();
  for (const pattern of patterns) {
    for (const match of await scan(pattern, onlyFiles)) {
      matches.add(match);
    }
  }

  for (const match of [...matches].sort()) {
    await rm(path.join(REPO_ROOT, match), { recursive: true, force: true });
    console.log(`removed ${match}`);
  }

  return matches.size;
};

const dirsRemoved = await removeAll(DIST_GLOBS, false);
const filesRemoved = await removeAll(TSBUILDINFO_GLOBS, true);

console.log(`\nclean: removed ${dirsRemoved} dist dir(s), ${filesRemoved} .tsbuildinfo file(s)`);

#!/usr/bin/env bun

/**
 * Builds a standalone macOS executable of the flashlight CLI.
 *
 * Usage:
 *   bun run build:standalone
 *   bun run build:standalone --target bun-darwin-x64
 *   bun run build:standalone --sign "Developer ID Application: ..."
 *   bun run build:standalone --skip-build
 */

import fs from "fs";
import path from "path";

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const FLASHLIGHT_SRC = path.join(REPO_ROOT, "packages/commands/flashlight/src");
const GENERATED_FILE = path.join(FLASHLIGHT_SRC, "embedded.generated.ts");

const VALID_TARGETS = ["bun-darwin-arm64", "bun-darwin-x64"] as const;
type Target = (typeof VALID_TARGETS)[number];

const fail = (message: string): never => {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
};

// --- Argument parsing -------------------------------------------------------

const parseArgs = () => {
  const args = process.argv.slice(2);
  let target: Target = "bun-darwin-arm64";
  let sign: string | undefined;
  let outfile: string | undefined;
  let skipBuild = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = () => {
      const value = args[++i];
      if (value === undefined) fail(`Missing value for ${arg}`);
      return value;
    };

    switch (arg) {
      case "--target": {
        const value = nextArg();
        if (!(VALID_TARGETS as readonly string[]).includes(value)) {
          fail(`Invalid --target "${value}". Expected one of: ${VALID_TARGETS.join(", ")}`);
        }
        target = value as Target;
        break;
      }
      case "--sign":
        sign = nextArg();
        break;
      case "--outfile":
        outfile = nextArg();
        break;
      case "--skip-build":
        skipBuild = true;
        break;
      default:
        fail(`Unknown argument "${arg}"`);
    }
  }

  const arch = target === "bun-darwin-x64" ? "x64" : "arm64";
  return {
    target,
    skipBuild,
    signIdentity: sign ?? process.env.FLASHLIGHT_CODESIGN_IDENTITY ?? "-",
    outfile: outfile ?? path.join(REPO_ROOT, `build/standalone/flashlight-macos-${arch}`),
  };
};

const options = parseArgs();

// --- Helpers ----------------------------------------------------------------

const run = (command: string[], errorMessage: string) => {
  console.log(`\n$ ${command.join(" ")}`);
  const result = Bun.spawnSync(command, {
    cwd: REPO_ROOT,
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (result.exitCode !== 0) fail(`${errorMessage} (exit code ${result.exitCode})`);
};

// --- Step 1: build the workspace --------------------------------------------

if (options.skipBuild) {
  console.log("⏭  Skipping `bun run build` (--skip-build)");
} else {
  run(["bun", "run", "build"], "`bun run build` failed");
}

// --- Step 2: collect assets to embed ----------------------------------------

type AssetGroup = "cpp-profiler" | "report" | "webapp";
interface Asset {
  group: AssetGroup;
  name: string;
  sourcePath: string;
}

const WEB_ASSET_EXTENSIONS = [".html", ".js", ".css"];
const EXCLUDED_EXTENSIONS = [".map", ".d.ts", ".tsbuildinfo"];
/** `tsc` emits these next to the bundler output — they are Node modules, not web assets. */
const EXCLUDED_NAMES = ["openReport.js", "writeReport.js", "command.js"];

const listFilesIn = (dir: string) => {
  if (!fs.existsSync(dir)) fail(`Expected directory does not exist: ${dir}`);
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
};

const collectWebAssets = (group: AssetGroup, dir: string): Asset[] => {
  const names = listFilesIn(dir);
  return (
    names
      .filter((name) => WEB_ASSET_EXTENSIONS.some((ext) => name.endsWith(ext)))
      .filter((name) => !EXCLUDED_EXTENSIONS.some((ext) => name.endsWith(ext)))
      .filter((name) => !EXCLUDED_NAMES.includes(name))
      // Anything `tsc` emitted has a sibling declaration file — those are never web assets.
      .filter((name) => !fs.existsSync(path.join(dir, `${name.replace(/\.js$/, "")}.d.ts`)))
      .map((name) => ({ group, name, sourcePath: path.join(dir, name) }))
  );
};

const cppProfilerDir = path.join(REPO_ROOT, "packages/platforms/android/cpp-profiler/bin");
const reportDistDir = path.join(REPO_ROOT, "packages/commands/report/dist");
const webappDistDir = path.join(REPO_ROOT, "packages/commands/measure/dist");

const assets: Asset[] = [
  ...listFilesIn(cppProfilerDir).map((name) => ({
    group: "cpp-profiler" as const,
    name,
    sourcePath: path.join(cppProfilerDir, name),
  })),
  ...collectWebAssets("report", reportDistDir),
  ...collectWebAssets("webapp", webappDistDir),
];

const assetsIn = (group: AssetGroup) => assets.filter((asset) => asset.group === group);

for (const group of ["cpp-profiler", "report", "webapp"] as const) {
  if (assetsIn(group).length === 0) {
    fail(`No assets found for group "${group}". Did \`bun run build\` succeed?`);
  }
}

for (const group of ["report", "webapp"] as const) {
  if (!assetsIn(group).some((asset) => asset.name === "index.html")) {
    fail(`Group "${group}" is missing an index.html. Did the parcel build run?`);
  }
}

console.log("\n📦 Embedding assets:");
for (const group of ["cpp-profiler", "report", "webapp"] as const) {
  console.log(
    `  ${group}: ${assetsIn(group)
      .map((asset) => asset.name)
      .join(", ")}`
  );
}

// --- Step 3: generate embedded.generated.ts ---------------------------------

const toImportSpecifier = (sourcePath: string) => {
  const relative = path.relative(FLASHLIGHT_SRC, sourcePath);
  return relative.startsWith(".") ? relative : `./${relative}`;
};

const imports = assets
  .map(
    (asset, index) =>
      `import asset${index} from "${toImportSpecifier(asset.sourcePath)}" with { type: "file" };`
  )
  .join("\n");

const entries = assets
  .map(
    (asset, index) =>
      `  { group: "${asset.group}", name: ${JSON.stringify(asset.name)}, path: asset${index} },`
  )
  .join("\n");

const generated = `// GENERATED by scripts/build-standalone.ts — do not edit or commit
${imports}

export const EMBEDDED_ASSETS: { group: "cpp-profiler" | "report" | "webapp"; name: string; path: string }[] = [
${entries}
];
`;

fs.writeFileSync(GENERATED_FILE, generated);
console.log(`\n📝 Wrote ${path.relative(REPO_ROOT, GENERATED_FILE)} (${assets.length} assets)`);

// --- Step 4: compile --------------------------------------------------------

fs.mkdirSync(path.dirname(options.outfile), { recursive: true });

run(
  [
    "bun",
    "build",
    "--compile",
    // ESM output breaks ink's yoga-layout-prebuilt (asm.js): `ReferenceError: _a is not defined`
    "--format=cjs",
    `--target=${options.target}`,
    // Without [dir], the two index.html files (report + webapp) collide into one asset
    "--asset-naming=[dir]/[name].[ext]",
    "packages/commands/flashlight/src/standalone.ts",
    "--outfile",
    options.outfile,
  ],
  "`bun build --compile` failed"
);

// --- Step 5: code signing ---------------------------------------------------

// bun 1.4.0 emits an invalid ad-hoc signature, which makes macOS SIGKILL the binary on launch.
run(
  ["codesign", "--sign", options.signIdentity, "--force", options.outfile],
  "codesign failed to sign the binary"
);
run(
  ["codesign", "--verify", "--verbose", options.outfile],
  "codesign verification of the binary failed"
);

// --- Step 6: report ---------------------------------------------------------

const sizeMb = fs.statSync(options.outfile).size / 1024 / 1024;
const fileOutput = Bun.spawnSync(["file", options.outfile]).stdout.toString().trim();

console.log(`\n✅ Built ${path.relative(REPO_ROOT, options.outfile)}`);
console.log(`   size: ${sizeMb.toFixed(1)} MB`);
console.log(`   file: ${fileOutput}`);

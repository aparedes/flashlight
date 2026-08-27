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

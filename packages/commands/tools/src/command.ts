import { Command } from "commander";
import { processVideoFile } from "@perf-profiler/shell";
import { profiler } from "@perf-profiler/profiler";
import fs from "fs";

export const registerToolsCommand = (program: Command) => {
  const toolsCommand = program.command("tools").description("Utility tools related to Flashlight");

  toolsCommand
    .command("android_get_bundle_id")
    .description("Retrieves the focused app bundle id")
    .action(() => {
      console.log(profiler.detectCurrentBundleId());
    });

  toolsCommand
    .command("video_fix_metadata <videoFilePath>")
    .description(
      "On certain devices the video recorded by the test command is not encoded properly; this re-encodes it"
    )
    .action((videoFilePath) => {
      const backupFilePath = `${videoFilePath}.bak`;
      fs.cpSync(videoFilePath, backupFilePath);
      processVideoFile(backupFilePath, videoFilePath);
    });
};

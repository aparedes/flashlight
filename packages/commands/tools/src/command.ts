import { Command } from "commander";
import { processVideoFile } from "@lantern/shell";
import { profiler } from "@lantern/profiler";
import fs from "fs";

export const registerToolsCommand = (program: Command) => {
  const toolsCommand = program.command("tools").description("Utility tools related to Lantern");

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

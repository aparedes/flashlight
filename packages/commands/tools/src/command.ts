import { Command, Option } from "commander";
import { processVideoFile } from "@lantern/shell";
import { Logger } from "@lantern/logger";
import { PlatformResolutionError, profiler, resolvePlatform, setPlatform } from "@lantern/profiler";
import fs from "fs";

export const registerToolsCommand = (program: Command) => {
  const toolsCommand = program.command("tools").description("Utility tools related to Lantern");

  toolsCommand
    .command("get_bundle_id")
    .description("Retrieves the bundle id of the app currently running on the device")
    .addOption(
      new Option(
        "--platform <platform>",
        "android or ios. Defaults to the PLATFORM env var, then to whichever platform has a device connected"
      ).choices(["android", "ios"])
    )
    .action((options) => {
      try {
        setPlatform(resolvePlatform(options.platform));
      } catch (error) {
        if (error instanceof PlatformResolutionError) {
          Logger.error(error.message);
          process.exit(1);
        }
        throw error;
      }

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

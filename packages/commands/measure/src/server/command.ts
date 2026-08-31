import { Command, Option } from "commander";
import { Logger } from "@lantern/logger";
import { PlatformResolutionError, resolvePlatform, setPlatform } from "@lantern/profiler";
import { DEFAULT_PORT } from "./constants";

export const platformOption = new Option(
  "--platform <platform>",
  "android or ios. Defaults to the PLATFORM env var, then to whichever platform has a device connected"
).choices(["android", "ios"]);

export const registerMeasureCommand = (program: Command) => {
  program
    .command("measure")
    .summary("Measure the performance of an Android or iOS app")
    .description(
      `Measure the performance of an Android or iOS app. Display the results live in a web app.

Main usage:
lantern measure
lantern measure --platform ios`
    )
    .option("-p, --port [port]", "Specify the port number for the server")
    .addOption(platformOption)
    .action(async (options) => {
      try {
        setPlatform(resolvePlatform(options.platform));
      } catch (error) {
        if (error instanceof PlatformResolutionError) {
          Logger.error(error.message);
          process.exit(1);
        }
        throw error;
      }

      const port = Number(options.port) || DEFAULT_PORT;
      // measure command can be a bit slow to load since we run ink and the web app server, so lazy load it
      const { runServerApp } = await import("./ServerApp.js");
      await runServerApp(port);
    });
};

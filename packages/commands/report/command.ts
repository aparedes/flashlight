import fs from "fs";
import os from "os";
import path from "path";
import { Command, Option } from "commander";
import { Logger } from "@lantern/logger";
import { open } from "@lantern/shell";
import { parseDuration, parseSkip } from "./optionParsers";
import { getReportFileName, writeReport } from "./writeReport";

export const registerReportCommand = (program: Command) => {
  program
    .command("report")
    .argument("<files/folders...>")
    .summary("Generate web report from performance measures.")
    .description(
      `Generate web report from performance measures.

Examples:
lantern report results1.json
lantern report results1.json results2.json -o output-dir
lantern report results1.json --skip 1500 --duration 10000
`
    )
    .option("-o, --output-dir <outputDir>", "Output directory for the web report")
    .addOption(
      new Option(
        "-d, --duration <duration>",
        `Duration in ms of measures to analyze in report. If measures are longer than that, they'll be "cut".`
      ).argParser(parseDuration)
    )
    .addOption(
      new Option("-s, --skip <skip>", "Skip first ms of measures in report").argParser(parseSkip)
    )
    .action(
      (jsonPaths: string[], options: { outputDir?: string; duration?: number; skip?: number }) => {
        const outputDir = options.outputDir || os.tmpdir();
        // With `-o` the user owns the folder and `report.html` is overwritten as before. Otherwise
        // reports share the temp dir, so give each a name that does not clobber a previous one.
        const fileName = options.outputDir
          ? "report.html"
          : getReportFileName({
              firstJsonPath: jsonPaths[0],
              exists: (name) => fs.existsSync(path.join(outputDir, name)),
            });

        const htmlFilePath = writeReport({
          outputDir,
          jsonPaths,
          duration: options.duration ?? null,
          skip: options.skip ?? 0,
          fileName,
        });

        Logger.success(`Opening report: ${htmlFilePath}`);
        open(htmlFilePath);
      }
    );
};

import { Command } from "commander";
import { registerMeasureCommand } from "@perf-profiler/measure/dist/server/command";
import { registerTestCommand } from "@perf-profiler/e2e";
import { registerToolsCommand } from "@perf-profiler/tools/dist/command";
import { registerReportCommand } from "@perf-profiler/web-reporter/dist/command";
import { version } from "../package.json";

export const createProgram = () => {
  const program = new Command("flashlight").version(version);
  registerMeasureCommand(program);
  registerTestCommand(program);
  registerToolsCommand(program);
  registerReportCommand(program);
  return program;
};

import { DeviceInfo } from "@lantern/types";
import { Logger } from "@lantern/logger";
import { executeCommand } from "./shell";

/** Parses `adb devices -l`: skips the header, keeps `<serial> device …` rows. */
export const parseAdbDevices = (output: string): DeviceInfo[] =>
  output
    .split(/\r\n|\n|\r/)
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line && /\sdevice(\s|$)/.test(line))
    .map((line) => {
      const [id] = line.split(/\s+/);
      const model = line.match(/model:(\S+)/)?.[1];

      return {
        id,
        name: model ? model.replace(/_/g, " ") : id,
        platform: "android" as const,
      };
    });

export const listAndroidDevices = (): DeviceInfo[] => {
  try {
    return parseAdbDevices(executeCommand("adb devices -l"));
  } catch (error) {
    Logger.debug(`adb devices failed: ${error instanceof Error ? error.message : error}`);

    return [];
  }
};

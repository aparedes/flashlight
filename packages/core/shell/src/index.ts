import { execFileSync } from "child_process";
import { Logger } from "@lantern/logger";

/**
 * The OS "open with default app" command as an argv array, so the path is never interpreted by a
 * shell (spaces, quotes, `&`...). `start` is a cmd.exe builtin whose first quoted argument is the
 * window title, hence the empty string.
 */
export const getOpenCommand = (
  path: string,
  platform: NodeJS.Platform = process.platform
): { command: string; args: string[] } => {
  switch (platform) {
    case "darwin":
      return { command: "open", args: [path] };
    case "win32":
      return { command: "cmd", args: ["/c", "start", "", path] };
    default:
      return { command: "xdg-open", args: [path] };
  }
};

export const open = (path: string) => {
  const { command, args } = getOpenCommand(path);
  try {
    execFileSync(command, args);
  } catch {
    Logger.warn(`Failed to open ${path} with "${command}"`);
  }
};

export * from "./processVideoFile";
export * from "./downloadFile";

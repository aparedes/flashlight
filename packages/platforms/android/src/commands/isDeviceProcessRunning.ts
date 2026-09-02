import { executeCommand } from "./shell";

/**
 * Whether a process with the given name (binary name or bundle id) is running on the device.
 *
 * `pidof` exits with a non zero code (which makes `executeCommand` throw) when no process matches.
 */
export const isDeviceProcessRunning = (processName: string): boolean => {
  try {
    return executeCommand(`adb shell pidof ${processName}`).trim() !== "";
  } catch {
    return false;
  }
};

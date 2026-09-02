import { Logger } from "@lantern/logger";
import { ChildProcess, execSync } from "child_process";
import { executeAsync, executeCommand } from "../shell";
import { getAbi } from "../getAbi";
import { detectCurrentAppBundleId } from "../detectCurrentAppBundleId";
import { CppProfilerName, UnixProfiler } from "./UnixProfiler";
import { ScreenRecorder } from "../ScreenRecorder";
import { refreshRateManager } from "../detectCurrentDeviceRefreshRate";
import { listAndroidDevices } from "../listDevices";
import { listInstalledApps } from "../listInstalledApps";
import { isDeviceProcessRunning } from "../isDeviceProcessRunning";
import { waitFor } from "../../utils/waitFor";

/**
 * atrace only traces for the duration given with `-t` (default 5 s, and there is no "forever"),
 * after which it disables tracing and exits: the profiler then gets no more frame data and
 * FPS silently degrades. We use the longest practical duration and restart atrace when it
 * exits on its own (see `startATrace`).
 */
const ATRACE_COMMAND = "adb shell atrace -c view -t 999";
const STOP_APP_TIMEOUT = 5000;

const enableFpsDebug = () => executeCommand("adb shell setprop debug.hwui.profile true");

export class AndroidProfiler extends UnixProfiler {
  private aTraceProcess: ChildProcess | null = null;

  installProfilerOnDevice(): void {
    super.installProfilerOnDevice();
    if (!refreshRateManager.isInitialized()) refreshRateManager.setRefreshRate();
    if (!this.aTraceProcess) this.startATrace();
  }

  stop(): void {
    this.stopATrace();
  }

  assertSupported(): void {
    const sdkVersion = parseInt(executeCommand("adb shell getprop ro.build.version.sdk"), 10);

    if (sdkVersion < 24) {
      throw new Error(
        `Your Android version (sdk API level ${sdkVersion}) is not supported. Supported versions > 23.`
      );
    }
  }

  protected pushExecutable(binaryTmpPath: string): void {
    executeCommand(`adb push ${binaryTmpPath} ${this.getDeviceProfilerPath()}`);
    executeCommand(`adb shell chmod 755 ${this.getDeviceProfilerPath()}`);
  }

  public getDeviceProfilerPath(): string {
    return `/data/local/tmp/${CppProfilerName}`;
  }

  protected stopATrace() {
    // We need to close this process, otherwise tests will hang
    Logger.debug("Stopping atrace process...");
    this.aTraceProcess?.kill();
    this.aTraceProcess = null;
  }

  protected startATrace() {
    // Done here rather than at import time so that a machine without `adb` (iOS only) can
    // still load this package.
    enableFpsDebug();

    Logger.debug("Stopping atrace and flushing output...");
    /**
     * Since output from the atrace --async_stop
     * command can be quite big, seems like buffer overflow can happen
     * Let's ignore the output then
     *
     * See https://stackoverflow.com/questions/63796633/spawnsync-bin-sh-enobufs
     */
    execSync("adb shell atrace --async_stop", { stdio: "ignore" });
    Logger.debug("Starting atrace...");
    const aTraceProcess = executeAsync(ATRACE_COMMAND);
    this.aTraceProcess = aTraceProcess;

    // atrace dumps its buffer on stdout when it stops, drain it so it never blocks on a full pipe
    aTraceProcess.stdout?.on("data", () => {});

    aTraceProcess.on("close", () => {
      // Still the current process: it was not stopped by us (see ATRACE_COMMAND), so restart it
      if (this.aTraceProcess !== aTraceProcess) return;
      Logger.debug("atrace exited on its own, restarting it...");
      this.aTraceProcess = null;
      this.startATrace();
    });
  }

  public getDeviceCommand(command: string): string {
    return `adb shell ${command}`;
  }

  protected getAbi(): string {
    return getAbi();
  }

  public detectCurrentBundleId(): string {
    return detectCurrentAppBundleId().bundleId;
  }

  public supportFPS(): boolean {
    return true;
  }

  public getScreenRecorder(videoPath: string) {
    return new ScreenRecorder(videoPath);
  }

  async stopApp(bundleId: string) {
    execSync(`adb shell am force-stop ${bundleId}`);
    try {
      await waitFor(() => !isDeviceProcessRunning(bundleId), {
        timeout: STOP_APP_TIMEOUT,
        checkInterval: 100,
      });
    } catch {
      Logger.warn(`${bundleId} is still running ${STOP_APP_TIMEOUT}ms after force-stop`);
    }
  }

  public detectDeviceRefreshRate(): number {
    return refreshRateManager.getRefreshRate();
  }

  public listApps() {
    return listInstalledApps();
  }

  public listDevices() {
    return listAndroidDevices();
  }
}

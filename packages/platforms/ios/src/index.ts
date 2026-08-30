import { ChildProcess, execFile, spawn } from "child_process";
import fs from "fs";
import { createInterface } from "readline";
import { Logger } from "@perf-profiler/logger";
import {
  Measure,
  POLLING_INTERVAL,
  Profiler,
  ProfilerPollingOptions,
  ScreenRecorder,
} from "@perf-profiler/types";

const BINARY_NAME = "flashlight-ios-profiler";

// Resolves to <package root>/rust-profiler/bin, from either src/ or dist/src/
const defaultBinaryPath = `${__dirname}/..${
  __dirname.includes("dist") ? "/.." : ""
}/rust-profiler/bin/${BINARY_NAME}`;

// Allow overriding the binary path with an environment variable, mirroring
// FLASHLIGHT_BINARY_PATH on Android
const getBinaryPath = () => process.env.FLASHLIGHT_IOS_BINARY_PATH || defaultBinaryPath;

interface MeasureLine {
  type: "measure";
  time: number;
  cpu: { perName: { [name: string]: number }; perCore: { [core: number]: number } };
  ram: number;
  fps?: number;
  threadCount: number;
  pid: number;
}

interface StatusLine {
  type: "status";
  event: string;
  pid?: number;
  name?: string;
  detail?: string;
}

type ProfilerLine = MeasureLine | StatusLine;

export class IOSProfiler implements Profiler {
  private polling: ChildProcess | undefined;

  pollPerformanceMeasures(bundleId: string, options: ProfilerPollingOptions): { stop: () => void } {
    const child = spawn(getBinaryPath(), [
      "poll",
      "--bundle-id",
      bundleId,
      "--interval-ms",
      `${POLLING_INTERVAL}`,
    ]);
    this.polling = child;

    createInterface({ input: child.stdout }).on("line", (rawLine) => {
      let line: ProfilerLine;
      try {
        line = JSON.parse(rawLine);
      } catch {
        Logger.debug(`Unparseable profiler output: ${rawLine}`);
        return;
      }

      switch (line.type) {
        case "measure": {
          const measure: Measure = {
            cpu: line.cpu,
            ram: line.ram,
            fps: line.fps,
            time: line.time,
          };
          options.onMeasure(measure);
          break;
        }
        case "status":
          if (line.event === "started") {
            options.onStartMeasuring?.();
          }
          Logger.debug(`iOS profiler: ${line.event}${line.detail ? ` (${line.detail})` : ""}`);
          break;
      }
    });

    createInterface({ input: child.stderr }).on("line", (line) => {
      if (line.startsWith("IOS_PROFILER_ERROR_")) {
        Logger.error(line);
      } else {
        Logger.debug(line);
      }
    });

    child.on("error", (error) => {
      Logger.error(
        `Failed to start ${getBinaryPath()}: ${error.message}. Build it with packages/platforms/ios/rust-profiler/build_macos.sh or set FLASHLIGHT_IOS_BINARY_PATH.`
      );
    });

    return {
      stop: () => {
        // SIGINT lets the binary tear down its instruments taps cleanly
        child.kill("SIGINT");
        this.polling = undefined;
      },
    };
  }

  detectCurrentBundleId(): string {
    throw new Error(
      "App id detection is not implemented on iOS, please pass the bundle id explicitly"
    );
  }

  installProfilerOnDevice() {
    const binaryPath = getBinaryPath();
    if (!process.env.FLASHLIGHT_IOS_BINARY_PATH && !fs.existsSync(binaryPath)) {
      throw new Error(
        `${BINARY_NAME} not found at ${binaryPath}. Build it with packages/platforms/ios/rust-profiler/build_macos.sh (macOS only) or set FLASHLIGHT_IOS_BINARY_PATH.`
      );
    }
  }

  getScreenRecorder(): ScreenRecorder | undefined {
    return undefined;
  }

  cleanup: () => void = () => {
    this.polling?.kill("SIGINT");
    this.polling = undefined;
  };

  async stopApp(bundleId: string): Promise<void> {
    await new Promise<void>((resolve) => {
      execFile(getBinaryPath(), ["kill", "--bundle-id", bundleId], (error) => {
        if (error) {
          Logger.debug(`Could not stop ${bundleId}: ${error.message}`);
        }
        resolve();
      });
    });
  }

  detectDeviceRefreshRate() {
    // Not yet reported by the profiler binary; ProMotion devices actually
    // run at 120 - measure with the device on hand before changing this.
    return 60;
  }
}

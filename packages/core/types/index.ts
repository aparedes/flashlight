export interface CpuMeasure {
  perName: { [processName: string]: number };
  perCore: { [core: number]: number };
}

export interface Measure {
  cpu: CpuMeasure;
  ram?: number;
  fps?: number;
  time: number;
}

export interface HistogramValue {
  renderingTime: number;
  frameCount: number;
}

export type TestCaseIterationStatus = "SUCCESS" | "FAILURE";

export interface TestCaseIterationResult {
  time: number;
  // we probably don't need this but this is added by the PerformanceMeasurer
  startTime?: number;
  measures: Measure[];
  status: TestCaseIterationStatus;
  videoInfos?: {
    path: string;
    startOffset: number;
  };
  isRetriedIteration?: boolean;
}

export type TestCaseResultStatus = "SUCCESS" | "FAILURE"; // Todo: add "SUCCESS_WITH_SOME_ITERATIONS_FAILED"

export interface TestCaseResult {
  name: string;
  score?: number;
  status: TestCaseResultStatus;
  iterations: TestCaseIterationResult[];
  specs?: DeviceSpecs;
}

export interface AveragedTestCaseResult {
  name: string;
  score?: number;
  status: TestCaseResultStatus;
  iterations: TestCaseIterationResult[];
  average: TestCaseIterationResult;
  averageHighCpuUsage: { [processName: string]: number };
  specs?: DeviceSpecs;
}

// Shouldn't really be here but @lantern/types is imported by everyone and doesn't contain any logic
// so nice to have it here for now
export const POLLING_INTERVAL = 500;

export type Platform = "android" | "ios";

export interface AppInfo {
  bundleId: string;
  /** Human-readable name when the platform provides one, else the bundle id. */
  name: string;
  /** Set by platforms that can tell (iOS); undefined means unknown. */
  isRunning?: boolean;
}

export interface DeviceInfo {
  id: string;
  name: string;
  platform: Platform;
  /** iOS model identifier (e.g. "iPhone16,1"), when known. */
  model?: string;
}

export const ThreadNames = {
  ANDROID: {
    UI: "UI Thread",
  },
  IOS: {
    UI: "Main Thread",
  },
  FLUTTER: {
    UI: "1.ui",
    RASTER: "1.raster",
    IO: "1.io",
  },
  RN: {
    JS_ANDROID: "mqt_js",
    JS_BRIDGELESS_ANDROID: "mqt_v_js",
    OLD_BRIDGE: "mqt_native_modu",
    JS_IOS: "com.facebook.react.JavaScript",
  },
};

export interface ScreenRecorder {
  startRecording({ bitRate, size }: { bitRate?: number; size?: string }): Promise<void>;
  stopRecording(): Promise<void>;
  pullRecording: (path: string) => Promise<void>;
  getRecordingStartTime: () => number;
}

export interface ProfilerPollingOptions {
  onMeasure: (measure: Measure) => void;
  onStartMeasuring?: () => void;
  /**
   * The profiler process ended, expectedly (after `stop()`) or not; `reason` is a short
   * human-readable description. No more measures follow.
   */
  onEnd?: (reason: string) => void;
}

export interface Profiler {
  pollPerformanceMeasures: (
    bundleId: string,
    options: ProfilerPollingOptions
  ) => { stop: () => void };
  detectCurrentBundleId: () => string;
  installProfilerOnDevice: () => void;
  cleanup: () => void;
  getScreenRecorder: (videoPath: string) => ScreenRecorder | undefined;
  stopApp: (bundleId: string) => Promise<void>;
  detectDeviceRefreshRate: () => number;
  /** Installed, user-launchable apps. Used to populate the measure web app's picker. */
  listApps: () => Promise<AppInfo[]>;
  /** Devices reachable right now; `[]` when the platform tooling is missing. Must not throw. */
  listDevices: () => DeviceInfo[];
}

export interface DeviceSpecs {
  refreshRate: number;
}

import { mock } from "bun:test";
import { Measure, ProfilerPollingOptions } from "@lantern/types";

/** The real profiler needs a first sample before it reports anything, mimic that small delay */
export const MOCK_START_DELAY = 20;

export const mockMeasure = (time = 0): Measure => ({
  cpu: { perName: {}, perCore: {} },
  ram: 0,
  fps: 60,
  time,
});

export class PerformancePollingMock {
  private cb?: (measure: Measure) => void;
  private options?: ProfilerPollingOptions;
  private startTimeout?: ReturnType<typeof setTimeout>;

  /** When false, the mocked profiler never reports that it started measuring */
  startsMeasuring = true;
  /** Emit one measure right after starting so that iterations have something to report */
  emitsMeasureOnStart = true;

  emit(measure: Partial<Measure>) {
    this.cb?.(measure as Measure);
  }

  setCallback = mock((cb: (measure: Measure) => void) => {
    this.cb = cb;
  });

  isStarted() {
    return !!this.cb;
  }

  reset() {
    this.startsMeasuring = true;
    this.emitsMeasureOnStart = true;
  }

  /** The mocked profiler took its first sample (e.g. the app just got launched) */
  reportStarted = () => {
    clearTimeout(this.startTimeout);
    if (!this.options) throw new Error("The mocked profiler was not started");
    this.options.onStartMeasuring?.();
    this.setCallback(this.options.onMeasure);
    if (this.emitsMeasureOnStart) this.emit(mockMeasure(0));
  };

  /** The mocked profiler process exited */
  end = (reason: string) => {
    clearTimeout(this.startTimeout);
    this.cb = undefined;
    this.options?.onEnd?.(reason);
  };

  /** Drop-in mock for `profiler.pollPerformanceMeasures` */
  start = (options: ProfilerPollingOptions) => {
    this.options = options;
    this.startTimeout = setTimeout(() => {
      if (this.startsMeasuring) this.reportStarted();
    }, MOCK_START_DELAY);

    return {
      stop: () => {
        clearTimeout(this.startTimeout);
        this.cb = undefined;
      },
    };
  };
}

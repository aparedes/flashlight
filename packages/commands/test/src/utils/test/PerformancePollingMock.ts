import { mock } from "bun:test";
import { Measure } from "@perf-profiler/types";

export class PerformancePollingMock {
  private cb?: (measure: Measure) => void;

  emit(measure: Partial<Measure>) {
    this.cb?.(measure as Measure);
  }

  setCallback = mock((cb: (measure: Measure) => void) => {
    this.cb = cb;
  });

  isStarted() {
    return !!this.cb;
  }
}

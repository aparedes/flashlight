import { Logger } from "@lantern/logger";
import { profiler, waitFor } from "@lantern/profiler";
import { basename, dirname } from "path";
import { Trace } from "./Trace";
import { Measure, POLLING_INTERVAL, ScreenRecorder, TestCaseIterationResult } from "@lantern/types";

/**
 * How long the profiler gets to report that it is measuring (see `waitUntilMeasuring`). Once the
 * app runs, spawning the profiler on the device and taking a baseline sample typically takes 0.5
 * to 1.5s — but on Android the profiler only samples once the app runs, and the app may well be
 * launched by the test command itself (`beforeTest` force-stops it, see `command.ts`), so this
 * also has to cover the test tooling starting the app.
 */
export const START_MEASURING_TIMEOUT = 30000;

export class PerformanceMeasurer {
  measures: Measure[] = [];
  polling?: { stop: () => void };
  shouldStop = false;
  timingTrace?: Trace;

  private recorder: ScreenRecorder | undefined | null;
  private recordingStarted = false;
  private forceStopped = false;
  /** Settles once the profiler reported its first sample or gave up, see `waitUntilMeasuring` */
  private measuringStarted?: Promise<void>;
  /** Settles `measuringStarted` when the measurer is stopped before the profiler reported anything */
  private resolvePendingStart?: () => void;

  constructor(
    private bundleId: string,
    private options: {
      recordOptions:
        | { record: false }
        | {
            record: true;
            size?: string;
            bitRate?: number;
            videoPath: string;
          };
      /** Overrides `START_MEASURING_TIMEOUT` (in ms) */
      startTimeout?: number;
    }
  ) {
    this.recorder = this.options.recordOptions.record
      ? profiler.getScreenRecorder(basename(this.options.recordOptions.videoPath))
      : null;
  }

  /**
   * Starts the recording and the profiler. Resolves once the profiler is spawned: whether it then
   * manages to measure is reported by `waitUntilMeasuring` / `runWhileMeasuring`.
   */
  async start(
    onMeasure: (measure: Measure) => void = () => {
      // noop by default
    }
  ) {
    await this.maybeStartRecording();

    // Stopped while the recording was starting: there is nothing left to measure
    if (this.forceStopped) return;

    const timeout = this.options.startTimeout ?? START_MEASURING_TIMEOUT;

    this.measuringStarted = new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        this.resolvePendingStart = undefined;
        callback();
      };

      const timeoutId = setTimeout(() => {
        this.polling?.stop();
        settle(() =>
          reject(
            new Error(
              `The profiler did not start measuring within ${timeout}ms, is "${this.bundleId}" running on the device?`
            )
          )
        );
      }, timeout);

      this.resolvePendingStart = () => settle(resolve);

      this.polling = profiler.pollPerformanceMeasures(this.bundleId, {
        onMeasure: (measure) => {
          if (this.shouldStop) {
            this.polling?.stop();
          }

          this.measures.push(measure);
          onMeasure(measure);
          Logger.debug(`Received measure ${this.measures.length}`);
        },
        onStartMeasuring: () => {
          this.measures = [];
          this.timingTrace = new Trace();
          settle(resolve);
        },
        onEnd: (reason) => {
          // Only relevant while we are still waiting for the first sample, a no-op afterwards
          settle(() =>
            reject(new Error(`The profiler stopped before it started measuring: ${reason}`))
          );
        },
      });
    });
    // Nothing may ever await it (e.g. the test failed on its own first): a rejection must not
    // surface as unhandled
    this.measuringStarted.catch(() => {});
  }

  /**
   * Resolves once the profiler has reported that it is measuring, i.e. the run is covered by
   * measures from then on. Rejects if it never gets there (`START_MEASURING_TIMEOUT` elapsed, or
   * the profiler exited first). Resolves right away when the measurer was force stopped.
   */
  waitUntilMeasuring(): Promise<void> {
    return this.measuringStarted ?? Promise.resolve();
  }

  /**
   * Runs `task` while waiting for the profiler to start measuring, and fails as soon as the
   * profiler cannot, rather than once `task` is over. The wait cannot come before `task`: on
   * Android the profiler only takes its first sample once the app runs, and the app may be
   * launched by `task` itself (see `START_MEASURING_TIMEOUT`).
   */
  runWhileMeasuring<T>(task: () => Promise<T> | T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.waitUntilMeasuring().catch(reject);
      Promise.resolve().then(task).then(resolve, reject);
    });
  }

  forceStop() {
    this.forceStopped = true;
    this.resolvePendingStart?.();
    this.polling?.stop();
  }

  async stop(duration?: number): Promise<TestCaseIterationResult> {
    // The run may be over before the profiler took its first sample (see `runWhileMeasuring`):
    // give it its chance rather than reporting no measures — or its failure to start, if any.
    // A `forceStop()` settles this wait right away.
    await this.waitUntilMeasuring();

    const time = this.timingTrace?.stop();

    if (duration) {
      // Hack to wait for the duration to be reached in case test case has finished before
      await waitFor(() => this.measures.length * POLLING_INTERVAL > duration, {
        checkInterval: POLLING_INTERVAL,
        timeout: duration * 2,
        errorMessage:
          "We don't have enough measures for the duration of the test specified, maybe the app has crashed?",
      });
      this.measures = this.measures.slice(0, duration / POLLING_INTERVAL + 1);
    } else {
      this.shouldStop = true;
      // Hack to wait for the last measures to be received
      await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL * 2));
    }

    // Ensure polling has stopped
    this.polling?.stop();

    await this.maybeStopRecording();

    if (this.measures.length === 0) {
      throw new Error(
        `No measures were received from the profiler for "${this.bundleId}", maybe the app has crashed or was never started?`
      );
    }

    const startTime = this.timingTrace?.startTime ?? 0;

    return {
      time: time ?? 0,
      startTime,
      measures: this.measures,
      status: "SUCCESS",
      videoInfos:
        this.options.recordOptions.record && this.recorder && this.recordingStarted
          ? {
              path: this.options.recordOptions.videoPath,
              startOffset: Math.floor(startTime - this.recorder.getRecordingStartTime()),
            }
          : undefined,
    };
  }

  private async maybeStartRecording() {
    if (this.options.recordOptions.record && this.recorder) {
      const { bitRate, size } = this.options.recordOptions;
      await this.recorder.startRecording({ bitRate, size });
      this.recordingStarted = true;
    }
  }

  private async maybeStopRecording() {
    if (this.options.recordOptions.record && this.recorder) {
      await this.recorder.stopRecording();
      // There is no file to pull when the recording never started (e.g. `beforeTest` failed)
      if (this.recordingStarted) {
        await this.recorder.pullRecording(dirname(this.options.recordOptions.videoPath));
      }
    }
  }
}

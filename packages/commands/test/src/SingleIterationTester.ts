import { Logger } from "@lantern/logger";
import {
  AveragedTestCaseResult,
  TestCaseIterationResult,
  TestCaseIterationStatus,
} from "@lantern/types";
import { PerformanceMeasurer } from "./PerformanceMeasurer";

export interface TestCase {
  beforeTest?: () => Promise<void> | void;
  run: () => Promise<void> | void;
  afterTest?: () => Promise<void> | void;
  duration?: number;
  getScore?: (result: AveragedTestCaseResult) => number;
}

export interface Options {
  iterationCount: number;
  maxRetries: number;
  recordOptions: {
    record: boolean;
    size?: string;
    bitRate?: number;
  };
  resultsFileOptions: {
    path: string;
    title: string;
  };
}

export class SingleIterationTester {
  private currentTestCaseIterationResult: TestCaseIterationResult | undefined = undefined;
  private videoPath: string;
  private performanceMeasurer: PerformanceMeasurer;

  constructor(
    private bundleId: string,
    private testCase: TestCase,
    private options: Options,
    private iterationIndex: number
  ) {
    this.videoPath = `${this.options.resultsFileOptions.path.replace(/\.json$/, "")}_iteration_${
      this.iterationIndex
    }_${new Date().getTime()}.mp4`;
    this.performanceMeasurer = new PerformanceMeasurer(this.bundleId, {
      recordOptions: {
        ...this.options.recordOptions,
        videoPath: this.videoPath,
      },
    });
  }

  public getCurrentTestCaseIterationResult() {
    return this.currentTestCaseIterationResult;
  }

  public async executeTestCase(): Promise<void> {
    const { beforeTest, run, afterTest, duration } = this.testCase;

    try {
      if (beforeTest) await beforeTest();

      await this.performanceMeasurer.start();
      // The test itself may launch the app the profiler is waiting for: do not gate it on the
      // first sample, but do fail it as soon as the profiler gives up
      await this.performanceMeasurer.runWhileMeasuring(run);
      const measures = await this.performanceMeasurer.stop(duration);

      if (afterTest) await afterTest();

      this.setCurrentTestCaseIterationResult(measures, "SUCCESS");
    } catch (error) {
      // Stop polling right away so that a failing `stop()` below cannot leak the profiler
      this.performanceMeasurer.forceStop();

      let measures: TestCaseIterationResult | undefined;
      try {
        measures = await this.performanceMeasurer.stop();
      } catch (stopError) {
        // e.g. no measures were ever received, or the recording could not be pulled: the original
        // error is the one worth reporting, keep whatever measures we have
        Logger.debug(
          `Could not stop the performance measurer cleanly: ${
            stopError instanceof Error ? stopError.message : "unknown error"
          }`
        );
      }

      this.setCurrentTestCaseIterationResult(
        measures ?? {
          time: 0,
          startTime: this.performanceMeasurer.timingTrace?.startTime ?? 0,
          measures: this.performanceMeasurer.measures,
          status: "FAILURE",
        },
        "FAILURE"
      );
      throw error;
    }
  }

  public setIsRetry(isRetry: boolean) {
    if (this.currentTestCaseIterationResult) {
      this.currentTestCaseIterationResult.isRetriedIteration = isRetry;
    }
  }

  private setCurrentTestCaseIterationResult(
    measures: TestCaseIterationResult,
    status: TestCaseIterationStatus
  ) {
    this.currentTestCaseIterationResult = {
      ...measures,
      status,
    };
  }
}

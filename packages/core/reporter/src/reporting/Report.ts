import { TestCaseResult, AveragedTestCaseResult, TestCaseIterationResult } from "@lantern/types";
import { roundToDecimal } from "../utils/round";
import { averageTestCaseResult } from "./averageIterations";
import { getScore } from "./getScore";
import {
  getAverageCpuUsage,
  getAverageCpuUsagePerProcess,
  getCpuStats,
  getThreadsStats,
} from "./cpu";
import { getAverageFPSUsage, getFpsStats } from "./fps";
import { getAverageTotalHighCPUUsage, getHighCpuStats } from "./highCpu";
import { IterationSummary, summarizeIteration } from "./iterationSummary";
import { getAverageRAMUsage, getRamStats } from "./ram";
import { getRuntimeStats } from "./runtime";

interface ReportMetrics {
  runtime: number;
  fps?: number;
  cpu: number;
  totalHighCpuTime: number;
  ram?: number;
  averageCpuUsagePerProcess: {
    cpuUsage: number;
    processName: string;
  }[];
}

export interface ReportStats {
  cpu: ReturnType<typeof getCpuStats>;
  fps: ReturnType<typeof getFpsStats>;
  highCpu: ReturnType<typeof getHighCpuStats>;
  ram: ReturnType<typeof getRamStats>;
  runtime: ReturnType<typeof getRuntimeStats>;
  threads: ReturnType<typeof getThreadsStats>;
}

export class Report {
  /** The raw result, including failed iterations. */
  private result: TestCaseResult;
  /**
   * Only successful iterations feed the averages, the stats and the iteration selector.
   * Legacy result files carry no status, so an iteration is dropped only when it is
   * explicitly marked as failed.
   */
  private successfulIterations: TestCaseIterationResult[];
  private iterationSummaries: IterationSummary[];
  private averagedResult: AveragedTestCaseResult;
  private averageMetrics: ReportMetrics;
  private cachedScore: number | undefined;
  private cachedStats: ReportStats | undefined;

  constructor(result: TestCaseResult) {
    this.result = result;
    this.successfulIterations = result.iterations.filter(
      (iteration) => iteration.status !== "FAILURE"
    );
    this.iterationSummaries = this.successfulIterations.map(summarizeIteration);
    this.averagedResult = averageTestCaseResult({
      ...result,
      iterations: this.successfulIterations,
    });
    this.averageMetrics = Report.getAverageMetrics(this.averagedResult);
  }

  private static getAverageMetrics(averagedResult: AveragedTestCaseResult): ReportMetrics {
    const averageTestRuntime = roundToDecimal(averagedResult.average.time, 0);
    const averageFPS = getAverageFPSUsage(averagedResult.average.measures);
    const averageCPU = roundToDecimal(getAverageCpuUsage(averagedResult.average.measures), 1);
    const averageTotalHighCPU = roundToDecimal(
      getAverageTotalHighCPUUsage(averagedResult.averageHighCpuUsage) / 1000,
      1
    );
    const averageRAM = getAverageRAMUsage(averagedResult.average.measures);

    return {
      runtime: averageTestRuntime,
      fps: averageFPS !== undefined ? roundToDecimal(averageFPS, 1) : undefined,
      cpu: averageCPU,
      totalHighCpuTime: averageTotalHighCPU,
      ram: averageRAM !== undefined ? roundToDecimal(averageRAM, 1) : undefined,
      averageCpuUsagePerProcess: getAverageCpuUsagePerProcess(averagedResult.average.measures),
    };
  }

  public get name() {
    return this.result.name;
  }

  public get status() {
    return this.result.status;
  }

  public get score() {
    this.cachedScore ??= this.averagedResult.score ?? getScore(this.averagedResult);
    return this.cachedScore;
  }

  public getIterationCount() {
    return this.successfulIterations.length;
  }

  public hasMeasures() {
    return this.successfulIterations[0]?.measures.length > 0;
  }

  public hasVideos() {
    return !!this.successfulIterations[0]?.videoInfos;
  }

  /** A report over the single successful iteration at `iterationIndex`, or over none if out of bounds. */
  public selectIteration(iterationIndex: number): Report {
    const isInBounds = iterationIndex >= 0 && iterationIndex < this.successfulIterations.length;

    return new Report({
      ...this.result,
      iterations: isInBounds ? [this.successfulIterations[iterationIndex]] : [],
    });
  }

  public getAveragedResult() {
    return this.averagedResult;
  }

  public getAverageMetrics() {
    return this.averageMetrics;
  }

  public getStats(): ReportStats {
    this.cachedStats ??= {
      cpu: getCpuStats(this.iterationSummaries, this.averageMetrics.cpu),
      fps: getFpsStats(this.iterationSummaries, this.averageMetrics.fps),
      highCpu: getHighCpuStats(this.iterationSummaries, this.averagedResult.averageHighCpuUsage),
      ram: getRamStats(this.iterationSummaries, this.averageMetrics.ram),
      runtime: getRuntimeStats(this.iterationSummaries, this.averageMetrics.runtime),
      threads: getThreadsStats(this.iterationSummaries),
    };
    return this.cachedStats;
  }

  public getRefreshRate() {
    return this.result.specs?.refreshRate ?? 60;
  }
}

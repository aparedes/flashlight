import { CpuMeasure as Measure } from "@lantern/types";
import { ProcessStat } from "./getCpuStatsByProcess";

export class CpuMeasureAggregator {
  private previousTotalCpuTimePerProcessId: { [processId: string]: number } = {};

  constructor(private cpuClockTick: number) {}

  private groupCpuUsage(
    stats: ProcessStat[],
    groupByIteratee: (stat: ProcessStat) => string,
    timeInterval: number
  ): {
    [by: string]: number;
  } {
    const TICKS_FOR_TIME_INTERVAL = (this.cpuClockTick * timeInterval) / 1000;

    const toPercentage = (value: number) => Math.min((value * 100) / TICKS_FOR_TIME_INTERVAL, 100);

    const totalCpuTimeByGroup: { [by: string]: number } = {};
    for (const stat of stats) {
      const cpuTimeDiff =
        stat.totalCpuTime - (this.previousTotalCpuTimePerProcessId[stat.processId] || 0);
      const group = groupByIteratee(stat);

      totalCpuTimeByGroup[group] =
        (totalCpuTimeByGroup[group] || 0) +
        // if the diff is < 0, likely the process was restarted
        // so we count the new cpu time
        (cpuTimeDiff >= 0 ? cpuTimeDiff : stat.totalCpuTime);
    }

    return Object.fromEntries(
      Object.entries(totalCpuTimeByGroup).map(([by, value]) => [by, toPercentage(value)])
    );
  }

  initStats(stats: ProcessStat[]): void {
    const previousTotalCpuTimePerProcessId: { [processId: string]: number } = {};
    for (const stat of stats) {
      previousTotalCpuTimePerProcessId[stat.processId] = stat.totalCpuTime;
    }
    this.previousTotalCpuTimePerProcessId = previousTotalCpuTimePerProcessId;
  }

  process(stats: ProcessStat[], interval: number): Measure {
    const cpuUsagePerCore = this.groupCpuUsage(
      stats,
      (stat: ProcessStat) => stat.cpuNumber,
      interval
    );

    const cpuUsagePerProcessName = this.groupCpuUsage(
      stats,
      (stat: ProcessStat) => stat.processName,
      interval
    );

    this.initStats(stats);

    return {
      perName: cpuUsagePerProcessName,
      perCore: cpuUsagePerCore,
    };
  }
}

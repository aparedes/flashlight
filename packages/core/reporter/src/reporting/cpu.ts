import { Measure } from "@lantern/types";
import { orderBy } from "es-toolkit";
import { getStandardDeviation } from "../utils/getStandardDeviation";
import { getMinMax } from "../utils/getMinMax";
import { getStatsByThread, getValuesStats } from "../utils/getValuesStats";
import { roundToDecimal } from "../utils/round";
import type { IterationSummary } from "./iterationSummary";

export interface ProcessCpuUsage {
  processName: string;
  cpuUsage: number;
}

/**
 * Average CPU usage of each process over `measures`, unrounded and in first-seen order.
 * Sorting is left to the callers that need it so that summing stays a single pass.
 */
export const averageCpuUsagePerProcess = (measures: Measure[]): ProcessCpuUsage[] => {
  const totalByProcess: { [processName: string]: number } = {};

  for (const measure of measures) {
    for (const [processName, cpuUsage] of Object.entries(measure.cpu.perName)) {
      totalByProcess[processName] = (totalByProcess[processName] ?? 0) + cpuUsage;
    }
  }

  return Object.entries(totalByProcess).map(([processName, total]) => ({
    processName,
    cpuUsage: total / measures.length,
  }));
};

export const sortByCpuUsage = (processes: ProcessCpuUsage[]) =>
  orderBy(processes, [(process) => process.cpuUsage], ["desc"]);

export const getAverageCpuUsagePerProcess = (measures: Measure[]) =>
  sortByCpuUsage(averageCpuUsagePerProcess(measures)).map((measure) => ({
    ...measure,
    cpuUsage: roundToDecimal(measure.cpuUsage, 1),
  }));

export const sumCpuUsage = (processes: ProcessCpuUsage[]) =>
  processes.reduce<number>((sum, { cpuUsage }) => sum + cpuUsage, 0);

export const getAverageCpuUsage = (measures: Measure[]) =>
  sumCpuUsage(averageCpuUsagePerProcess(measures));

export const getStandardDeviationCPU = (
  iterations: IterationSummary[]
): {
  deviation: number;
  deviationRange: [number, number];
} => getStandardDeviation({ values: iterations.map((iteration) => iteration.cpuUsage) });

export const getMinMaxCPU = (iterations: IterationSummary[]): [number, number] =>
  getMinMax(iterations.map((iteration) => iteration.cpuUsage));

export const getCpuStats = (iterations: IterationSummary[], averageCpu: number) =>
  getValuesStats(
    iterations.map((iteration) => iteration.cpuUsage),
    averageCpu
  );

export const getThreadsStats = (iterations: IterationSummary[]) => {
  const threads: { [threadName: string]: number[] } = {};

  iterations.forEach((iteration) => {
    iteration.cpuUsagePerProcess.forEach(({ processName, cpuUsage }) => {
      if (!threads[processName]) {
        threads[processName] = [];
      }
      threads[processName].push(cpuUsage);
    });
  });

  return getStatsByThread(threads);
};

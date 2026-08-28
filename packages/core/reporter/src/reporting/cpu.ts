import { Measure, TestCaseIterationResult } from "@perf-profiler/types";
import { groupBy, orderBy } from "es-toolkit";
import { getMinMax } from "../utils/getMinMax";
import { getStandardDeviation } from "../utils/getStandardDeviation";
import { variationCoefficient } from "../utils/variationCoefficient";
import { roundToDecimal } from "../utils/round";

const _getAverageCpuUsagePerProcess = (measures: Measure[]) => {
  const allProcessCpuUsages = measures
    .map((measure) => measure.cpu)
    .flatMap(({ perName }) =>
      Object.keys(perName).map((processName) => ({
        processName,
        cpuUsage: perName[processName],
      }))
    );

  const groupedByProcessName = groupBy(allProcessCpuUsages, (measure) => measure.processName);

  const averagedByProcess = Object.entries(groupedByProcessName).map(
    ([processName, measuresForProcess]) => ({
      processName,
      cpuUsage:
        measuresForProcess.reduce((sum, measure) => sum + measure.cpuUsage, 0) / measures.length,
    })
  );

  return orderBy(averagedByProcess, [(measure) => measure.cpuUsage], ["desc"]);
};

export const getAverageCpuUsagePerProcess = (measures: Measure[]) =>
  _getAverageCpuUsagePerProcess(measures).map((measure) => ({
    ...measure,
    cpuUsage: roundToDecimal(measure.cpuUsage, 1),
  }));

export const getAverageCpuUsage = (measures: Measure[]) =>
  _getAverageCpuUsagePerProcess(measures).reduce<number>((sum, { cpuUsage }) => sum + cpuUsage, 0);

export const getStandardDeviationCPU = (
  iterations: TestCaseIterationResult[],
  averageCpu: number
): {
  deviation: number;
  deviationRange: [number, number];
} => {
  const averageCpuUsages = iterations.map((iteration) => getAverageCpuUsage(iteration.measures));
  return getStandardDeviation({
    values: averageCpuUsages,
    average: averageCpu,
  });
};

export const getMinMaxCPU = (iterations: TestCaseIterationResult[]): [number, number] => {
  const averageCpuUsages = iterations.map((iteration) => getAverageCpuUsage(iteration.measures));
  return getMinMax(averageCpuUsages);
};

export const getCpuStats = (iterations: TestCaseIterationResult[], averageCpu: number) => {
  const standardDeviation = getStandardDeviationCPU(iterations, averageCpu);

  return {
    minMaxRange: getMinMaxCPU(iterations),
    deviationRange: standardDeviation.deviationRange,
    variationCoefficient: variationCoefficient(averageCpu, standardDeviation.deviation),
  };
};

export const getThreadsStats = (iterations: TestCaseIterationResult[]) => {
  const threads: { [threadName: string]: number[] } = {};

  iterations.forEach((iteration) => {
    const measure = _getAverageCpuUsagePerProcess(iteration.measures);
    measure.forEach((threadMeasure) => {
      if (!threads[threadMeasure.processName]) {
        threads[threadMeasure.processName] = [];
      }
      threads[threadMeasure.processName].push(threadMeasure.cpuUsage);
    });
  });

  const statsByThread: {
    [threadName: string]: {
      minMaxRange: [number, number];
      deviationRange: [number, number];
      variationCoefficient: number;
    };
  } = {};

  Object.keys(threads).forEach((threadName) => {
    const threadValues = threads[threadName];
    const threadAverage = threadValues.reduce((sum, value) => sum + value, 0) / threadValues.length;
    const threadStandardDeviation = getStandardDeviation({
      values: threadValues,
      average: threadAverage,
    });
    statsByThread[threadName] = {
      minMaxRange: getMinMax(threadValues),
      deviationRange: threadStandardDeviation.deviationRange,
      variationCoefficient: variationCoefficient(threadAverage, threadStandardDeviation.deviation),
    };
  });

  return statsByThread;
};

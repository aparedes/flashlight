import { Measure } from "@lantern/types";
import { getValuesStats } from "../utils/getValuesStats";
import { average } from "./averageIterations";
import type { IterationSummary } from "./iterationSummary";

export const getAverageRAMUsage = (measures: Measure[]) =>
  average(measures.map((measure) => measure.ram));

export const getRamStats = (iterations: IterationSummary[], averageRam?: number) => {
  if (averageRam === undefined) return undefined;

  const values = iterations.flatMap((iteration) =>
    iteration.ram !== undefined ? [iteration.ram] : []
  );

  return getValuesStats(values, averageRam);
};

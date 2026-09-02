import { Measure } from "@lantern/types";
import { getStandardDeviation } from "../utils/getStandardDeviation";
import { getValuesStats } from "../utils/getValuesStats";
import { average } from "./averageIterations";
import type { IterationSummary } from "./iterationSummary";

export const getAverageFPSUsage = (measures: Measure[]) =>
  average(measures.map((measure) => measure.fps));

const getFpsValues = (iterations: IterationSummary[]) =>
  iterations.flatMap((iteration) => (iteration.fps !== undefined ? [iteration.fps] : []));

export const getStandardDeviationFPS = (iterations: IterationSummary[]) =>
  getStandardDeviation({ values: getFpsValues(iterations) });

export const getFpsStats = (iterations: IterationSummary[], averageFps?: number) => {
  if (averageFps === undefined) return undefined;

  return getValuesStats(getFpsValues(iterations), averageFps);
};

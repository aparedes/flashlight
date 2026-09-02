import { getValuesStats } from "../utils/getValuesStats";
import type { IterationSummary } from "./iterationSummary";

export const getRuntimeStats = (iterations: IterationSummary[], averageRuntime: number) =>
  getValuesStats(
    iterations.map((iteration) => iteration.time),
    averageRuntime
  );

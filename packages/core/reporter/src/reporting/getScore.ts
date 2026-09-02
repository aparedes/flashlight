import { AveragedTestCaseResult } from "@lantern/types";
import { roundToDecimal } from "../utils/round";
import { average } from "./averageIterations";
import { getAverageCpuUsage } from "./cpu";
import { getAverageFPSUsage } from "./fps";
import { canComputeHighCpuUsage, getThreadLockedRatio } from "./highCpu";

/**
 * Linear fit of the points (50, 100), (200, 50), (300, 15) — the original link
 * (https://www.mathcelebrity.com/3ptquad.php?p1=50%2C100&p2=200%2C50&p3=300%2C15&pl=Calculate+Equation)
 * asked for a quadratic, but the coefficients kept here describe a straight line.
 * Clamped to [0, 100].
 */
const calculateCpuScore = (x: number) => Math.min(Math.max(0, -0.31666666666667 * x + 116), 100);

const clampToPercentage = (value: number) => Math.min(Math.max(0, value), 100);

/**
 * Share of the run (in [0, 1]) during which at least one thread was locking its CPU: the
 * per-iteration fraction of "locked" polls, averaged over the non-failed iterations. Falls
 * back to the averaged measures when no such iteration has measures.
 */
const getTimePercentageThreadlocked = (result: AveragedTestCaseResult) => {
  if (!canComputeHighCpuUsage(result)) return 0;

  const iterationsWithMeasures = result.iterations.filter(
    (iteration) => iteration.status !== "FAILURE" && iteration.measures.length > 0
  );
  const ratios =
    iterationsWithMeasures.length > 0
      ? iterationsWithMeasures.map((iteration) => getThreadLockedRatio(iteration.measures))
      : [getThreadLockedRatio(result.average.measures)];

  return Math.min(Math.max(0, average(ratios)), 1);
};

export const getScore = (result: AveragedTestCaseResult) => {
  if (result.average.measures.length === 0) return 0;

  const averageUIFPS = getAverageFPSUsage(result.average.measures);
  const averageCPUUsage = getAverageCpuUsage(result.average.measures);

  const scores = [calculateCpuScore(averageCPUUsage)];

  if (averageUIFPS !== undefined) {
    const fpsScore = (averageUIFPS * 100) / (result?.specs?.refreshRate ?? 60);
    scores.push(clampToPercentage(fpsScore));
  }

  const timePercentageThreadlocked = getTimePercentageThreadlocked(result);

  return roundToDecimal(clampToPercentage(average(scores) * (1 - timePercentageThreadlocked)), 0);
};

import { POLLING_INTERVAL, AveragedTestCaseResult } from "@lantern/types";
import { roundToDecimal } from "@lantern/reporter";

type OptionalStat = "ram" | "fps";

/**
 * Whether every measure of every result carries `stat`. A section is hidden while this is false
 * — as a plain predicate re-evaluated on each render, unlike the former error boundary, which
 * latched on the first missing value and kept the section hidden even once values arrived.
 */
export const hasValueForEveryMeasure = (results: AveragedTestCaseResult[], stat: OptionalStat) =>
  results.every((result) =>
    result.average.measures.every((measure) => measure[stat] !== undefined)
  );

/** Measures without the stat are left out, so a missing value shows as a gap, not a crash. */
export const buildValueGraph = ({
  results,
  stat,
}: {
  results: AveragedTestCaseResult[];
  stat: OptionalStat;
}) =>
  results.map((result) => ({
    name: result.name,
    data: result.average.measures.flatMap((measure, i) => {
      const value = measure[stat];
      if (value === undefined) return [];

      return [{ x: i * POLLING_INTERVAL, y: roundToDecimal(value, 0) }];
    }),
  }));

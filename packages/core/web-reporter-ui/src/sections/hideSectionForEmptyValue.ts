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

/**
 * A measure without the stat becomes a `null` point, which ApexCharts renders as a gap in the
 * line. Dropping the point instead would make the chart interpolate straight across it.
 */
export const buildValueGraph = ({
  results,
  stat,
}: {
  results: AveragedTestCaseResult[];
  stat: OptionalStat;
}) =>
  results.map((result) => ({
    name: result.name,
    data: result.average.measures.map((measure, i) => {
      const value = measure[stat];

      return { x: i * POLLING_INTERVAL, y: value === undefined ? null : roundToDecimal(value, 0) };
    }),
  }));

import { roundToDecimal } from "./round";

/**
 * Population standard deviation of `values`, computed around their own mean so the returned
 * range is always centered on the data (and never on a rounded / differently-based average).
 * Empty input yields a deviation of 0 and a [0, 0] range instead of NaN.
 */
export const getStandardDeviation = ({
  values,
}: {
  values: number[];
}): {
  deviation: number;
  deviationRange: [number, number];
} => {
  if (values.length === 0) {
    return { deviation: 0, deviationRange: [0, 0] };
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((acc, val) => {
      const ecart = val - mean;
      return acc + ecart * ecart;
    }, 0) / values.length;

  const deviation = Math.sqrt(variance);
  return {
    deviation,
    // Not `.map(roundToDecimal)`: the index would be passed as the decimal count.
    deviationRange: [roundToDecimal(mean - deviation), roundToDecimal(mean + deviation)],
  };
};

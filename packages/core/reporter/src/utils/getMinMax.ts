import { roundToDecimal } from "./round";

/** Rounded [min, max] of `values`; [0, 0] for empty input instead of [Infinity, -Infinity]. */
export const getMinMax = (values: number[]): [number, number] => {
  if (values.length === 0) {
    return [0, 0];
  }
  // Not `.map(roundToDecimal)`: the index would be passed as the decimal count.
  return [roundToDecimal(Math.min(...values)), roundToDecimal(Math.max(...values))];
};

import { describe, it, expect } from "bun:test";
import { getStandardDeviation } from "../getStandardDeviation";

describe("getStandardDeviation", () => {
  it("computes the population deviation around the mean of the values", () => {
    const { deviation, deviationRange } = getStandardDeviation({
      values: [2, 4, 4, 4, 5, 5, 7, 9],
    });
    expect(deviation).toBe(2);
    expect(deviationRange).toEqual([3, 7]);
  });

  it("centers the range on the values' own mean and rounds it", () => {
    const { deviationRange } = getStandardDeviation({ values: [10, 20, 40] });
    // mean 23.33, deviation 12.47
    expect(deviationRange).toEqual([10.9, 35.8]);
  });

  it("returns 0 for a single value", () => {
    expect(getStandardDeviation({ values: [42] })).toEqual({
      deviation: 0,
      deviationRange: [42, 42],
    });
  });

  it("returns a zeroed result on empty input instead of NaN", () => {
    expect(getStandardDeviation({ values: [] })).toEqual({
      deviation: 0,
      deviationRange: [0, 0],
    });
  });
});

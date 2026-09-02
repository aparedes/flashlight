import { describe, it, expect } from "bun:test";
import { getMinMax } from "../getMinMax";

describe("getMinMax", () => {
  it("returns the rounded min and max", () => {
    expect(getMinMax([3.14, 1.26, 2.5])).toEqual([1.3, 3.1]);
  });

  it("returns [value, value] for a single value", () => {
    expect(getMinMax([7])).toEqual([7, 7]);
  });

  it("returns [0, 0] on empty input instead of [Infinity, -Infinity]", () => {
    expect(getMinMax([])).toEqual([0, 0]);
  });
});

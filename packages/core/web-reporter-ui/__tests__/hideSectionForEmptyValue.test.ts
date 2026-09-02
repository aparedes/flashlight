import { describe, it, expect } from "bun:test";
import { AveragedTestCaseResult, Measure, POLLING_INTERVAL } from "@lantern/types";
import { buildValueGraph, hasValueForEveryMeasure } from "../src/sections/hideSectionForEmptyValue";

const aMeasure = (values: { fps?: number; ram?: number }): Measure => ({
  cpu: { perName: {}, perCore: {} },
  ...values,
  time: 0,
});

const aResult = (name: string, measures: Measure[]): AveragedTestCaseResult =>
  ({
    name,
    status: "SUCCESS",
    iterations: [],
    average: { measures, time: measures.length * POLLING_INTERVAL, status: "SUCCESS" },
  }) as unknown as AveragedTestCaseResult;

describe("hasValueForEveryMeasure", () => {
  it("is true when every measure of every result has the stat", () => {
    const results = [
      aResult("a", [aMeasure({ fps: 60 }), aMeasure({ fps: 58 })]),
      aResult("b", [aMeasure({ fps: 30 })]),
    ];

    expect(hasValueForEveryMeasure(results, "fps")).toBe(true);
  });

  it("is false as soon as one measure misses the stat, and true again once it is there", () => {
    const withoutFps = [aResult("a", [aMeasure({ fps: 60 }), aMeasure({ ram: 200 })])];
    expect(hasValueForEveryMeasure(withoutFps, "fps")).toBe(false);

    // Unlike the former error boundary, nothing latches: the same call with complete data passes.
    const withFps = [aResult("a", [aMeasure({ fps: 60 }), aMeasure({ ram: 200, fps: 59 })])];
    expect(hasValueForEveryMeasure(withFps, "fps")).toBe(true);
  });

  it("is true for no results at all", () => {
    expect(hasValueForEveryMeasure([], "ram")).toBe(true);
  });
});

describe("buildValueGraph", () => {
  it("builds one rounded data point per measure, on the polling interval", () => {
    const results = [aResult("a", [aMeasure({ ram: 100.4 }), aMeasure({ ram: 120.6 })])];

    expect(buildValueGraph({ results, stat: "ram" })).toEqual([
      {
        name: "a",
        data: [
          { x: 0, y: 100 },
          { x: POLLING_INTERVAL, y: 121 },
        ],
      },
    ]);
  });

  it("leaves a gap instead of throwing when a measure misses the stat", () => {
    const results = [aResult("a", [aMeasure({ fps: 60 }), aMeasure({}), aMeasure({ fps: 30 })])];

    expect(buildValueGraph({ results, stat: "fps" })).toEqual([
      {
        name: "a",
        data: [
          { x: 0, y: 60 },
          { x: 2 * POLLING_INTERVAL, y: 30 },
        ],
      },
    ]);
  });
});

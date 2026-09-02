import { describe, it, expect } from "bun:test";
import { AveragedTestCaseResult, Measure, POLLING_INTERVAL } from "@lantern/types";
import { getScore } from "../getScore";
import { averageTestCaseResult } from "../averageIterations";

const measure = (perName: { [processName: string]: number }, fps?: number): Measure => ({
  cpu: { perCore: {}, perName },
  fps,
  ram: 100,
  time: POLLING_INTERVAL,
});

const buildResult = (
  iterations: Measure[][],
  specs?: AveragedTestCaseResult["specs"]
): AveragedTestCaseResult =>
  averageTestCaseResult({
    name: "test",
    status: "SUCCESS",
    iterations: iterations.map((measures) => ({ measures, time: 1000, status: "SUCCESS" })),
    specs,
  });

describe("getScore", () => {
  it("returns 0 instead of NaN when there are no measures", () => {
    expect(getScore(buildResult([]))).toBe(0);
    expect(getScore(buildResult([[]]))).toBe(0);
  });

  it("scores a run with low CPU and full FPS at 100", () => {
    // cpu 50 -> 100, fps 60/60 -> 100
    expect(getScore(buildResult([[measure({ UI: 50 }, 60)]]))).toBe(100);
  });

  it("clamps the FPS sub-score to 100 when the FPS exceed the refresh rate", () => {
    const withOvershoot = getScore(buildResult([[measure({ UI: 50 }, 90)]], { refreshRate: 60 }));
    const withExact = getScore(buildResult([[measure({ UI: 50 }, 60)]], { refreshRate: 60 }));
    expect(withOvershoot).toBe(withExact);
    expect(withOvershoot).toBe(100);
  });

  it("clamps the final score to [0, 100]", () => {
    expect(getScore(buildResult([[measure({ UI: 1000 }, 0)]]))).toBe(0);
  });

  it("counts a poll where several threads are busy only once in the thread-locked ratio", () => {
    // Every poll has two threads above 90%: the old formula gave 200% locked time -> negative
    // score clamped to 0. Now the run is 100% locked, so the score is 0 as well, but a run
    // that is locked half of the time must keep half of its score.
    const busy = measure({ UI: 95, JS: 95 }, 60);
    const idle = measure({ UI: 5, JS: 5 }, 60);
    // cpu average: (190 + 10) / 2 = 100 -> 84.33; fps -> 100; average 92.17
    expect(getScore(buildResult([[busy, idle]]))).toBe(46);
    expect(getScore(buildResult([[busy, busy]]))).toBe(0);
  });

  it("averages the thread-locked ratio over iterations", () => {
    const busy = measure({ UI: 95, JS: 5 }, 60);
    const idle = measure({ UI: 5, JS: 5 }, 60);
    // iteration 1 locked 100%, iteration 2 locked 0% -> 50% locked
    // averaged cpu: (100 + 10) / 2 = 55 -> 98.58; fps 100 -> 99.29 * 0.5
    expect(
      getScore(
        buildResult([
          [busy, busy],
          [idle, idle],
        ])
      )
    ).toBe(50);
  });

  it("ignores high CPU usage when the only thread is 'Total'", () => {
    expect(getScore(buildResult([[measure({ Total: 95 }, 60)]]))).toBe(93);
  });
});

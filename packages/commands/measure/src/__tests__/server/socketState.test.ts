import { describe, it, expect } from "bun:test";
import { Measure, POLLING_INTERVAL } from "@lantern/types";
import { addNewResultReducer, updateMeasuresReducer } from "../../socket/socketState";
import { SocketData } from "../../socket/socketInterface";

const emptyState: SocketData = {
  isMeasuring: false,
  bundleId: null,
  results: [],
  platform: "android",
  apps: [],
};

const aMeasure = (): Measure => ({ cpu: { perName: {}, perCore: {} }, ram: 100, time: 0 });

describe("updateMeasuresReducer", () => {
  it("leaves the state untouched when there is no result to update", () => {
    // A poll can still land after RESET emptied the results.
    const state = updateMeasuresReducer(emptyState, [aMeasure()]);

    expect(state).toBe(emptyState);
    expect(state.results).toEqual([]);
  });

  it("replaces the measures of the last result", () => {
    const withResults = addNewResultReducer(
      addNewResultReducer(emptyState, "com.example", 60),
      "com.example (2)",
      60
    );

    const measures = [aMeasure(), aMeasure()];
    const state = updateMeasuresReducer(withResults, measures);

    expect(state.results).toHaveLength(2);
    expect(state.results[0]).toBe(withResults.results[0]);
    expect(state.results[1].name).toBe("com.example (2)");
    expect(state.results[1].iterations).toEqual([
      { measures, time: 2 * POLLING_INTERVAL, status: "SUCCESS" },
    ]);
  });
});

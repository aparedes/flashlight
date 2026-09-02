import { describe, it, expect } from "bun:test";
import { TestCaseIterationResult } from "@lantern/types";
import { getTestCaseStatus } from "../writeReport";

const iteration = (
  status: TestCaseIterationResult["status"],
  isRetriedIteration?: boolean
): TestCaseIterationResult => ({ time: 0, measures: [], status, isRetriedIteration });

describe("getTestCaseStatus", () => {
  it("fails when there are no iterations", () => {
    expect(getTestCaseStatus([])).toBe("FAILURE");
  });

  it("succeeds when all iterations succeeded", () => {
    expect(getTestCaseStatus([iteration("SUCCESS"), iteration("SUCCESS")])).toBe("SUCCESS");
  });

  it("fails when any iteration failed, not only the last one", () => {
    expect(getTestCaseStatus([iteration("FAILURE"), iteration("SUCCESS")])).toBe("FAILURE");
    expect(getTestCaseStatus([iteration("SUCCESS"), iteration("FAILURE")])).toBe("FAILURE");
  });

  it("ignores failed iterations that were retried", () => {
    expect(getTestCaseStatus([iteration("FAILURE", true), iteration("SUCCESS")])).toBe("SUCCESS");
  });
});

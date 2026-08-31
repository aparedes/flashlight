import { Logger } from "@lantern/logger";
import { averageTestCaseResult } from "@lantern/reporter";
import { AveragedTestCaseResult, TestCaseIterationResult, TestCaseResult } from "@lantern/types";
import fs from "fs";

export const writeReport = (
  measures: TestCaseIterationResult[],
  {
    filePath,
    title,
    overrideScore,
  }: {
    filePath: string;
    title: string;
    overrideScore?: (result: AveragedTestCaseResult) => number;
  }
) => {
  const testCase: TestCaseResult = {
    name: title,
    iterations: measures,
    status:
      measures.length === 0 || measures[measures.length - 1].status === "FAILURE"
        ? "FAILURE"
        : "SUCCESS",
  };

  /**
   * Might not be the best place to put this since this is reporting
   * and not really measuring
   */
  if (overrideScore) {
    const averagedResult: AveragedTestCaseResult = averageTestCaseResult(testCase);
    testCase.score = Math.max(0, Math.min(overrideScore(averagedResult), 100));
  }

  fs.writeFileSync(filePath, JSON.stringify(testCase));

  Logger.success(
    `Results written to ${filePath}.
To open the web report, run:

lantern report ${filePath}`
  );
};

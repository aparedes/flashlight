import { describe, it, expect } from "bun:test";
import { Measure, TestCaseIterationResult, TestCaseResult } from "@perf-profiler/types";
import { getMeasuresForTimeInterval, injectResults } from "../writeReport";

const mockMeasure = (name: string) => {
  // We're just mocking measure to make tests more readable here
  return name as unknown as Measure;
};

const mockResultIteration = (name: string[]): TestCaseIterationResult => ({
  measures: name.map(mockMeasure),
  time: 0,
  status: "SUCCESS",
});

describe("getMeasuresForTimeInterval", () => {
  it("throws if skip or duration are not multiple or time interval", () => {
    expect(() =>
      getMeasuresForTimeInterval({ duration: 600, results: [], skip: 0 })
    ).toThrowErrorMatchingInlineSnapshot(
      `"Only multiples of the measure interval (500ms) are supported"`
    );

    expect(() =>
      getMeasuresForTimeInterval({ duration: null, results: [], skip: 600 })
    ).toThrowErrorMatchingInlineSnapshot(
      `"Only multiples of the measure interval (500ms) are supported"`
    );
  });

  it("doesn't cut measures by default", () => {
    const RESULT: TestCaseResult = {
      iterations: [
        mockResultIteration(["ITERATION1_0_ms", "ITERATION1_500_ms", "ITERATION1_1000_ms"]),
        mockResultIteration(["ITERATION2_0_ms", "ITERATION2_500_ms"]),
      ],
      name: "Result",
      status: "SUCCESS",
    };

    expect(
      getMeasuresForTimeInterval({
        duration: null,
        skip: 0,
        results: [RESULT],
      })
    ).toEqual([RESULT]);
  });

  it("skips first measures", () => {
    const RESULT: TestCaseResult = {
      iterations: [
        mockResultIteration(["ITERATION1_0_ms", "ITERATION1_500_ms", "ITERATION1_1000_ms"]),
        mockResultIteration(["ITERATION2_0_ms", "ITERATION2_500_ms"]),
      ],
      name: "Result",
      status: "SUCCESS",
    };

    expect(
      getMeasuresForTimeInterval({
        duration: null,
        skip: 1000,
        results: [RESULT],
      })
    ).toEqual([
      {
        iterations: [mockResultIteration(["ITERATION1_1000_ms"]), mockResultIteration([])],
        name: "Result",
        status: "SUCCESS",
      },
    ]);
  });

  it("cuts measures between 500ms and 1.5s", () => {
    expect(
      getMeasuresForTimeInterval({
        duration: 1000,
        skip: 500,
        results: [
          {
            iterations: [
              mockResultIteration([
                "ITERATION1_0_ms",
                "ITERATION1_500_ms",
                "ITERATION1_1000_ms",
                "ITERATION1_1500_ms",
                "ITERATION1_2000_ms",
                "ITERATION1_2500_ms",
              ]),
              mockResultIteration(["ITERATION2_0_ms", "ITERATION2_500_ms"]),
            ],
            name: "Result 1",
            status: "SUCCESS",
          },
          {
            iterations: [
              mockResultIteration([
                "ITERATION3_0_ms",
                "ITERATION3_500_ms",
                "ITERATION3_1000_ms",
                "ITERATION3_1500_ms",
              ]),
            ],
            name: "Result 2",
            status: "SUCCESS",
          },
        ],
      })
    ).toEqual([
      {
        iterations: [
          mockResultIteration(["ITERATION1_500_ms", "ITERATION1_1000_ms", "ITERATION1_1500_ms"]),
          mockResultIteration(["ITERATION2_500_ms"]),
        ],
        name: "Result 1",
        status: "SUCCESS",
      },
      {
        iterations: [
          mockResultIteration(["ITERATION3_500_ms", "ITERATION3_1000_ms", "ITERATION3_1500_ms"]),
        ],
        name: "Result 2",
        status: "SUCCESS",
      },
    ]);
  });
});

describe("injectResults", () => {
  const PLACEHOLDER =
    "THIS_IS_A_VERY_LONG_STRING_THAT_IS_UNLIKELY_TO_BE_FOUND_IN_A_TEST_CASE_RESULT";

  const mockResult = (name: string): TestCaseResult => ({
    iterations: [mockResultIteration([])],
    name,
    status: "SUCCESS",
  });

  it("replaces the placeholder in the single-file HTML", () => {
    const html = `<html><script>let r="${PLACEHOLDER}";</script></html>`;

    expect(injectResults(html, [mockResult("Result")])).toBe(
      `<html><script>let r=${JSON.stringify([mockResult("Result")])};</script></html>`
    );
  });

  it("replaces the placeholder when the minifier quoted it as a template literal", () => {
    const html = `<html><script>let r=\`${PLACEHOLDER}\`;</script></html>`;

    expect(injectResults(html, [])).toBe(`<html><script>let r=[];</script></html>`);
  });

  it("escapes `<` so that data cannot close the inline script", () => {
    const html = `<html><script>let r="${PLACEHOLDER}";</script></html>`;

    const output = injectResults(html, [mockResult("</script><script>alert(1)</script>")]);

    expect(output).toContain("\\u003c/script>\\u003cscript>alert(1)\\u003c/script>");
    expect(output.match(/<script>/g)).toHaveLength(1);
    expect(
      JSON.parse(output.slice(output.indexOf("let r=") + 6, output.indexOf(";</script>")))
    ).toEqual([mockResult("</script><script>alert(1)</script>")]);
  });

  it("does not interpret `$` sequences in the data as replacement patterns", () => {
    const html = `<html><script>let r="${PLACEHOLDER}";</script></html>`;

    const output = injectResults(html, [mockResult("$& $` $' $1 $$")]);

    expect(output).toContain(JSON.stringify("$& $` $' $1 $$"));
  });

  it("throws when the placeholder is missing", () => {
    expect(() => injectResults("<html></html>", [])).toThrowErrorMatchingInlineSnapshot(
      `"Could not find the results placeholder in the report HTML"`
    );
  });
});

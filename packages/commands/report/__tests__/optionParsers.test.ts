import { describe, it, expect } from "bun:test";
import { parseDuration, parseSkip } from "../optionParsers";

describe("parseDuration", () => {
  it("accepts positive multiples of the polling interval", () => {
    expect(parseDuration("500")).toBe(500);
    expect(parseDuration("10000")).toBe(10000);
  });

  it.each(["0", "-500", "abc", "500abc", "1.5"])("rejects %j", (value) => {
    expect(() => parseDuration(value)).toThrowError("Expected a positive integer.");
  });

  it("rejects values that are not a multiple of the polling interval", () => {
    expect(() => parseDuration("600")).toThrowError(
      "Expected a multiple of the measure interval (500ms)."
    );
  });
});

describe("parseSkip", () => {
  it("accepts zero and positive multiples of the polling interval", () => {
    expect(parseSkip("0")).toBe(0);
    expect(parseSkip("1500")).toBe(1500);
  });

  it.each(["-500", "abc", ""])("rejects %j", (value) => {
    expect(() => parseSkip(value)).toThrowError("Expected a non-negative integer.");
  });

  it("rejects values that are not a multiple of the polling interval", () => {
    expect(() => parseSkip("700")).toThrowError(
      "Expected a multiple of the measure interval (500ms)."
    );
  });
});

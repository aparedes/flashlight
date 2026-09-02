import { describe, it, expect } from "bun:test";
import {
  parseBitRate,
  parseDuration,
  parseNonNegativeInteger,
  parsePositiveInteger,
} from "../commands/optionParsers";

describe("parsePositiveInteger", () => {
  it("parses positive integers", () => {
    expect(parsePositiveInteger("10")).toBe(10);
    expect(parsePositiveInteger("1")).toBe(1);
  });

  it.each(["0", "-3", "abc", "10abc", "1.5", "", "NaN"])("rejects %j", (value) => {
    expect(() => parsePositiveInteger(value)).toThrowError("Expected a positive integer.");
  });
});

describe("parseNonNegativeInteger", () => {
  it("accepts zero", () => {
    expect(parseNonNegativeInteger("0")).toBe(0);
    expect(parseNonNegativeInteger("3")).toBe(3);
  });

  it.each(["-1", "abc", "1.5", ""])("rejects %j", (value) => {
    expect(() => parseNonNegativeInteger(value)).toThrowError("Expected a non-negative integer.");
  });
});

describe("parseDuration", () => {
  it("accepts multiples of the polling interval", () => {
    expect(parseDuration("500")).toBe(500);
    expect(parseDuration("10000")).toBe(10000);
  });

  it("rejects durations that are not a multiple of the polling interval", () => {
    expect(() => parseDuration("600")).toThrowError(
      "Expected a multiple of the measure interval (500ms)."
    );
  });

  it.each(["0", "-500", "abc"])("rejects %j", (value) => {
    expect(() => parseDuration(value)).toThrowError("Expected a positive integer.");
  });
});

describe("parseBitRate", () => {
  it("accepts bits and megabits", () => {
    expect(parseBitRate("4000000")).toBe(4000000);
    expect(parseBitRate("4M")).toBe(4000000);
    expect(parseBitRate("8m")).toBe(8000000);
  });

  it.each(["0", "0M", "-4M", "4G", "abc", "", "4.5M"])("rejects %j", (value) => {
    expect(() => parseBitRate(value)).toThrowError("Expected a positive bit rate");
  });
});

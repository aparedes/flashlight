import { describe, it, expect } from "bun:test";
import { isProMotionModel } from "../index";

describe("isProMotionModel", () => {
  it("detects ProMotion iPhones", () => {
    expect(isProMotionModel("iPhone14,2")).toBe(true); // 13 Pro
    expect(isProMotionModel("iPhone15,3")).toBe(true); // 14 Pro Max
    expect(isProMotionModel("iPhone18,1")).toBe(true); // 17, whole line is ProMotion
  });

  it("does not flag 60 Hz iPhones", () => {
    expect(isProMotionModel("iPhone14,5")).toBe(false); // 13
    expect(isProMotionModel("iPhone17,5")).toBe(false); // 16e
  });

  it("only flags iPad Pro models", () => {
    expect(isProMotionModel("iPad16,3")).toBe(true); // M4 iPad Pro
    expect(isProMotionModel("iPad13,1")).toBe(false); // iPad Air 4
  });

  it("returns false for anything it cannot parse", () => {
    expect(isProMotionModel("garbage")).toBe(false);
  });
});

import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { DeviceInfo } from "@lantern/types";
import { PlatformResolutionError, resolvePlatform } from "../index";

const originalPlatformEnv = process.env.PLATFORM;

const androidDevice: DeviceInfo = { id: "R58M12345Z", name: "Pixel 7", platform: "android" };
const iosDevice: DeviceInfo = {
  id: "00008130-000",
  name: "iPhone",
  platform: "ios",
  model: "iPhone16,1",
};

const probe = (android: DeviceInfo[], ios: DeviceInfo[]) => ({
  android: () => android,
  ios: () => ios,
});

beforeEach(() => {
  delete process.env.PLATFORM;
});

afterAll(() => {
  if (originalPlatformEnv === undefined) {
    delete process.env.PLATFORM;
  } else {
    process.env.PLATFORM = originalPlatformEnv;
  }
});

describe("resolvePlatform", () => {
  it("gives priority to the flag", () => {
    process.env.PLATFORM = "android";

    expect(resolvePlatform("ios", probe([androidDevice], []))).toBe("ios");
  });

  it("rejects an unknown flag", () => {
    expect(() => resolvePlatform("windows", probe([androidDevice], []))).toThrow(
      PlatformResolutionError
    );
  });

  it("falls back to the PLATFORM env var", () => {
    process.env.PLATFORM = "ios";

    expect(resolvePlatform(undefined, probe([androidDevice], []))).toBe("ios");
  });

  it("auto-detects an android device", () => {
    expect(resolvePlatform(undefined, probe([androidDevice], []))).toBe("android");
  });

  it("auto-detects an ios device", () => {
    expect(resolvePlatform(undefined, probe([], [iosDevice]))).toBe("ios");
  });

  it("asks for --platform when both platforms have a device", () => {
    expect(() => resolvePlatform(undefined, probe([androidDevice], [iosDevice]))).toThrow(
      /--platform/
    );
  });

  it("asks the user to connect a device when none is found", () => {
    expect(() => resolvePlatform(undefined, probe([], []))).toThrow(/No device found/);
  });
});

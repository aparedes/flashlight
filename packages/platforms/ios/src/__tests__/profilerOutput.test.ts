import { EventEmitter } from "events";
import { PassThrough } from "stream";
import * as childProcess from "child_process";
import { afterAll, afterEach, describe, expect, it, jest, mock, spyOn } from "bun:test";
import { Logger } from "@lantern/logger";
import { IOSProfiler, iosErrorMessage, parseProfilerLine } from "../index";

describe("iosErrorMessage", () => {
  it("returns the message of the only error marker", () => {
    expect(iosErrorMessage("IOS_PROFILER_ERROR_NO_DEVICE: no device found\n")).toBe(
      "no device found"
    );
  });

  it("picks the last error marker so context lines do not mask the failure", () => {
    const stderr = [
      "IOS_PROFILER_ERROR_SERVICE_FAILED: application listing: Closed",
      "some idevice debug output",
      "IOS_PROFILER_ERROR_APP_NOT_FOUND: com.example is not running",
    ].join("\n");

    expect(iosErrorMessage(stderr)).toBe("com.example is not running");
  });

  it("ignores WARN markers", () => {
    const stderr = [
      "IOS_PROFILER_WARN_TUNNEL_FAILED: CoreDevice tunnel unavailable, trying lockdown fallback",
      "IOS_PROFILER_ERROR_SERVICE_FAILED: instruments: Closed",
    ].join("\n");

    expect(iosErrorMessage(stderr)).toBe("instruments: Closed");
    expect(
      iosErrorMessage("IOS_PROFILER_WARN_TUNNEL_FAILED: CoreDevice tunnel unavailable\n")
    ).toBeUndefined();
  });

  it("returns undefined when there is no marker", () => {
    expect(iosErrorMessage("")).toBeUndefined();
    expect(iosErrorMessage("Command failed with exit code 1")).toBeUndefined();
  });
});

describe("parseProfilerLine", () => {
  it("parses NDJSON lines with a string type", () => {
    expect(parseProfilerLine('{"type":"status","event":"started"}')).toEqual({
      type: "status",
      event: "started",
    });
  });

  it("rejects anything that is not one of the binary's line objects", () => {
    expect(parseProfilerLine("not json")).toBeUndefined();
    expect(parseProfilerLine("null")).toBeUndefined();
    expect(parseProfilerLine("42")).toBeUndefined();
    expect(parseProfilerLine('{"event":"started"}')).toBeUndefined();
    expect(parseProfilerLine('{"type":7}')).toBeUndefined();
  });
});

interface MockChild extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: jest.Mock<(signal?: NodeJS.Signals) => boolean>;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
}

// Minimal spawn stand-in: readline needs real streams, the profiler needs close/error events
const mockSpawn = (): MockChild => {
  const child = new EventEmitter() as MockChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = jest.fn(() => true);
  child.exitCode = null;
  child.signalCode = null;

  spyOn(childProcess, "spawn").mockImplementationOnce(((command: string, args: string[]) => {
    expect(command.endsWith("lantern-ios-profiler")).toBe(true);
    expect(args.slice(0, 3)).toEqual(["poll", "--bundle-id", "com.example"]);
    return child;
  }) as unknown as typeof childProcess.spawn);

  return child;
};

// readline dispatches "line" events asynchronously
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("IOSProfiler.pollPerformanceMeasures", () => {
  const debug = spyOn(Logger, "debug").mockImplementation(() => {});
  const warn = spyOn(Logger, "warn").mockImplementation(() => {});
  const error = spyOn(Logger, "error").mockImplementation(() => {});

  afterEach(() => {
    debug.mockClear();
    warn.mockClear();
    error.mockClear();
  });

  afterAll(() => mock.restore());

  it("dispatches measure and status lines and ignores the rest", async () => {
    const child = mockSpawn();
    const onMeasure = jest.fn();
    const onStartMeasuring = jest.fn();

    new IOSProfiler().pollPerformanceMeasures("com.example", { onMeasure, onStartMeasuring });

    child.stdout.write(
      [
        '{"type":"status","event":"started","detail":"polling com.example every 500ms"}',
        '{"type":"measure","time":1700000000000,"cpu":{"perName":{"Total":25.5},"perCore":{}},"ram":123.4,"fps":59.9,"threadCount":17,"pid":1234}',
        "garbage",
        '{"event":"target","pid":1234}',
        '{"type":"status","event":"stalled","detail":"no sysmontap sample for 12s"}',
        "",
      ].join("\n")
    );
    await flush();

    expect(onStartMeasuring).toHaveBeenCalledTimes(1);
    expect(onMeasure).toHaveBeenCalledTimes(1);
    expect(onMeasure).toHaveBeenCalledWith({
      cpu: { perName: { Total: 25.5 }, perCore: {} },
      ram: 123.4,
      fps: 59.9,
      time: 1700000000000,
    });
    expect(debug).toHaveBeenCalledWith("Unparseable profiler output: garbage");
    expect(debug).toHaveBeenCalledWith(
      'Unparseable profiler output: {"event":"target","pid":1234}'
    );
    expect(warn).toHaveBeenCalledWith("iOS profiler: stalled (no sysmontap sample for 12s)");
  });

  it("logs stderr markers at the matching level", async () => {
    const child = mockSpawn();
    new IOSProfiler().pollPerformanceMeasures("com.example", { onMeasure: jest.fn() });

    child.stderr.write(
      [
        "IOS_PROFILER_WARN_TUNNEL_FAILED: CoreDevice tunnel unavailable, trying lockdown fallback",
        "IOS_PROFILER_ERROR_STREAM_ENDED: sysmontap: Closed",
        "idevice noise",
        "",
      ].join("\n")
    );
    await flush();

    expect(warn).toHaveBeenCalledWith(
      "IOS_PROFILER_WARN_TUNNEL_FAILED: CoreDevice tunnel unavailable, trying lockdown fallback"
    );
    expect(error).toHaveBeenCalledWith("IOS_PROFILER_ERROR_STREAM_ENDED: sysmontap: Closed");
    expect(debug).toHaveBeenCalledWith("idevice noise");
  });

  it("reports an unexpected exit through onEnd and the logger", () => {
    const child = mockSpawn();
    const onEnd = jest.fn();
    new IOSProfiler().pollPerformanceMeasures("com.example", { onMeasure: jest.fn(), onEnd });

    child.emit("close", 1, null);

    expect(onEnd).toHaveBeenCalledWith("lantern-ios-profiler exited unexpectedly (code 1)");
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain("exited unexpectedly (code 1)");
  });

  it("stop() sends SIGINT, escalates to SIGKILL when the child lingers, and is not an error", () => {
    jest.useFakeTimers();
    try {
      const child = mockSpawn();
      const onEnd = jest.fn();
      const { stop } = new IOSProfiler().pollPerformanceMeasures("com.example", {
        onMeasure: jest.fn(),
        onEnd,
      });

      stop();
      expect(child.kill).toHaveBeenCalledWith("SIGINT");
      expect(child.kill).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(3000);
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");

      child.signalCode = "SIGKILL";
      child.emit("close", null, "SIGKILL");
      expect(onEnd).toHaveBeenCalledWith("stopped (signal SIGKILL)");
      expect(error).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("stop() does not SIGKILL a child that exited in time", () => {
    jest.useFakeTimers();
    try {
      const child = mockSpawn();
      const { stop } = new IOSProfiler().pollPerformanceMeasures("com.example", {
        onMeasure: jest.fn(),
      });

      stop();
      child.exitCode = 0;
      child.emit("close", 0, null);
      jest.advanceTimersByTime(3000);

      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(child.kill).toHaveBeenCalledWith("SIGINT");
    } finally {
      jest.useRealTimers();
    }
  });
});

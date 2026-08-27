import EventEmitter from "events";
import * as childProcess from "child_process";
import { ChildProcess } from "child_process";
import fs from "fs";
import { expect, jest, spyOn } from "bun:test";

const mockSpawn = (): ChildProcess => {
  const mockProcess = new EventEmitter();
  // @ts-expect-error
  mockProcess.stdout = new EventEmitter();

  // @ts-expect-error
  mockProcess.stderr = new EventEmitter();

  // @ts-expect-error
  mockProcess.kill = jest.fn();

  // @ts-expect-error
  return mockProcess;
};

export const aTraceMock = mockSpawn();
export const perfProfilerMock = mockSpawn();

spyOn(require("child_process") as typeof childProcess, "spawn")
  .mockImplementationOnce(((command: string, args: readonly string[]) => {
    expect([command, args]).toEqual(["adb", ["shell", "atrace", "-c", "view", "-t", "999"]]);
    return aTraceMock;
  }) as unknown as typeof childProcess.spawn)
  .mockImplementationOnce(((command: string, args: readonly string[]) => {
    expect([command, args]).toEqual([
      "adb",
      ["shell", "/data/local/tmp/BAMPerfProfiler", "pollPerformanceMeasures", "com.example", "500"],
    ]);
    return perfProfilerMock;
  }) as unknown as typeof childProcess.spawn);

export const emitMeasure = (measureIndex: number) => {
  const cpuOutput: string = fs.readFileSync(
    `${__dirname}/sample-command-output-${measureIndex === 0 ? "1" : "2"}.txt`,
    "utf8"
  );
  const aTraceOutput: string = fs.readFileSync(`${__dirname}/sample-atrace-output.txt`, "utf8");

  perfProfilerMock.stdout?.emit(
    "data",
    `=START MEASURE=
123456
=SEPARATOR=
${cpuOutput}
=SEPARATOR=
4430198 96195 58113 3 0 398896 0
=SEPARATOR=
${aTraceOutput}
=SEPARATOR=
Timestamp: ${1651248790047 + measureIndex * 500}
ADB EXEC TIME: ${42}
=STOP MEASURE=`
  );
};

export const emitMeasures = () => {
  emitMeasure(0);
  emitMeasure(1);
  emitMeasure(2);
};

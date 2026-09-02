import { describe, it, expect } from "bun:test";
import { CpuMeasureAggregator } from "../CpuMeasureAggregator";
import { ProcessStat } from "../getCpuStatsByProcess";

// 100 ticks per second: over a 1000ms interval, 1 tick = 1%
const CPU_CLOCK_TICK = 100;

const stat = (
  processId: string,
  processName: string,
  totalCpuTime: number,
  cpuNumber: string
): ProcessStat => ({ processId, processName, totalCpuTime, cpuNumber });

describe("CpuMeasureAggregator", () => {
  it("computes cpu usage per thread name and per core since the previous stats", () => {
    const aggregator = new CpuMeasureAggregator(CPU_CLOCK_TICK);

    aggregator.initStats([
      stat("1", "UI Thread", 100, "0"),
      stat("2", "mqt_js", 50, "1"),
      stat("3", "OkHttp", 10, "1"),
    ]);

    expect(
      aggregator.process(
        [
          stat("1", "UI Thread", 120, "0"),
          stat("2", "mqt_js", 80, "1"),
          stat("3", "OkHttp", 15, "1"),
        ],
        1000
      )
    ).toEqual({
      perName: { "UI Thread": 20, mqt_js: 30, OkHttp: 5 },
      perCore: { "0": 20, "1": 35 },
    });
  });

  it("sums threads sharing a name and caps usage to 100%", () => {
    const aggregator = new CpuMeasureAggregator(CPU_CLOCK_TICK);

    aggregator.initStats([stat("1", "worker", 0, "0"), stat("2", "worker", 0, "0")]);

    expect(
      aggregator.process([stat("1", "worker", 60, "0"), stat("2", "worker", 60, "0")], 1000)
    ).toEqual({
      perName: { worker: 100 },
      perCore: { "0": 100 },
    });
  });

  it("counts the whole cpu time of a restarted process (negative diff)", () => {
    const aggregator = new CpuMeasureAggregator(CPU_CLOCK_TICK);

    aggregator.initStats([stat("1", "UI Thread", 500, "0")]);

    expect(aggregator.process([stat("1", "UI Thread", 10, "0")], 1000)).toEqual({
      perName: { "UI Thread": 10 },
      perCore: { "0": 10 },
    });
  });

  it("uses the stats of the last call as the baseline of the next one", () => {
    const aggregator = new CpuMeasureAggregator(CPU_CLOCK_TICK);

    aggregator.initStats([stat("1", "UI Thread", 0, "0")]);
    aggregator.process([stat("1", "UI Thread", 10, "0")], 1000);

    expect(aggregator.process([stat("1", "UI Thread", 15, "0")], 500)).toEqual({
      perName: { "UI Thread": 10 },
      perCore: { "0": 10 },
    });
  });
});

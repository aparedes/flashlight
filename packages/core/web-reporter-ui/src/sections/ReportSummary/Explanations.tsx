// es-toolkit's main-entry `orderBy` requires `T extends object`, but here we sort an
// array of `string` (thread names) by a derived value, so use the compat build whose
// signature (lodash-compatible: single iteratee/order, no array wrapping needed) covers it.
import { orderBy } from "es-toolkit/compat";
import { roundToDecimal, sanitizeProcessName } from "@lantern/reporter";
import { AveragedTestCaseResult } from "@lantern/types";

const AverageTestRuntimeExplanation = () => (
  <>
    Time taken to run the test.
    <br />
    Can be helpful to measure Time To Interactive of your app, if the test is checking app start for
    instance.
  </>
);

const AverageFPSExplanation = ({ refreshRate }: { refreshRate: number }) => (
  <>
    {`Frame Per Second. Your app should display ${refreshRate} Frames Per Second to give an impression of fluidity. This number should be close to ${refreshRate}, otherwise it will seem laggy.`}{" "}
    <br />
    See{" "}
    <a href="https://www.youtube.com/watch?v=CaMTIgxCSqU" target="_blank" rel="noreferrer">
      this video
    </a>{" "}
    for more details
  </>
);

const AverageCPUUsageExplanation = () => (
  <>
    An app might run at high frame rates, such as 60 FPS or higher, but might be using too much
    processing power, so it&apos;s important to check CPU usage.
    <br /> Depending on the device, this value can go up to <code>100% x number of cores</code>. For
    instance, a Samsung A10s has 4 cores, so the max value would be 400%.
  </>
);

const AverageRAMUsageExplanation = () => (
  <>
    If an app consumes a large amount of RAM (random-access memory), it can impact the overall
    performance of the device and drain the battery more quickly.
    <br />
    It's worth noting that results might be higher than expected: on Android we measure RSS (not
    PSS), so memory shared with other processes is counted in full.
  </>
);

const HighCPUUsageExplanation = ({
  result,
  refreshRate,
}: {
  result: AveragedTestCaseResult;
  refreshRate: number;
}) => (
  <>
    <div className="mb-2">
      <p>Impacted threads:</p>
      {orderBy(
        Object.keys(result.averageHighCpuUsage),
        (processName) => result.averageHighCpuUsage[processName],
        "desc"
      ).map((processName) => (
        <p key={processName} className="whitespace-pre">
          - {sanitizeProcessName(processName)} for{" "}
          {roundToDecimal(result.averageHighCpuUsage[processName] / 1000, 1)}s
        </p>
      ))}
    </div>
    {`High CPU usage by a single process can cause app unresponsiveness, even with low overall CPU usage. For instance, an overworked JS thread in a React Native app may lead to unresponsiveness despite maintaining ${refreshRate} FPS.`}
  </>
);

export const Explanations = {
  AverageTestRuntimeExplanation,
  AverageFPSExplanation,
  AverageCPUUsageExplanation,
  AverageRAMUsageExplanation,
  HighCPUUsageExplanation,
};

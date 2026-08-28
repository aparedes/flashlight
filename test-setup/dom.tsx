import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach, jest, mock } from "bun:test";
import type { ApexOptions } from "apexcharts";
import "./node";

GlobalRegistrator.register();

// See https://github.com/apexcharts/react-apexcharts/issues/52
// react-apexcharts 2 is a plain function component that hands the chart instance back
// through a `chartRef` prop rather than forwarding a ref.
const ApexChartMock = ({
  series,
  options,
}: {
  options: ApexOptions;
  series: ApexOptions["series"];
}) => (
  <div className="ApexChartsMock">
    {JSON.stringify(options, null, 2)}
    {JSON.stringify(series, null, 2)}
  </div>
);

// Both packages ship separate ESM and CJS builds behind an `exports` map, and `mock.module`
// keys on the resolved file — so the bare specifier only covers the ESM build that the UI
// sources import. `@perf-profiler/web-reporter-ui` is also consumed through its tsc-built
// CJS `dist` (by the measure webapp), which `require`s the CJS build; without the second
// registration the real chart library would render into happy-dom for those tests.
const mockModule = (specifier: string, factory: () => unknown) => {
  mock.module(specifier, factory);
  mock.module(require.resolve(specifier), factory);
};

mockModule("react-apexcharts", () => ({ default: ApexChartMock }));
mockModule("apexcharts", () => ({ default: { exec: jest.fn() }, exec: jest.fn() }));

// Loaded with `require` rather than a static `import` so that it is evaluated *after*
// `GlobalRegistrator.register()` above (`screen` binds to `document.body` at import time),
// but still at preload time rather than from inside a hook — @testing-library/react calls
// `beforeAll` at module scope, which bun rejects when it happens during a test.
const { cleanup } = require("@testing-library/react") as typeof import("@testing-library/react");

afterEach(() => {
  cleanup();
});

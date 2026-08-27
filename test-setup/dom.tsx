import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach, jest, mock } from "bun:test";
import React from "react";
import type { ApexOptions } from "apexcharts";
import "./node";

GlobalRegistrator.register();

// See https://github.com/apexcharts/react-apexcharts/issues/52
mock.module("react-apexcharts", () => {
  const ApexChart = (
    { series, options }: { options: ApexOptions; series: ApexOptions["series"] },
    ref: React.Ref<HTMLDivElement>
  ) => (
    <div className="ApexChartsMock" ref={ref}>
      {JSON.stringify(options, null, 2)}
      {JSON.stringify(series, null, 2)}
    </div>
  );
  return { default: React.forwardRef(ApexChart) };
});
mock.module("apexcharts", () => ({ default: { exec: jest.fn() }, exec: jest.fn() }));

// Loaded with `require` rather than a static `import` so that it is evaluated *after*
// `GlobalRegistrator.register()` above (`screen` binds to `document.body` at import time),
// but still at preload time rather than from inside a hook — @testing-library/react calls
// `beforeAll` at module scope, which bun rejects when it happens during a test.
const { cleanup } = require("@testing-library/react") as typeof import("@testing-library/react");

afterEach(() => {
  cleanup();
});

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach, jest, mock } from "bun:test";
import type { ApexOptions } from "apexcharts";
import { createRequire } from "module";
import path from "path";
import "./node";

/**
 * happy-dom replaces the platform networking globals with its own implementations, and the
 * measure tests run a real `Bun.serve` against a real client, so keep bun's:
 *
 * - `WebSocket`: happy-dom wraps the `ws` package but only registers a `once("error")` handler on
 *   the underlying emitter, so a refused connection surfaces as an *unhandled* error event, which
 *   bun turns into a test failure. The measure web app retries its first connection until the CLI
 *   server is up, so refused connections are part of normal operation.
 * - `fetch` / `Response` / `Request` / `Headers`: happy-dom's `fetch` is built on node's HTTP
 *   client, whose parser rejects bun's responses ("Duplicate Content-Length"), and `Bun.serve`
 *   only accepts a real `Response`.
 *
 * Nothing under test relies on happy-dom intercepting network traffic.
 */
const NATIVE_NETWORKING_GLOBALS = {
  WebSocket: globalThis.WebSocket,
  fetch: globalThis.fetch,
  Response: globalThis.Response,
  Request: globalThis.Request,
  Headers: globalThis.Headers,
};

GlobalRegistrator.register();

for (const [name, value] of Object.entries(NATIVE_NETWORKING_GLOBALS)) {
  (globalThis as unknown as Record<string, unknown>)[name] = value;
  (window as unknown as Record<string, unknown>)[name] = value;
}

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

// `mock.module` keys on the *resolved file*, and each of these packages resolves to four
// different files in this repo:
//
//   - both ship separate ESM and CJS builds behind an `exports` map. The UI sources `import`
//     the ESM build; the measure webapp loads `@lantern/web-reporter-ui` through its tsc-built
//     CJS `dist`, which `require`s the CJS build.
//   - bun's isolated install keeps one copy at `node_modules/<pkg>` and another under
//     `node_modules/.bun/<pkg>@<version>/`. Files at the repo root (this one) resolve to the
//     former; files inside a workspace package resolve through that package's own
//     `node_modules` symlink to the latter. They are physically distinct files.
//
// Resolving only from here therefore registers a copy that nothing under test ever loads, and
// the real chart library renders into happy-dom instead of the mock. So resolve from the
// package that actually imports the charts as well, and register every distinct path.
const CHARTS_DIR = path.join(
  import.meta.dir,
  "../packages/core/web-reporter-ui/src/components/Charts"
);
const chartsRequire = createRequire(path.join(CHARTS_DIR, "Chart.tsx"));

const mockModule = (specifier: string, factory: () => unknown) => {
  const resolved = new Set([
    specifier,
    require.resolve(specifier), // CJS, from this file (root copy)
    Bun.resolveSync(specifier, CHARTS_DIR), // ESM, from the consuming package (.bun copy)
    chartsRequire.resolve(specifier), // CJS, from the consuming package (.bun copy)
  ]);

  for (const target of resolved) {
    mock.module(target, factory);
  }
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

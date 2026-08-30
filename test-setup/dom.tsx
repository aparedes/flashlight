import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach, jest, mock } from "bun:test";
import type { ApexOptions } from "apexcharts";
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

// Both packages ship separate ESM and CJS builds behind an `exports` map, and `mock.module`
// keys on the resolved file — so the bare specifier only covers the ESM build that the UI
// sources import. `@lantern/web-reporter-ui` is also consumed through its tsc-built
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

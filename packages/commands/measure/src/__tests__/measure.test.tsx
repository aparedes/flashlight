import "@lantern/e2e/src/utils/test/mockChildProcess";
import {
  emitMeasures,
  perfProfilerMock,
  aTraceMock,
} from "@lantern/e2e/src/utils/test/mockEmitMeasures";
import { fireEvent, render as webRender, screen, waitFor, act } from "@testing-library/react";
import { render as cliRender } from "ink-testing-library";
import React from "react";
import { ServerApp } from "../server/ServerApp";
import { loadInk } from "../server/ink";
import { open } from "@lantern/shell";
import * as shell from "@lantern/shell";
import { matchSnapshot } from "@lantern/web-reporter-ui/utils/testUtils";
import { removeCLIColors } from "./utils/removeCLIColors";
import { LogLevel, Logger } from "@lantern/logger";
import { DEFAULT_PORT } from "../server/constants";
import { describe, test, expect, beforeAll, afterAll, spyOn } from "bun:test";

spyOn(shell, "open").mockImplementation(() => undefined);

Math.random = () => 0.5;

// Set me to LogLevel.DEBUG to see the debug logs
Logger.setLogLevel(LogLevel.SILENT);

let originalWindow: Window & typeof globalThis;
let MeasureWebApp: React.FC;
let webAppSocket: (typeof import("../webapp/socket.js"))["socket"];

describe("lantern measure interactive", () => {
  beforeAll(async () => {
    // `runServerApp` normally does this before rendering; these tests render `ServerApp`
    // themselves, so they have to pull ink in on their own. See `server/ink.ts`.
    await loadInk();

    originalWindow = global.window;

    global.window = Object.create(window);
    Object.defineProperty(window, "__LANTERN_DATA__", {
      value: { socketServerUrl: `http://localhost:${DEFAULT_PORT}` },
      writable: true,
    });

    MeasureWebApp = (await import("../webapp/MeasureWebApp.js")).MeasureWebApp;
    webAppSocket = (await import("../webapp/socket.js")).socket;
  });

  afterAll(() => {
    global.window = originalWindow;
  });

  const expectWebAppToBeOpened = () =>
    waitFor(() => expect(open).toHaveBeenCalledWith(`http://localhost:${DEFAULT_PORT}`));

  // `webapp/socket.ts` opens its WebSocket at import time, which happens in `beforeAll` —
  // before `setupCli()` has started the server. That first connection attempt therefore fails
  // and the client only retries after its backoff, which can outlast the 1s default timeout of
  // `findBy*`. So wait for the connection explicitly rather than letting the first `findBy*`
  // after a socket emit race against it.
  const expectWebAppToBeConnected = () =>
    waitFor(() => expect(webAppSocket.connected).toBe(true), { timeout: 10000 });

  const setupCli = (customPort = DEFAULT_PORT) => {
    // `ink-testing-library` drives its own React reconciler and doesn't wrap mount/unmount
    // in `act`, which React 19 warns about once @testing-library/react has switched the
    // process into an act environment — so wrap them here.
    let cli!: ReturnType<typeof cliRender>;
    act(() => {
      cli = cliRender(<ServerApp port={customPort} />);
    });
    const { lastFrame, unmount } = cli;

    const closeCli = async () => {
      act(() => unmount());
      // Seems like we need to wait for the useEffect cleanup to happen
      await new Promise((resolve) => setTimeout(resolve, 0));
    };

    return {
      closeCli,
      expectCliOutput: () => expect(removeCLIColors(lastFrame())),
    };
  };

  const setupWebApp = () => {
    const view = webRender(<MeasureWebApp />);

    return {
      closeWebApp: view.unmount,
      expectWebAppToMatchSnapshot: async (snapshotName: string) => {
        // Flush pending effects first — MUI mounts its `TouchRipple` from an effect, so
        // without this the snapshot depends on how many microtasks happened to run.
        await act(async () => {});
        matchSnapshot(view, snapshotName);
      },
    };
  };

  test("it displays measures", async () => {
    const { closeCli, expectCliOutput } = setupCli();
    const { closeWebApp, expectWebAppToMatchSnapshot } = setupWebApp();
    await expectWebAppToBeOpened();
    await expectWebAppToBeConnected();

    expectCliOutput().toMatchInlineSnapshot(`
      "
       Lantern web app running on: http://localhost:${DEFAULT_PORT}
       Platform: Android
      "
    `);

    expect((await screen.findByTestId("platform-badge")).textContent).toContain("Android");

    // Open the app picker and confirm the installed-apps list arrived from the server.
    // (Android's `AppInfo.name` mirrors `bundleId`, so the option renders it twice —
    // hence `findAllByText` rather than `findByText`.)
    fireEvent.mouseDown(screen.getByPlaceholderText("Bundle id — type or pick an installed app"));
    await screen.findAllByText("com.other");
    fireEvent.keyDown(screen.getByPlaceholderText("Bundle id — type or pick an installed app"), {
      key: "Escape",
    });

    // Autodetect app id com.example
    await screen.findByText("Auto-Detect");
    fireEvent.click(screen.getByText("Auto-Detect"));
    await screen.findByDisplayValue("com.example");

    // Start measuring
    fireEvent.click(screen.getByText("Start Measuring"));

    // Initial report screen with no measures
    await screen.findByText("Average Test Runtime");
    await expectWebAppToMatchSnapshot("Web app with no measures yet");

    // Simulate measures being emitted on the device
    act(() => emitMeasures());

    // We should now see 1000ms of measures: 3 measures at 0/500/1000ms
    await screen.findByText("1000 ms");
    // Find the score!
    screen.getByText("47");

    // expand threads
    await screen.findByText("Other threads");
    fireEvent.click(screen.getByText("Other threads"));

    await expectWebAppToMatchSnapshot("Web app with measures and threads opened");

    // Stop measuring
    fireEvent.click(screen.getByText("Stop Measuring"));
    await waitFor(() => expect(aTraceMock.kill).toHaveBeenCalled());
    await waitFor(() => expect(perfProfilerMock.kill).toHaveBeenCalled());

    // Close apps

    await closeCli();
    closeWebApp();
  });

  test("it handles the --port flag correctly", async () => {
    // Must be >= 1024: lower ports are privileged on Linux, and CI runners are not root.
    const customPort = 4001;

    const { closeCli, expectCliOutput } = setupCli(customPort);

    const { closeWebApp } = setupWebApp();

    const expectWebAppToBeOpenedOnCustomPort = () =>
      waitFor(() => expect(open).toHaveBeenCalledWith(`http://localhost:${customPort}`));
    await expectWebAppToBeOpenedOnCustomPort();

    expectCliOutput().toMatchInlineSnapshot(`
    "
     Lantern web app running on: http://localhost:${customPort}
     Platform: Android
    "
  `);

    // Close apps
    await closeCli();
    closeWebApp();
  });
});

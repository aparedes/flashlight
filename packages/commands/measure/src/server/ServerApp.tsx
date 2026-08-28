import { open } from "@perf-profiler/shell";
import { useEffect, useState } from "react";
import type { SocketType } from "../socket/socketInterface";
import { HostAndPortInfo } from "./components/HostAndPortInfo";
import { getWebAppUrl } from "./constants";
import { ServerSocketConnectionApp } from "./ServerSocketConnectionApp";
import { getInk, loadInk } from "./ink";
import { profiler } from "@perf-profiler/profiler";
import { createWebAppServer } from "./webAppServer";

const useCleanupOnManualExit = () => {
  const { useInput } = getInk();

  useInput(async (input) => {
    switch (input) {
      case "q":
      case "c":
        profiler.cleanup();
        process.exit();
    }
  });
};

interface ServerAppProps {
  port: number;
}

export const ServerApp = ({ port }: ServerAppProps) => {
  const [socket, setSocket] = useState<SocketType | null>(null);
  const webAppUrl = getWebAppUrl(port);
  useEffect(() => {
    // `Bun.serve` is listening as soon as it returns, so the browser can be opened right away.
    const server = createWebAppServer({ port, onConnection: setSocket });
    open(webAppUrl);

    return () => {
      // `true` closes the active WebSocket too, which the web app reports as a disconnection.
      server.stop(true);
    };
  }, [port, webAppUrl]);
  useCleanupOnManualExit();

  return socket ? (
    <ServerSocketConnectionApp socket={socket} url={webAppUrl} />
  ) : (
    <HostAndPortInfo url={webAppUrl} />
  );
};

export const runServerApp = async (port: number) => {
  const { render } = await loadInk();

  render(
    <ServerApp port={port} />,
    // handle it ourselves in the profiler to kill child processes thanks to useCleanupOnManualExit
    { exitOnCtrlC: false }
  );
};

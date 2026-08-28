import { Logger } from "@perf-profiler/logger";
import { useEffect } from "react";
import type { SocketEventBroadcaster } from "../socket/typedSocket";

export const useLogSocketEvents = (socket: SocketEventBroadcaster) => {
  useEffect(() => {
    function onSocketEvent(event: string, ...args: unknown[]) {
      Logger.debug(`Received socket event: ${event} with ${JSON.stringify(args)}`);
    }
    socket.onAny(onSocketEvent);

    return () => {
      socket.offAny(onSocketEvent);
    };
  }, [socket]);
};

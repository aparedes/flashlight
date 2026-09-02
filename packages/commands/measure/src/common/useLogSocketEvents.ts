import { Logger, LogLevel } from "@lantern/logger";
import { useEffect } from "react";
import type { SocketEventBroadcaster } from "../socket/typedSocket";

export const useLogSocketEvents = (socket: SocketEventBroadcaster) => {
  useEffect(() => {
    function onSocketEvent(event: string, ...args: unknown[]) {
      // The payload can be the whole measure state: only serialise it when it will be printed.
      if (!Logger.isEnabled(LogLevel.DEBUG)) return;
      Logger.debug(() => `Received socket event: ${event} with ${JSON.stringify(args)}`);
    }
    socket.onAny(onSocketEvent);

    return () => {
      socket.offAny(onSocketEvent);
    };
  }, [socket]);
};

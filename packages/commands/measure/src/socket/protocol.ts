import { Logger } from "@lantern/logger";

/**
 * Wire protocol shared by the measure server and the measure web app.
 *
 * This replaces socket.io. Every measure entry point runs under Bun — the bins are
 * `#!/usr/bin/env bun` and the standalone is a `bun build --compile` binary — so the server can
 * be a plain `Bun.serve` with a native WebSocket endpoint, and none of socket.io's transport
 * fallbacks, multiplexing or handshake are needed for a single localhost client.
 *
 * A frame is a JSON object mirroring socket.io's `emit(event, ...args)` call shape.
 */
export interface SocketFrame {
  event: string;
  args: unknown[];
}

/** Path the web app connects to. Everything else on the server is HTTP (index + static). */
export const WEBSOCKET_PATH = "/ws";

/** WebSocket close code 1000 — a normal, deliberate closure. */
export const NORMAL_CLOSURE = 1000;

/**
 * Close reason sent to a client the server evicts (only one web app may be connected at a
 * time). Mirrors socket.io's reason of the same name so the web app can tell an eviction
 * apart from the CLI exiting, which it surfaces to the user as an error.
 */
export const SERVER_DISCONNECT_REASON = "io server disconnect";

/** Reason reported to listeners when an established connection drops without a close reason. */
export const TRANSPORT_CLOSE_REASON = "transport close";

export const encodeFrame = (event: string, args: unknown[]): string =>
  JSON.stringify({ event, args } satisfies SocketFrame);

/**
 * Never throws: a malformed frame is logged and ignored so that a bad client cannot take the
 * CLI down mid-measure.
 */
export const decodeFrame = (data: unknown): SocketFrame | null => {
  if (typeof data !== "string") {
    Logger.debug(`Ignoring non-text socket frame (${typeof data})`);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    Logger.debug(`Ignoring unparseable socket frame: ${data.slice(0, 200)}`);
    return null;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as SocketFrame).event !== "string" ||
    !Array.isArray((parsed as SocketFrame).args)
  ) {
    Logger.debug(`Ignoring socket frame with unexpected shape: ${data.slice(0, 200)}`);
    return null;
  }

  const { event, args } = parsed as SocketFrame;
  return { event, args };
};

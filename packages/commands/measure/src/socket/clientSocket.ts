import {
  decodeFrame,
  encodeFrame,
  SERVER_DISCONNECT_REASON,
  TRANSPORT_CLOSE_REASON,
  WEBSOCKET_PATH,
} from "./protocol";
import {
  ClientSocketType,
  ClientToServerEvents,
  ServerToClientEvents,
  SocketEvents,
  SocketLifecycleEvents,
} from "./socketInterface";
import { SocketEventArgs, TypedSocketBase } from "./typedSocket";

const INITIAL_RETRY_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 2000;

/** `http://localhost:3000` -> `ws://localhost:3000/ws` (and `https:` -> `wss:`). */
export const toWebSocketUrl = (serverUrl: string): string => {
  const url = new URL(WEBSOCKET_PATH, serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

/**
 * The web app's end of the connection, on top of the platform `WebSocket`.
 *
 * Three behaviours socket.io used to provide are reimplemented here, because the rest of the
 * web app relies on them:
 *
 * - **Retry until the first connection succeeds.** This module is instantiated at import time,
 *   which can happen before the CLI's server is listening (the browser is opened by the CLI,
 *   but the tests import it first), so failed connects are expected and are retried with a
 *   short doubling backoff.
 * - **Buffer emits made before the socket is open**, and flush them on connect —
 *   `autodetectBundleId` can be emitted from a click that lands during the handshake.
 * - **Never reconnect once an established connection has dropped.** The server only accepts one
 *   client, so a drop means either that this tab was evicted by a newer one or that the CLI
 *   exited; reconnecting would fight the other tab. This mirrors the previous
 *   `socket.on("disconnect", () => socket.close())`.
 */
export class ClientSocket
  extends TypedSocketBase<ClientToServerEvents, ServerToClientEvents & SocketLifecycleEvents>
  implements ClientSocketType
{
  readonly url: string;

  private webSocket: WebSocket | null = null;
  private pendingFrames: string[] = [];
  private isConnected = false;
  /** Set once `close()` has been called or an established connection has dropped. */
  private isClosed = false;
  private retryDelay = INITIAL_RETRY_DELAY_MS;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(serverUrl: string) {
    super();
    this.url = toWebSocketUrl(serverUrl);
    this.connect();
  }

  get connected(): boolean {
    return this.isConnected;
  }

  emit<Event extends keyof ClientToServerEvents & string>(
    event: Event,
    ...args: SocketEventArgs<ClientToServerEvents[Event]>
  ): void {
    if (this.isClosed) return;

    const frame = encodeFrame(event, args);
    if (this.isConnected && this.webSocket) {
      this.webSocket.send(frame);
    } else {
      this.pendingFrames.push(frame);
    }
  }

  close(): void {
    this.isClosed = true;
    this.isConnected = false;
    this.pendingFrames = [];

    if (this.retryTimeout !== null) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }

    const webSocket = this.webSocket;
    this.webSocket = null;
    webSocket?.close();
  }

  disconnect(): void {
    this.close();
  }

  private connect(): void {
    if (this.isClosed) return;

    const webSocket = new globalThis.WebSocket(this.url);
    this.webSocket = webSocket;

    webSocket.addEventListener("open", () => {
      if (this.webSocket !== webSocket) return;

      this.isConnected = true;
      this.retryDelay = INITIAL_RETRY_DELAY_MS;

      const frames = this.pendingFrames;
      this.pendingFrames = [];
      for (const frame of frames) {
        webSocket.send(frame);
      }

      this.dispatch(SocketEvents.CONNECT, []);
    });

    webSocket.addEventListener("message", (event) => {
      const frame = decodeFrame(event.data);
      if (frame) this.dispatch(frame.event, frame.args);
    });

    // A failed connection attempt reports both `error` and `close`; the retry is driven from
    // `close` alone, but the listener has to exist so the error is not treated as unhandled.
    webSocket.addEventListener("error", () => undefined);

    webSocket.addEventListener("close", (event) => {
      if (this.webSocket !== webSocket) return;
      this.webSocket = null;

      if (!this.isConnected) {
        // Never connected: the CLI's server is not up yet, keep trying.
        this.scheduleRetry();
        return;
      }

      this.isConnected = false;
      this.isClosed = true;
      // Only an eviction announces itself; anything else (the CLI exiting, the process being
      // killed) is reported as a transport close, which the UI surfaces to the user.
      this.dispatch(SocketEvents.DISCONNECT, [
        event.reason === SERVER_DISCONNECT_REASON
          ? SERVER_DISCONNECT_REASON
          : TRANSPORT_CLOSE_REASON,
      ]);
    });
  }

  private scheduleRetry(): void {
    this.retryTimeout = setTimeout(() => {
      this.retryTimeout = null;
      this.connect();
    }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_DELAY_MS);
  }
}

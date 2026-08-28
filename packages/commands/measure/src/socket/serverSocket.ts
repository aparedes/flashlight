import type { ServerWebSocket } from "bun";
import { encodeFrame, NORMAL_CLOSURE, SERVER_DISCONNECT_REASON } from "./protocol";
import type { ClientToServerEvents, ServerToClientEvents, SocketType } from "./socketInterface";
import { SocketEventArgs, TypedSocketBase } from "./typedSocket";

/** `WebSocket.OPEN`, spelled out so this does not depend on a global `WebSocket` binding. */
const OPEN = 1;

/**
 * The server side of one web app connection, wrapping the `ServerWebSocket` handed over by
 * `Bun.serve`'s websocket handlers.
 */
export class ServerSocket
  extends TypedSocketBase<ServerToClientEvents, ClientToServerEvents>
  implements SocketType
{
  constructor(private readonly webSocket: ServerWebSocket<unknown>) {
    super();
  }

  get connected(): boolean {
    return this.webSocket.readyState === OPEN;
  }

  emit<Event extends keyof ServerToClientEvents & string>(
    event: Event,
    ...args: SocketEventArgs<ServerToClientEvents[Event]>
  ): void {
    if (!this.connected) return;
    this.webSocket.send(encodeFrame(event, args));
  }

  /**
   * Evicts this client: a normal closure carrying a reason the web app recognises as
   * server-initiated, so it does not report the CLI as having exited.
   */
  disconnect(): void {
    this.webSocket.close(NORMAL_CLOSURE, SERVER_DISCONNECT_REASON);
  }

  /** Called by the server's `message` handler once the incoming frame has been decoded. */
  receiveFrame(event: string, args: unknown[]): void {
    this.dispatch(event, args);
  }
}

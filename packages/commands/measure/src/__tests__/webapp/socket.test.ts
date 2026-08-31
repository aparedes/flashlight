import type { Server } from "bun";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";

import { ClientSocket, toWebSocketUrl } from "../../socket/clientSocket";
import { decodeFrame, encodeFrame, WEBSOCKET_PATH } from "../../socket/protocol";
import { SocketEvents } from "../../socket/socketInterface";

type TestBunServer = Server<unknown>;

let originalWindow: Window & typeof globalThis;

/** Frames received by whichever test server is currently running. */
let received: { event: string; args: unknown[] }[] = [];

interface TestServer {
  server: TestBunServer;
  url: string;
  /** Sends a frame to the connected client. */
  send: (event: string, args: unknown[]) => void;
  close: (code?: number, reason?: string) => void;
}

const startTestServer = (port = 0): TestServer => {
  let client: {
    send: (data: string) => void;
    close: (code?: number, reason?: string) => void;
  } | null = null;

  const server = Bun.serve({
    port,
    fetch: (request, server) =>
      new URL(request.url).pathname === WEBSOCKET_PATH && server.upgrade(request)
        ? undefined
        : new Response("Not found", { status: 404 }),
    websocket: {
      open: (ws) => {
        client = ws;
      },
      message: (_ws, message) => {
        const frame = decodeFrame(String(message));
        if (frame) received.push(frame);
      },
    },
  });

  return {
    server,
    url: `http://localhost:${server.port}`,
    send: (event, args) => client?.send(encodeFrame(event, args)),
    close: (code, reason) => client?.close(code, reason),
  };
};

const waitFor = async (predicate: () => boolean, timeout = 8000) => {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for a condition");
    await Bun.sleep(20);
  }
};

const sockets: ClientSocket[] = [];
const servers: TestBunServer[] = [];

const createSocket = (serverUrl: string) => {
  const socket = new ClientSocket(serverUrl);
  sockets.push(socket);
  return socket;
};

describe("webapp socket", () => {
  beforeAll(() => {
    originalWindow = global.window;

    global.window = Object.create(window);
    Object.defineProperty(window, "__LANTERN_DATA__", {
      value: { socketServerUrl: "http://localhost:9999" },
      writable: true,
    });
  });

  afterAll(() => {
    global.window = originalWindow;
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    for (const server of servers.splice(0)) server.stop(true);
    received = [];
  });

  describe("toWebSocketUrl", () => {
    it("points at the WebSocket path with a ws:// scheme", () => {
      expect(toWebSocketUrl("http://localhost:3000")).toBe("ws://localhost:3000/ws");
      expect(toWebSocketUrl("https://example.com")).toBe("wss://example.com/ws");
    });
  });

  it("connects to the server url the CLI injected into index.html", async () => {
    const { socket } = await import("../../webapp/socket.js");
    sockets.push(socket);

    expect(socket.url).toBe("ws://localhost:9999/ws");
    // Nothing is listening on 9999, so it keeps retrying rather than reporting a connection.
    expect(socket.connected).toBe(false);
  });

  it("connects and receives typed events", async () => {
    const testServer = startTestServer();
    servers.push(testServer.server);

    const socket = createSocket(testServer.url);
    const connects: string[] = [];
    socket.on(SocketEvents.CONNECT, () => connects.push("connect"));

    await waitFor(() => socket.connected);
    expect(connects).toEqual(["connect"]);

    const states: unknown[] = [];
    socket.on(SocketEvents.UPDATE_STATE, (state) => states.push(state));
    testServer.send(SocketEvents.UPDATE_STATE, [
      { isMeasuring: true, bundleId: "com.example", results: [] },
    ]);

    await waitFor(() => states.length === 1);
    expect(states[0]).toEqual({ isMeasuring: true, bundleId: "com.example", results: [] });
  });

  it("buffers emits made before the connection is open and flushes them on connect", async () => {
    const testServer = startTestServer();
    servers.push(testServer.server);

    const socket = createSocket(testServer.url);
    // The handshake has not completed yet — this is the `autodetectBundleId` case.
    expect(socket.connected).toBe(false);
    socket.emit(SocketEvents.AUTODETECT_BUNDLE_ID);
    socket.emit(SocketEvents.SET_BUNDLE_ID, "com.example");

    await waitFor(() => received.length === 2);
    expect(received).toEqual([
      { event: SocketEvents.AUTODETECT_BUNDLE_ID, args: [] },
      { event: SocketEvents.SET_BUNDLE_ID, args: ["com.example"] },
    ]);
  });

  it("retries the initial connection until the server is up", async () => {
    // Grab a free port, then release it so the first connection attempts fail.
    const placeholder = Bun.serve({ port: 0, fetch: () => new Response("") });
    const port = placeholder.port;
    placeholder.stop(true);

    const socket = createSocket(`http://localhost:${port}`);
    await Bun.sleep(300);
    expect(socket.connected).toBe(false);

    const testServer = startTestServer(port);
    servers.push(testServer.server);

    await waitFor(() => socket.connected);
  });

  it("closes for good once an established connection drops, without reconnecting", async () => {
    const testServer = startTestServer();
    servers.push(testServer.server);
    const port = testServer.server.port;

    const socket = createSocket(testServer.url);
    await waitFor(() => socket.connected);

    const disconnects: string[] = [];
    socket.on(SocketEvents.DISCONNECT, (reason) => disconnects.push(reason));

    testServer.server.stop(true);
    await waitFor(() => !socket.connected);
    expect(disconnects).toEqual(["transport close"]);

    // A server coming back on the same port must not resurrect this socket.
    const restarted = startTestServer(port);
    servers.push(restarted.server);
    await Bun.sleep(600);
    expect(socket.connected).toBe(false);
  });

  it("reports a server-initiated eviction with its close reason", async () => {
    const testServer = startTestServer();
    servers.push(testServer.server);

    const socket = createSocket(testServer.url);
    await waitFor(() => socket.connected);

    const disconnects: string[] = [];
    socket.on(SocketEvents.DISCONNECT, (reason) => disconnects.push(reason));

    testServer.close(1000, "io server disconnect");

    await waitFor(() => disconnects.length === 1);
    expect(disconnects).toEqual(["io server disconnect"]);
    expect(socket.connected).toBe(false);
  });

  it("drops emits once closed", async () => {
    const testServer = startTestServer();
    servers.push(testServer.server);

    const socket = createSocket(testServer.url);
    await waitFor(() => socket.connected);

    socket.close();
    socket.emit(SocketEvents.START);

    await Bun.sleep(200);
    expect(received).toEqual([]);
    expect(socket.connected).toBe(false);
  });
});

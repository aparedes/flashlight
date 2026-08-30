import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, test, expect, beforeAll, afterAll, afterEach } from "bun:test";

import { createWebAppServer, WebAppServer } from "../../server/webAppServer";
import { SocketEvents, SocketData } from "../../socket/socketInterface";
import { decodeFrame, encodeFrame, WEBSOCKET_PATH } from "../../socket/protocol";

const LANTERN_DATA_PLACEHOLDER =
  'window.__LANTERN_DATA__ = { socketServerUrl: "http://localhost:3000" };';

/** Stand-in for the Vite build, so the server can be exercised without one. */
let tempRoot: string;
let originalWebAppPath: string | undefined;

const servers: WebAppServer[] = [];

const startServer = (onConnection: () => void = () => undefined) => {
  // Port 0: let the OS pick a free one, so tests never fight over 3000.
  const server = createWebAppServer({ port: 0, onConnection });
  servers.push(server);
  return server;
};

const openWebSocket = (server: WebAppServer) =>
  new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(`ws://localhost:${server.port}${WEBSOCKET_PATH}`);
    socket.addEventListener("open", () => resolve(socket));
    socket.addEventListener("error", () => reject(new Error("Could not open the WebSocket")));
  });

const nextFrame = (socket: WebSocket) =>
  new Promise<{ event: string; args: unknown[] }>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("No frame received")), 5000);
    socket.addEventListener(
      "message",
      (event) => {
        clearTimeout(timeout);
        const frame = decodeFrame(event.data);
        if (frame) resolve(frame);
        else reject(new Error(`Undecodable frame: ${event.data}`));
      },
      { once: true }
    );
  });

const nextClose = (socket: WebSocket) =>
  new Promise<CloseEvent>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Socket was not closed")), 5000);
    socket.addEventListener("close", (event) => {
      clearTimeout(timeout);
      resolve(event);
    });
  });

describe("ServerApp", () => {
  beforeAll(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lantern-webapp-"));
    fs.writeFileSync(path.join(tempRoot, "outside-the-dist.txt"), "TOP SECRET");

    const dist = path.join(tempRoot, "dist");
    fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
    fs.writeFileSync(
      path.join(dist, "index.html"),
      `<html><script>${LANTERN_DATA_PLACEHOLDER}</script></html>`
    );
    fs.writeFileSync(path.join(dist, "assets", "index-abcd1234.js"), "console.log('webapp');");

    originalWebAppPath = process.env.LANTERN_WEBAPP_PATH;
    process.env.LANTERN_WEBAPP_PATH = dist;
  });

  afterAll(() => {
    // The dom suite runs every test file in one process — put the environment back.
    if (originalWebAppPath === undefined) delete process.env.LANTERN_WEBAPP_PATH;
    else process.env.LANTERN_WEBAPP_PATH = originalWebAppPath;

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  afterEach(() => {
    for (const server of servers.splice(0)) server.stop(true);
  });

  describe("GET /", () => {
    it("injects LanternData with the port the server actually listens on", async () => {
      const server = startServer();

      const response = await fetch(`http://localhost:${server.port}/`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(await response.text()).toContain(
        `window.__LANTERN_DATA__ = { socketServerUrl: "http://localhost:${server.port}" };`
      );
    });

    it("returns a 500 when the web app has not been built", async () => {
      process.env.LANTERN_WEBAPP_PATH = path.join(tempRoot, "does-not-exist");
      const server = startServer();

      const response = await fetch(`http://localhost:${server.port}/`);

      expect(response.status).toBe(500);
      expect(await response.text()).toBe("Error loading the page");

      process.env.LANTERN_WEBAPP_PATH = path.join(tempRoot, "dist");
    });
  });

  describe("static files", () => {
    it("serves the Vite assets with their content type", async () => {
      const server = startServer();

      const response = await fetch(`http://localhost:${server.port}/assets/index-abcd1234.js`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("javascript");
      expect(await response.text()).toBe("console.log('webapp');");
    });

    it("404s on unknown paths", async () => {
      const server = startServer();

      expect((await fetch(`http://localhost:${server.port}/nope.js`)).status).toBe(404);
    });

    it("does not serve files outside of the dist folder", async () => {
      const server = startServer();

      // `fetch` normalises `..` away in the URL, so the traversal has to be percent-encoded.
      for (const attempt of ["/%2e%2e/outside-the-dist.txt", "/..%2foutside-the-dist.txt"]) {
        const response = await fetch(`http://localhost:${server.port}${attempt}`);

        expect(response.status).toBe(404);
        expect(await response.text()).not.toContain("TOP SECRET");
      }
    });
  });

  describe("WebSocket endpoint", () => {
    it("round-trips typed events with the connected client", async () => {
      const state: SocketData = { isMeasuring: false, bundleId: null, results: [] };
      let connectionCount = 0;

      const server = createWebAppServer({
        port: 0,
        onConnection: (socket) => {
          connectionCount++;
          socket.on(SocketEvents.SET_BUNDLE_ID, (bundleId) => {
            socket.emit(SocketEvents.UPDATE_STATE, { ...state, bundleId });
          });
        },
      });
      servers.push(server);

      const client = await openWebSocket(server);
      client.send(encodeFrame(SocketEvents.SET_BUNDLE_ID, ["com.example"]));

      const frame = await nextFrame(client);

      expect(frame.event).toBe(SocketEvents.UPDATE_STATE);
      expect((frame.args[0] as SocketData).bundleId).toBe("com.example");
      expect(connectionCount).toBe(1);

      client.close();
    });

    it("evicts the previous client when a new one connects", async () => {
      const connections: string[] = [];
      const server = createWebAppServer({
        port: 0,
        onConnection: (socket) => {
          connections.push("connected");
          socket.on(SocketEvents.SET_BUNDLE_ID, (bundleId) => {
            socket.emit(SocketEvents.UPDATE_STATE, {
              isMeasuring: false,
              bundleId,
              results: [],
            });
          });
        },
      });
      servers.push(server);

      const first = await openWebSocket(server);
      const firstClosed = nextClose(first);

      const second = await openWebSocket(server);

      const closeEvent = await firstClosed;
      expect(closeEvent.code).toBe(1000);
      expect(closeEvent.reason).toBe("io server disconnect");

      // The surviving client still gets served.
      second.send(encodeFrame(SocketEvents.SET_BUNDLE_ID, ["com.second"]));
      const frame = await nextFrame(second);
      expect((frame.args[0] as SocketData).bundleId).toBe("com.second");
      expect(connections).toHaveLength(2);

      second.close();
    });

    it("ignores malformed frames instead of crashing", async () => {
      const server = startServer();
      const client = await openWebSocket(server);

      client.send("not json at all");
      client.send(JSON.stringify({ nope: true }));
      client.send(encodeFrame(SocketEvents.SET_BUNDLE_ID, ["com.example"]));

      // The server is still up and serving HTTP after all of that.
      expect((await fetch(`http://localhost:${server.port}/`)).status).toBe(200);

      client.close();
    });

    it("rejects a plain GET on the WebSocket path", async () => {
      const server = startServer();

      expect((await fetch(`http://localhost:${server.port}${WEBSOCKET_PATH}`)).status).toBe(426);
    });
  });

  test("index.html contains the LanternData placeholder", () => {
    const fileContent = fs.readFileSync(`${__dirname}/../../webapp/index.html`, "utf8");
    expect(fileContent).toContain(LANTERN_DATA_PLACEHOLDER);
  });
});

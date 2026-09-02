import path from "path";
import { Logger } from "@lantern/logger";
import { decodeFrame, WEBSOCKET_PATH } from "../socket/protocol";
import { ServerSocket } from "../socket/serverSocket";
import type { SocketType } from "../socket/socketInterface";

/**
 * The measure web app server: static hosting for the Vite build plus the WebSocket endpoint the
 * web app talks to. It is `Bun.serve` and nothing else — every measure entry point already runs
 * under Bun (`#!/usr/bin/env bun` bins, and a `bun build --compile` standalone binary), so
 * express/socket.io bought nothing here.
 *
 * No CORS handling: the web app is served from this very origin, and WebSocket handshakes are
 * not preflighted — which is exactly why the upgrade checks the `Origin` header itself (see
 * {@link isAllowedOrigin}): a WebSocket client drives the profiler on the connected device.
 */

/** Loopback only: nothing on the network should reach the profiler controls. */
const HOSTNAME = "127.0.0.1";

/** Vite's `assets/*` files carry a content hash in their name, so they can be cached forever. */
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

const getPathToDist = () => process.env.LANTERN_WEBAPP_PATH || path.join(__dirname, "../../dist");

/**
 * Origins the served page can have. Browsers always send an `Origin` on a WebSocket handshake,
 * so a page from any other site (cross-site WebSocket hijacking) is turned away. A missing
 * header means a non-browser client — tests, curl — which the check cannot protect against
 * anyway, so it is let through.
 */
export const isAllowedOrigin = (origin: string | null, port: number): boolean => {
  if (origin === null) return true;

  const allowedOrigins = [`http://localhost:${port}`, `http://${HOSTNAME}:${port}`];
  if (process.env.DEVELOPMENT_MODE === "true") {
    // The page comes from the Vite dev server (see `getWebAppUrl` / `vite.config.mts`).
    allowedOrigins.push("http://localhost:1234");
  }

  return allowedOrigins.includes(origin);
};

/** `index.html` ships the placeholder port; rewrite it to the port we actually listen on. */
const serveIndexHtml = async (port: number): Promise<Response> => {
  try {
    const html = await Bun.file(path.join(getPathToDist(), "index.html")).text();

    return new Response(html.replace("localhost:3000", `localhost:${port}`), {
      // The port is baked into the page, so a stale copy would point at the wrong server.
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (error) {
    Logger.debug(`Could not read the web app index.html: ${error}`);
    return new Response("Error loading the page", { status: 500 });
  }
};

const notFound = () => new Response("Not found", { status: 404 });

/** Serves the Vite build (`assets/` chunks, favicon…). `Bun.file` sets the content type. */
const serveStaticFile = async (pathname: string): Promise<Response> => {
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    return notFound();
  }

  const distPath = path.resolve(getPathToDist());
  // Path traversal guard: `normalize` collapses the `.`/`..` segments an encoded `%2e%2e` can
  // smuggle past the URL parser, and the resolved path is then required to stay under dist.
  const filePath = path.resolve(distPath, `.${path.posix.normalize(`/${decodedPathname}`)}`);
  if (filePath !== distPath && !filePath.startsWith(distPath + path.sep)) {
    return notFound();
  }

  const file = Bun.file(filePath);
  if (!(await file.exists())) return notFound();

  return new Response(
    file,
    decodedPathname.startsWith("/assets/")
      ? { headers: { "Cache-Control": IMMUTABLE_CACHE_CONTROL } }
      : undefined
  );
};

interface WebSocketData {
  socket: ServerSocket | null;
}

export const createWebAppServer = ({
  port,
  onConnection,
}: {
  port: number;
  onConnection: (socket: SocketType) => void;
}) => {
  /**
   * Only one web app may drive the CLI at a time: a new connection evicts the previous one,
   * which is what the socket.io server did too.
   */
  let currentClient: Bun.ServerWebSocket<WebSocketData> | null = null;

  return Bun.serve<WebSocketData>({
    hostname: HOSTNAME,
    port,
    fetch: (request, server) => {
      const { pathname } = new URL(request.url);

      if (pathname === WEBSOCKET_PATH) {
        if (!isAllowedOrigin(request.headers.get("origin"), server.port ?? port)) {
          return new Response("Forbidden origin", { status: 403 });
        }

        return server.upgrade(request, { data: { socket: null } })
          ? undefined
          : new Response("Expected a WebSocket upgrade request", { status: 426 });
      }

      if (pathname === "/") return serveIndexHtml(server.port ?? port);

      return serveStaticFile(pathname);
    },
    websocket: {
      open: (ws) => {
        currentClient?.data.socket?.disconnect();
        currentClient = ws;

        const socket = new ServerSocket(ws);
        ws.data.socket = socket;
        onConnection(socket);
      },
      message: (ws, message) => {
        const frame = decodeFrame(typeof message === "string" ? message : message.toString());
        if (frame) ws.data.socket?.receiveFrame(frame.event, frame.args);
      },
      close: (ws) => {
        if (currentClient === ws) currentClient = null;
      },
    },
  });
};

export type WebAppServer = ReturnType<typeof createWebAppServer>;

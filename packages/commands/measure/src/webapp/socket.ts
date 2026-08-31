import { ClientSocket } from "../socket/clientSocket";

/**
 * The web app's connection to the measure CLI. Created at import time — before the CLI's server
 * is necessarily listening — so `ClientSocket` retries until the first connection succeeds and
 * buffers anything emitted meanwhile.
 */
export const socket = new ClientSocket(window.__LANTERN_DATA__.socketServerUrl);

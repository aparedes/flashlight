import * as actualSocketIoClient from "socket.io-client";
import { describe, it, expect, beforeAll, afterAll, jest, mock } from "bun:test";

const ioMock = jest.fn(() => ({ on: jest.fn(), close: jest.fn() }));
mock.module("socket.io-client", () => ({ ...actualSocketIoClient, io: ioMock }));

let originalWindow: Window & typeof globalThis;

describe("socket", () => {
  beforeAll(async () => {
    originalWindow = global.window;

    global.window = Object.create(window);
    Object.defineProperty(window, "__FLASHLIGHT_DATA__", {
      value: { socketServerUrl: "http://localhost:9999" },
      writable: true,
    });
  });

  afterAll(() => {
    // Restore the original window object
    global.window = originalWindow;
    mock.module("socket.io-client", () => actualSocketIoClient);
  });

  it("sets the expected socket server URL", async () => {
    await import("../../webapp/socket.js");
    expect(ioMock).toHaveBeenCalledWith("http://localhost:9999");
  });
});

import { describe, it, expect } from "bun:test";
import { getOpenCommand, getFFMpegArgs } from "..";

describe("getOpenCommand", () => {
  const PATH = "/tmp/my report & co/report.html";

  it("uses open on macOS", () => {
    expect(getOpenCommand(PATH, "darwin")).toEqual({ command: "open", args: [PATH] });
  });

  it("uses xdg-open on linux", () => {
    expect(getOpenCommand(PATH, "linux")).toEqual({ command: "xdg-open", args: [PATH] });
  });

  it("uses start through cmd on windows, with an empty window title", () => {
    expect(getOpenCommand(PATH, "win32")).toEqual({
      command: "cmd",
      args: ["/c", "start", "", PATH],
    });
  });
});

describe("getFFMpegArgs", () => {
  it("passes paths as single arguments, whatever they contain", () => {
    const args = getFFMpegArgs("/tmp/in put.mp4.bak", "/tmp/in put.mp4");

    expect(args).toContain("/tmp/in put.mp4.bak");
    expect(args[args.length - 1]).toBe("/tmp/in put.mp4");
    expect(args.indexOf("-i")).toBeLessThan(args.indexOf("/tmp/in put.mp4.bak"));
  });
});

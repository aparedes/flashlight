import fs from "fs";
import { test, expect, afterAll, spyOn, mock } from "bun:test";
import { parseGfxInfo } from "../parseGfxInfo";
import * as shell from "../../shell";

spyOn(shell, "executeCommand").mockImplementation(() =>
  fs.readFileSync(`${__dirname}/GfxInfoSample.txt`, "utf8")
);

const bundleId = "mockPackage";
test("GfxInfoParser", () => {
  expect(parseGfxInfo(bundleId)).toMatchObject({
    realtime: 1555308405,
    jankyFrames: {
      count: 4,
      totalRendered: 21,
    },
    renderingTime: {
      totalFramesRendered: 21,
      totalRenderTime: 684,
    },
  });
});

afterAll(() => mock.restore());

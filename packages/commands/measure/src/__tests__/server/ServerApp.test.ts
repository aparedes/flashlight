import supertest from "supertest";
import express from "express";
import fs from "fs";
import { describe, it, test, expect, beforeAll, beforeEach, afterAll, spyOn, mock } from "bun:test";

import { createExpressApp } from "../../server/ServerApp";

describe("ServerApp", () => {
  let app: express.Express;

  beforeAll(() => {
    spyOn(express, "static").mockImplementation(
      (() => (_req: unknown, _res: unknown, next: () => void) =>
        next()) as unknown as typeof express.static
    );
  });

  const FLASHLIGHT_DATA_PLACEHOLDER =
    'window.__FLASHLIGHT_DATA__ = { socketServerUrl: "http://localhost:3000" };';

  beforeEach(() => {
    spyOn(fs.promises, "readFile").mockResolvedValue(
      `<html><script>${FLASHLIGHT_DATA_PLACEHOLDER}</script></html>` as never
    );

    app = createExpressApp({
      port: 9999,
    });
  });

  describe("GET /", () => {
    it("injects FlashlightData into index.html", async () => {
      const response = await supertest(app).get("/");

      expect(response.statusCode).toBe(200);
      expect(response.text).toContain(
        `window.__FLASHLIGHT_DATA__ = { socketServerUrl: "http://localhost:9999" };`
      );
    });
  });

  test("index.html contains the FlashlightData placeholder", async () => {
    const fileContent = fs.readFileSync(`${__dirname}/../../webapp/index.html`, "utf8");
    expect(fileContent).toContain(FLASHLIGHT_DATA_PLACEHOLDER);
  });
});

afterAll(() => mock.restore());

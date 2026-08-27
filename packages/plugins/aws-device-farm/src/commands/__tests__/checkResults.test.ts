import { testRepository } from "../../repositories";
import { checkResults } from "../checkResults";
import fs from "fs";
import type axios from "axios";
import { describe, it, expect, beforeEach, afterEach, afterAll, spyOn, mock } from "bun:test";

describe("checkResults", () => {
  const FOLDER_WITH_SPACES = `${__dirname}/My folder with spaces`;

  beforeEach(() => {
    if (fs.existsSync(FOLDER_WITH_SPACES)) {
      fs.rmSync(FOLDER_WITH_SPACES, { recursive: true, force: true });
    }
  });

  it("writes results to a folder with spaces", async () => {
    spyOn(testRepository, "waitForCompletion").mockResolvedValueOnce();
    spyOn(testRepository, "getArtifactUrl").mockResolvedValueOnce("https://url.com");
    // `downloadFile` lives in @perf-profiler/shell's compiled CJS `dist`, so it holds a
    // reference to the CommonJS axios module object, which is not the same object as the
    // ESM `import axios from "axios"` binding.
    spyOn(require("axios") as typeof axios, "get").mockResolvedValueOnce({
      data: fs.readFileSync(`${__dirname}/results.json.zip`),
    });
    await checkResults({
      testRunArn: "testRunArn",
      reportDestinationPath: FOLDER_WITH_SPACES,
    });

    const OUTPUT_FILE = `${FOLDER_WITH_SPACES}/results.json`;
    expect(fs.existsSync(OUTPUT_FILE)).toBe(true);
    expect(JSON.parse(fs.readFileSync(OUTPUT_FILE).toString())).toEqual({
      name: "Report",
      iterations: [
        {},
        {
          videoInfos: { path: `${__dirname}/My folder with spaces/video.mp4` },
        },
      ],
    });
  });

  afterEach(() => {
    fs.rmSync(FOLDER_WITH_SPACES, { recursive: true, force: true });
  });
});

afterAll(() => mock.restore());

import fs from "fs";
import { POLLING_INTERVAL, TestCaseResult } from "@perf-profiler/types";
import path from "path";

const assertTimeIntervalMultiple = (n: number) => {
  if (n % POLLING_INTERVAL !== 0) {
    throw new Error(`Only multiples of the measure interval (${POLLING_INTERVAL}ms) are supported`);
  }
};

export const getMeasuresForTimeInterval = ({
  duration,
  skip,
  results,
}: {
  duration: number | null;
  skip: number;
  results: TestCaseResult[];
}): TestCaseResult[] => {
  assertTimeIntervalMultiple(skip);
  if (duration !== null) assertTimeIntervalMultiple(duration);

  const firstMeasureIndex = skip / POLLING_INTERVAL;

  return results.map((result) => ({
    ...result,
    iterations: result.iterations.map((iteration) => ({
      ...iteration,
      measures: iteration.measures.slice(
        firstMeasureIndex,
        duration ? firstMeasureIndex + duration / POLLING_INTERVAL + 1 : iteration.measures.length
      ),
    })),
  }));
};

const copyVideoFiles = (results: TestCaseResult[], outputDir: string) => {
  results.forEach((result) => {
    result.iterations.forEach((iteration) => {
      const videoPath = iteration.videoInfos?.path;
      if (videoPath && fs.existsSync(videoPath)) {
        const videoName = path.basename(videoPath);
        const destinationPath = path.join(outputDir, videoName);
        fs.copyFileSync(videoPath, destinationPath);
      }
    });
  });
};

export const getResultsFromPaths = (jsonPaths: string[]): TestCaseResult[] => {
  const getJsonPaths = () => {
    return jsonPaths
      .map((path) => {
        const isDirectory = fs.lstatSync(path).isDirectory();

        if (isDirectory) {
          return fs
            .readdirSync(path)
            .filter((file) => file.endsWith(".json"))
            .map((file) => `${path}/${file}`);
        } else {
          return path;
        }
      })
      .flat();
  };

  return getJsonPaths().map((path) => JSON.parse(fs.readFileSync(path, "utf8")));
};

const getAssetsDir = () => process.env.FLASHLIGHT_REPORT_ASSETS_PATH || __dirname;

/**
 * The token `App.tsx` initialises the results with. Vite builds a single self-contained
 * `index.html` (see vite.config.ts + vite-plugin-singlefile), so the placeholder — quoted by the
 * minifier as a string or a template literal — appears exactly once in the built HTML.
 */
const RESULTS_PLACEHOLDER =
  /(["'`])THIS_IS_A_VERY_LONG_STRING_THAT_IS_UNLIKELY_TO_BE_FOUND_IN_A_TEST_CASE_RESULT\1/;

export const injectResults = (html: string, results: TestCaseResult[]): string => {
  if (!RESULTS_PLACEHOLDER.test(html)) {
    throw new Error("Could not find the results placeholder in the report HTML");
  }

  // `<` is escaped so that a `</script>` sequence inside the data cannot end the inline script.
  const payload = JSON.stringify(results).replace(/</g, "\\u003c");

  // A replacer function keeps `$&`, `$1`, ... sequences in the data from being interpreted.
  return html.replace(RESULTS_PLACEHOLDER, () => payload);
};

export const writeReport = ({
  jsonPaths,
  outputDir,
  duration,
  skip = 0,
}: {
  jsonPaths: string[];
  outputDir: string;
  duration: number | null;
  skip: number;
}) => {
  const html = fs.readFileSync(`${getAssetsDir()}/index.html`, "utf8");

  const results = getResultsFromPaths(jsonPaths);
  const isIOSTestCaseResult = results.every((result) => result.type === "IOS_EXPERIMENTAL");

  const reportHtml = injectResults(html, getMeasuresForTimeInterval({ results, skip, duration }));

  const htmlFilePath = `${outputDir}/report.html`;
  // Videos stay next to the report as separate files, by design.
  if (!isIOSTestCaseResult) copyVideoFiles(results, outputDir);
  fs.writeFileSync(htmlFilePath, reportHtml);
  return htmlFilePath;
};

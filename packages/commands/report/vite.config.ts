import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  // The HTML entry lives next to the app sources.
  root: "src",
  // Relative asset URLs so the report works when opened from the filesystem.
  base: "./",
  plugins: [
    // React Compiler on, via oxc's native Rust port (`oxc-transform-react`) — no Babel
    // in the pipeline. It emits `react/compiler-runtime` imports, which need React >= 19.
    react({ compiler: true }),
    // The report is distributed as a single self-contained HTML file.
    viteSingleFile(),
  ],
  build: {
    // `tsc --build` emits the CLI files (openReport.js, writeReport.js, ...) into the
    // same dist folder, so this build must never empty it.
    outDir: "../dist",
    emptyOutDir: false,
  },
});

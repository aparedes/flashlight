import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  // The HTML entry lives next to the app sources.
  root: "src",
  // Relative asset URLs so the report works when opened from the filesystem.
  base: "./",
  plugins: [
    // The React Compiler stays off while we're on React 18 — enabling it emits
    // `react/compiler-runtime` imports that only exist in React 19.
    react(),
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

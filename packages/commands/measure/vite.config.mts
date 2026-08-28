import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // The HTML entry lives next to the webapp sources.
  root: "src/webapp",
  resolve: {
    alias: {
      // Bundle the shared UI library from source instead of its tsc-built CJS `dist`, so the
      // React Compiler (and Fast Refresh) actually see its components — `dist` ships JSX
      // already lowered to `jsx()` calls, which the compiler skips.
      "@perf-profiler/web-reporter-ui": fileURLToPath(
        new URL("../../core/web-reporter-ui/index.tsx", import.meta.url)
      ),
    },
  },
  // Relative asset URLs, resolved against `/` by `express.static(dist)`.
  base: "./",
  plugins: [
    // React Compiler on, via oxc's native Rust port (`oxc-transform-react`) — no Babel
    // in the pipeline. It emits `react/compiler-runtime` imports, which need React >= 19.
    react({ compiler: true }),
    // Tailwind v4 is configured entirely from `web-reporter-ui/index.css` — no PostCSS,
    // no JS config.
    tailwindcss(),
  ],
  server: {
    // `getWebAppUrl` points at this port when DEVELOPMENT_MODE=true (the socket server itself
    // runs on its own port, and the webapp connects to it explicitly).
    port: 1234,
  },
  build: {
    // `tsc --build` emits the server/CLI files into the same dist folder, so this
    // build must never empty it.
    outDir: "../../dist",
    emptyOutDir: false,
  },
});

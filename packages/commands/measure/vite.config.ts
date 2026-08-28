import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // The HTML entry lives next to the webapp sources.
  root: "src/webapp",
  // Relative asset URLs, resolved against `/` by `express.static(dist)`.
  base: "./",
  plugins: [
    // React Compiler on, via oxc's native Rust port (`oxc-transform-react`) — no Babel
    // in the pipeline. It emits `react/compiler-runtime` imports, which need React >= 19.
    react({ compiler: true }),
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

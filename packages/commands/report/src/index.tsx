import { createRoot } from "react-dom/client";
import { App } from "./App";
import "../../../core/web-reporter-ui/index.css";

const container = document.getElementById("app");

if (!container) {
  throw new Error(`Report container #app is missing from the HTML document`);
}

createRoot(container).render(<App />);

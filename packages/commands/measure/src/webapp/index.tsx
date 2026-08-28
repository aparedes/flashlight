import { createRoot } from "react-dom/client";
import { MeasureWebApp } from "./MeasureWebApp";
import "../../../../core/web-reporter-ui/index.css";

const container = document.getElementById("app");

if (!container) {
  throw new Error(`Web app container #app is missing from the HTML document`);
}

createRoot(container).render(<MeasureWebApp />);

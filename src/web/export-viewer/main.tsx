import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ExportApp } from "./ExportApp";
import type { ExportPayload } from "./types";
import "../styles/tokens.css";
import "../styles/reset.css";
import "../styles/base.css";

const payloadElement = document.getElementById("codehq-export-payload");
if (payloadElement === null || payloadElement.textContent === null) {
  throw new Error("Export payload not found.");
}
const payload = JSON.parse(payloadElement.textContent) as ExportPayload;

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Root element '#root' was not found.");
}

createRoot(container).render(
  <StrictMode>
    <ExportApp payload={payload} />
  </StrictMode>,
);

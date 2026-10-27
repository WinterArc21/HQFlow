import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useCodeHQStore } from "../store/useCodeHQStore";
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

// The export opens in the card format it was made in, whatever the viewer picked before.
useCodeHQStore.setState({ cardSize: payload.cardSize ?? "standard" });

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Root element '#root' was not found.");
}

createRoot(container).render(
  <StrictMode>
    <ExportApp payload={payload} />
  </StrictMode>,
);

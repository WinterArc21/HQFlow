import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CloudApp } from "./CloudApp";
import "../styles/tokens.css";
import "../styles/reset.css";
import "../styles/base.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("HQFlow cloud viewer root was not found.");
}

createRoot(container).render(
  <StrictMode>
    <CloudApp />
  </StrictMode>,
);

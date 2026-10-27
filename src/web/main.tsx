import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Backdrop } from "./components/backdrop";
import "./styles/tokens.css";
import "./styles/reset.css";
import "./styles/base.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Root element '#root' was not found.");
}

createRoot(container).render(
  <StrictMode>
    <Backdrop />
    <App />
  </StrictMode>,
);

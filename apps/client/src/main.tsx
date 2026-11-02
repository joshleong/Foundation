import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Dev only: hidden/background panes (test harnesses, headless capture) pause
// requestAnimationFrame; ?rafshim drives frames from a timer so captures show
// the real, settled UI.
if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("rafshim")) {
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(performance.now()), 16);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

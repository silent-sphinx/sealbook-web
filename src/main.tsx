import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initWasm } from "./lib/wasm";

const root = createRoot(document.getElementById("root")!);

initWasm()
  .then(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch(() => {
    root.render(
      <div className="flex min-h-screen items-center justify-center px-5 text-center">
        <p className="text-sm text-mute">Sealbook couldn’t start. Refresh the page.</p>
      </div>,
    );
  });

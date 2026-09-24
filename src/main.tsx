import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initWasm } from "./lib/wasm";

const root = createRoot(document.getElementById("root")!);

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Keep unexpected imported data from taking down the whole document.
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="flex min-h-screen items-center justify-center px-5 text-center">
          <p className="text-sm text-mute">Sealbook could not display this data. Refresh the page to continue.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

initWasm()
  .then(() => {
    root.render(
      <StrictMode>
        <AppErrorBoundary><App /></AppErrorBoundary>
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

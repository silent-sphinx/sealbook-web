import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { UpdatePrompt } from "./components/UpdatePrompt";
import "./index.css";
import { describeError, elapsed, log, logStartup } from "./lib/log";
import { insecureContextReason } from "./lib/secureContext";
import { initWasm } from "./lib/wasm";

const root = createRoot(document.getElementById("root")!);

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep unexpected imported data from taking down the whole document. The
    // component stack is the only record of where it came from, so it is logged
    // rather than swallowed with the render.
    log.error("render failed, showing the recovery screen", undefined, error);
    if (info.componentStack) {
      log.debug(`component stack${info.componentStack}`);
    }
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

logStartup();

// An unhandled rejection in a fire-and-forget write is otherwise reported by the
// browser without saying which part of the app it came from.
window.addEventListener("unhandledrejection", (event) => {
  log.error("unhandled promise rejection", undefined, event.reason);
});

const started = performance.now();

const insecure = insecureContextReason();
if (insecure) {
  log.error("this page is not a secure context, so the app will not start", { reason: insecure });
  root.render(
    <div className="flex min-h-screen items-center justify-center px-5 text-center">
      <p className="max-w-sm text-sm text-mute">{insecure}</p>
    </div>,
  );
} else {
  void start();
}

function start() {
  return initWasm()
  .then(() => {
    log.info("crypto module ready", { ms: elapsed(started) });
    root.render(
      <StrictMode>
        <AppErrorBoundary><App /></AppErrorBoundary>
        <UpdatePrompt />
      </StrictMode>,
    );
  })
  .catch((err: unknown) => {
    log.error(
      "crypto module failed to load, so the app cannot start",
      { ms: elapsed(started), reason: describeError(err) },
      err,
    );
    root.render(
      <div className="flex min-h-screen items-center justify-center px-5 text-center">
        <p className="text-sm text-mute">Sealbook couldn’t start. Refresh the page.</p>
      </div>,
    );
  });
}

import { useRegisterSW } from "virtual:pwa-register/react";
import { btnPrimary, btnSecondary } from "../lib/styles";
import { describeError, log } from "../lib/log";
import { Toast } from "./Toast";

/**
 * How often a tab that is already open asks whether a new build has landed.
 *
 * The browser checks for a new worker on navigation, which for this app may
 * not happen for days: the shell is one page and the vault is kept unlocked
 * behind it. Without this poll a long-lived tab never learns there is an
 * update to take.
 */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

/**
 * Offers the reload that hands a tab over to a newly deployed build.
 *
 * Mounted beside the app rather than inside it, so the offer survives a render
 * failure in the app and shows on the lock screen as well as behind it.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW: (_url, registration) => {
      if (!registration) return;
      window.setInterval(() => void registration.update(), UPDATE_CHECK_MS);
    },
    onRegisterError: (err: unknown) => {
      // The app still works; it just will not be available offline, and this
      // tab will not be told about later builds.
      log.warn("the service worker could not be registered", { reason: describeError(err) });
    },
  });

  if (!needRefresh) return null;

  return (
    <Toast
      title="A new version of Sealbook is ready."
      actions={
        <>
          <button type="button" className={btnSecondary} onClick={() => setNeedRefresh(false)}>
            Later
          </button>
          <button
            type="button"
            className={btnPrimary}
            onClick={() => void updateServiceWorker(true)}
          >
            Reload
          </button>
        </>
      }
    >
      Reload when it suits you. This tab keeps working on the version it started with.
    </Toast>
  );
}

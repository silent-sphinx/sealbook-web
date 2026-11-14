import { useState } from "react";

import { generateAccountExportData } from "../lib/accountExport";
import type { Session } from "../lib/client";
import { friendlyError } from "../lib/errors";
import { triggerDownload } from "../lib/importExport";
import { mutateOutbox } from "../lib/outbox";
import { btnDanger, btnSecondary } from "../lib/styles";
import { coreOutboxPush, coreOutboxSettle, corePayloadKind, type Outbox } from "../lib/wasm";
import { Modal } from "./Modal";
import { ErrorMessage } from "./ErrorMessage";

type Props = {
  session: Session;
  failed: Outbox["failed"];
  onClose: () => void;
  onRetry: () => void;
};

/** What a person would call the item a queued write holds. */
function describeWrite(contentType: string, payload: string): string {
  const kind = corePayloadKind(contentType, payload).replace(/_/gu, " ");
  try {
    const value = JSON.parse(payload) as {
      title?: unknown;
      name?: unknown;
    };
    const name =
      typeof value.title === "string"
        ? value.title
        : typeof value.name === "string"
          ? value.name
          : value.name && typeof value.name === "object" && "full" in value.name
            ? String((value.name as { full: unknown }).full)
            : "";
    return name.trim() ? `${kind}: ${name.trim()}` : kind;
  } catch {
    return kind;
  }
}

export function OutboxPanel({ session, failed, onClose, onRetry }: Props) {
  const [error, setError] = useState<string | null>(null);

  async function discard(ids: string[]) {
    setError(null);
    try {
      await mutateOutbox((current) => coreOutboxSettle(current, ids));
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function retry() {
    setError(null);
    try {
      await mutateOutbox((current) =>
        failed.reduce(
          (next, { write }) => coreOutboxPush(coreOutboxSettle(next, [write.id]), write),
          current,
        ),
      );
      onRetry();
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  function exportFailed() {
    const objects = failed
      .filter(({ write }) => !write.tombstone)
      .map(({ write }) => ({
        id: write.id,
        contentType: write.content_type,
        payload: write.payload,
      }));
    const { filename, mime, data } = generateAccountExportData(session.state, {
      objects,
      unreadable: 0,
    });
    triggerDownload(filename.replace(/\.json$/u, "-unsynced.json"), mime, data);
  }

  return (
    <Modal title="Changes that couldn't sync" onClose={onClose}>
      <div className="space-y-4 p-6">
        <p className="text-sm leading-relaxed text-mute">
          The server refused these changes, so they are kept on this device only. Try them
          again, export them to keep a copy, or discard them.
        </p>
        <ul className="divide-y divide-line rounded-xl border border-line">
          {failed.map(({ write, reason }) => (
            <li key={write.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-text">
                  {write.tombstone ? "Delete" : describeWrite(write.content_type, write.payload)}
                </p>
                <p className="mt-0.5 text-xs text-mute">{reason}</p>
              </div>
              <button
                type="button"
                className={`${btnDanger} shrink-0 px-3`}
                onClick={() => void discard([write.id])}
              >
                Discard
              </button>
            </li>
          ))}
        </ul>
        {error ? (
          <ErrorMessage size="xs">{error}</ErrorMessage>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={`${btnSecondary} px-4`} onClick={exportFailed}>
            Export
          </button>
          <button type="button" className={`${btnSecondary} px-4`} onClick={() => void retry()}>
            Try again
          </button>
        </div>
      </div>
    </Modal>
  );
}

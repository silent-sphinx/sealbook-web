import { useMemo, useState } from "react";
import type { Session } from "../lib/client";
import { friendlyError } from "../lib/errors";
import {
  btnHeaderSecondary,
  focusRing,
  paneCount,
  paneHeader,
  paneTitle,
  sidebarCount,
  sidebarMark,
  sidebarRowState,
  sidebarSubgroup,
} from "../lib/styles";
import {
  findTrashItem,
  TRASH_TAB_KINDS,
  trashItemTitle,
  type TrashKind,
  type TrashListing,
  type TrashTab,
} from "../lib/trash";
import { purgeItems, restoreItem } from "../lib/trashApi";
import type { Contact } from "../lib/types";
import { coreTrashRoots, type TrashRoot } from "../lib/wasm";
import { ConfirmDialog } from "./ConfirmDialog";
import { EmptyState } from "./EmptyState";
import { ErrorMessage } from "./ErrorMessage";
import { Icon } from "./Icon";

const KIND_LABEL: Record<TrashKind, string> = {
  contact: "Contact",
  address_book: "Address book",
  calendar_event: "Event",
  calendar: "Calendar",
  note: "Note",
  notebook: "Notebook",
  bookmark: "Bookmark",
  bookmark_collection: "Collection",
  task: "Task",
  task_list: "List",
};

/** What one tab's trash lists, newest first. */
export function trashRootsFor(trash: TrashListing, tab: TrashTab, now = Date.now()): TrashRoot[] {
  const kinds: readonly string[] = TRASH_TAB_KINDS[tab];
  return coreTrashRoots(trash.nodes, now).filter((root) => kinds.includes(root.kind));
}

/** The sidebar row that opens a tab's trash, at the foot of its sidebar. */
export function TrashRow({
  count,
  active,
  onToggle,
}: {
  count: number;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={sidebarSubgroup}>
      <button
        type="button"
        onClick={onToggle}
        aria-current={active ? "true" : undefined}
        title={active ? "Leave the trash" : "Show deleted items"}
        className={`-mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs transition-colors ${focusRing} ${sidebarRowState(active)}`}
      >
        <span className={sidebarMark}>
          <Icon name="trash" className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">Trash</span>
        <span className={`shrink-0 ${sidebarCount}`}>{count || ""}</span>
      </button>
    </div>
  );
}

function deletedOn(stamp: string): string {
  const parsed = Date.parse(stamp);
  if (Number.isNaN(parsed)) return "Deleted";
  return `Deleted ${new Date(parsed).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}

function daysLeft(root: TrashRoot): string {
  if (root.days_left === undefined) return "Kept until you empty the trash";
  if (root.days_left === 0) return "Deletes today";
  return `Deletes in ${root.days_left} day${root.days_left === 1 ? "" : "s"}`;
}

type Pending = { kind: "one"; root: TrashRoot; title: string } | { kind: "all" };

/**
 * One tab's trash: what was deleted from it, with restore and delete forever.
 * Writes go straight to the vault; `onChanged` re-lists afterwards.
 */
export function TrashPanel({
  session,
  trash,
  tab,
  liveContacts = [],
  onChanged,
}: {
  session: Session;
  trash: TrashListing;
  tab: TrashTab;
  /** Contacts a purged contact is unlinked from. Only the contacts tab passes them. */
  liveContacts?: Contact[];
  onChanged: () => Promise<void> | void;
}) {
  const roots = useMemo(() => trashRootsFor(trash, tab), [trash, tab]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
      return true;
    } catch (err) {
      setError(friendlyError(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function confirmPurge() {
    if (!pending) return;
    const ids = pending.kind === "all" ? roots.map((root) => root.id) : [pending.root.id];
    if (await run(() => purgeItems(session, trash, ids, liveContacts))) setPending(null);
  }

  return (
    <section className="order-1 flex min-w-0 flex-col overflow-hidden lg:order-none lg:min-h-0" aria-label="Trash">
      <header className={paneHeader}>
        <div className="flex min-w-0 items-center gap-2">
          <h1 className={paneTitle}>Trash</h1>
          <span className={paneCount}>{roots.length}</span>
        </div>
        <button
          type="button"
          className={btnHeaderSecondary}
          disabled={busy || roots.length === 0}
          onClick={() => setPending({ kind: "all" })}
        >
          Empty trash
        </button>
      </header>
      {error && !pending ? <ErrorMessage className="mx-4 mt-3 sm:mx-6">{error}</ErrorMessage> : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {roots.length === 0 ? (
          <EmptyState
            title="The trash is empty"
            body="Deleted items wait here for 30 days, then are deleted for good."
          />
        ) : (
          <ul className="divide-y divide-line">
            {roots.map((root) => {
              const entry = findTrashItem(trash, root.id);
              const title = entry ? trashItemTitle(entry) : root.id;
              return (
                <li key={root.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text">{title}</p>
                    <p className="mt-0.5 text-xs text-mute">
                      {KIND_LABEL[root.kind as TrashKind] ?? "Item"}
                      {root.contained > 0 ? ` with ${root.contained} item${root.contained === 1 ? "" : "s"}` : ""}
                      {" · "}
                      {deletedOn(root.trashed_at)}
                      {" · "}
                      {daysLeft(root)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      className={btnHeaderSecondary}
                      disabled={busy || !entry}
                      onClick={() => void run(() => restoreItem(session, trash, root.id))}
                    >
                      Restore
                    </button>
                    <button
                      type="button"
                      className={`${btnHeaderSecondary} hover:border-danger/40 hover:text-danger`}
                      disabled={busy}
                      onClick={() => setPending({ kind: "one", root, title })}
                    >
                      Delete forever
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {pending ? (
        <ConfirmDialog
          title={pending.kind === "all" ? "Empty trash" : "Delete forever"}
          heading={pending.kind === "all" ? "Empty the trash?" : `Delete "${pending.title}" forever?`}
          body={
            pending.kind === "all"
              ? `${roots.length} item${roots.length === 1 ? "" : "s"}, and everything inside them, will be deleted from every device. This cannot be undone.`
              : pending.root.contained > 0
                ? `It and the ${pending.root.contained} item${pending.root.contained === 1 ? "" : "s"} inside it will be deleted from every device. This cannot be undone.`
                : "It will be deleted from every device. This cannot be undone."
          }
          confirmLabel={pending.kind === "all" ? "Empty trash" : "Delete forever"}
          busyLabel="Deleting..."
          busy={busy}
          error={error}
          onConfirm={() => void confirmPurge()}
          onClose={() => {
            setPending(null);
            setError(null);
          }}
        />
      ) : null}
    </section>
  );
}

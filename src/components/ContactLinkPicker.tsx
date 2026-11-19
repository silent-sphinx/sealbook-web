import type { LinkableSection } from "../lib/contactProfile";
import type { Contact, ContactProfile } from "../lib/types";
import { Avatar } from "./ContactCard";
import { focusRing } from "../lib/styles";
import { Icon } from "./Icon";

/**
 * Full-screen contact picker for linking contacts.
 * `positionFixed` renders as `fixed inset-0` (use inside scrollable / overflow-hidden
 * containers). Without it the element is `absolute inset-0` (use inside a relative parent
 * that already fills the panel).
 */
export function ContactLinkPicker({
  currentContactId,
  currentProfile,
  contacts,
  section,
  onLink,
  onClose,
  search,
  onSearchChange,
  positionFixed = false,
}: {
  currentContactId: string;
  currentProfile?: ContactProfile;
  contacts: Contact[];
  section: LinkableSection;
  onLink: (contactId: string) => void;
  onClose: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  positionFixed?: boolean;
}) {
  const alreadyInSection = new Set(
    (currentProfile?.[section] ?? [])
      .map((p) => p.contactId)
      .filter((id): id is string => !!id),
  );
  const lower = search.toLowerCase();
  const options = contacts.filter(
    (c) =>
      c.id !== currentContactId &&
      !alreadyInSection.has(c.id) &&
      (lower === "" || c.name.toLowerCase().includes(lower)),
  );

  const posClass = positionFixed ? "fixed inset-0 z-(--z-modal)" : "absolute inset-0 z-(--z-modal)";

  return (
    <div
      className={`${posClass} flex flex-col bg-bg`}
      role="dialog"
      aria-label={`Link a contact to ${section}`}
      aria-modal="true"
    >
      <div className="flex items-center gap-3 border-b border-line px-5 py-3">
        <button
          type="button"
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface/40 text-mute transition-colors hover:border-line-light hover:text-text ${focusRing}`}
          aria-label="Cancel"
          onClick={onClose}
        >
          <Icon name="close" className="h-4 w-4" />
        </button>
        <input
          type="text"
          autoFocus
          placeholder={`Search contacts to add to ${section}`}
          aria-label={`Search contacts to add to ${section}`}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 text-xs text-text outline-none transition-colors placeholder:text-mute/70 focus:border-accent-dim focus:ring-1 focus:ring-accent-ring"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {options.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-mute">
            {search.trim() ? `No contacts matching "${search}"` : "No contacts available to link"}
          </p>
        ) : (
          <ul>
            {options.map((c) => (
              <li key={c.id} className="border-b border-line/60">
                <button
                  type="button"
                  className={`flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-surface/40 ${focusRing}`}
                  onClick={() => onLink(c.id)}
                >
                  <Avatar name={c.name} avatar={c.avatar} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text">{c.name}</p>
                    {c.work[0]?.organization || c.email ? (
                      <p className="truncate text-xs text-mute">
                        {c.work[0]?.organization ?? c.email}
                      </p>
                    ) : null}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

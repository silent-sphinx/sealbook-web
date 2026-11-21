import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { addressLines, channelKindLabel, dateKindLabel, isOngoing, mailtoHref, telHref } from "../lib/contact";
import {
  formatDateRange,
  lifeEventOrder,
  type LinkableSection,
} from "../lib/contactProfile";
import { optimizeAvatar } from "../lib/image";
import type { Session } from "../lib/client";
import type { AddressBook, Contact, ContactDraft, NoteAttachment } from "../lib/types";
import { Avatar } from "./ContactCard";
import { ConfirmDialog } from "./ConfirmDialog";
import { ContactForm } from "./ContactForm";
import { ContactAttachmentsSection } from "./ContactAttachmentsSection";
import { ContactProfileView, profileViewHasContent } from "./ContactProfileView";
import { Icon } from "./Icon";
import { EntryRow, FieldRow, HeaderButton, HeaderDivider, PaneSection, ProseBlock } from "./PaneControls";
import {
  btnPrimarySm,
  btnSecondarySm,
  focusRing,
  popover,
  tonePill,
} from "../lib/styles";
import { ContactLinkPicker } from "./ContactLinkPicker";

type Props = {
  session: Session;
  contact: Contact;
  bookName?: string;
  bookTone?: string;
  onDelete?: () => void;
  onArchive?: () => void;
  onClose: () => void;
  addressBooks: AddressBook[];
  busy: boolean;
  error?: string | null;
  onSave: (draft: ContactDraft) => boolean | Promise<boolean>;
  readOnly?: boolean;
  /** Attachments need the server, so they are read-only offline. */
  attachmentsReadOnly?: boolean;
  /** Owned by the caller so it can guard navigation while changes are unsaved. */
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  /** Detailed contact mode: adds the relationship sections. */
  detailed?: boolean;
  /** All contacts, used to resolve and pick linked contacts in family/friends/colleagues sections. */
  contacts?: Contact[];
  onLinkInSection?: (section: LinkableSection, targetId: string) => Promise<void>;
  onUnlinkFromSection?: (section: LinkableSection, contactId: string) => Promise<void>;
  onNavigateToContact?: (contact: Contact) => void;
};

function formatTimestamp(iso?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Ongoing entries first in the order they were entered, then finished ones
 * most recent first. Finished ones are history, so they show only with
 * detailed contacts on.
 */
function ongoingFirst<T extends { current?: boolean; end?: string }>(rows: T[], detailed: boolean): T[] {
  const ongoing = rows.filter(isOngoing);
  if (!detailed) return ongoing;
  const finished = rows
    .filter((row) => !isOngoing(row))
    .map((row) => ({ row, key: lifeEventOrder(row.end) }))
    .sort((a, b) => {
      if (a.key === null) return b.key === null ? 0 : 1;
      if (b.key === null) return -1;
      return b.key - a.key;
    })
    .map(({ row }) => row);
  return [...ongoing, ...finished];
}

/** A current entry with no start date has no range to show, so it says so on its own. */
function periodOf(row: { start?: string; end?: string; current?: boolean }): string | undefined {
  return formatDateRange(row.start, row.current ? undefined : row.end) || (row.current ? "Current" : undefined);
}

function leadingIcon(name: "pin" | "briefcase"): ReactNode {
  return (
    <span className="flex h-5 w-4 items-center justify-center text-mute/60">
      <Icon name={name} className="h-4 w-4" />
    </span>
  );
}

function formatDate(value: string): string {
  if (!value) return "";
  const parts = value.split("-");
  const date = parts.length === 3
    ? new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
    : new Date(value);
  if (isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function socialUrl(platform: string, handle: string): string | null {
  const value = handle.trim();
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  const clean = value.replace(/^@/, "");
  const name = platform.toLowerCase();
  if (name.includes("github")) return `https://github.com/${clean}`;
  if (name.includes("twitter") || name === "x" || name.includes("x/")) return `https://x.com/${clean}`;
  if (name.includes("linkedin")) return `https://linkedin.com/in/${clean}`;
  if (name.includes("instagram")) return `https://instagram.com/${clean}`;
  if (name.includes("bluesky") || name.includes("bsky")) return `https://bsky.app/profile/${clean}`;
  if (name.includes("telegram") || name === "tg") return `https://t.me/${clean}`;
  return null;
}

export function ContactDetailModal({
  session,
  contact,
  bookName,
  bookTone,
  onDelete,
  onArchive,
  onClose,
  addressBooks,
  busy,
  error,
  onSave,
  readOnly = false,
  attachmentsReadOnly = false,
  editing,
  onEditingChange,
  detailed = false,
  contacts,
  onLinkInSection,
  onUnlinkFromSection,
  onNavigateToContact,
}: Props) {
  const archived = contact.archived === true;
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [confirmRemovePhoto, setConfirmRemovePhoto] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<NoteAttachment[]>(contact.attachments ?? []);
  const persistedAttachments = useRef<NoteAttachment[]>(contact.attachments ?? []);
  const [linkingSection, setLinkingSection] = useState<LinkableSection | null>(null);
  const [linkPickerSearch, setLinkPickerSearch] = useState("");
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const avatarMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!avatarMenuOpen) return;

    function closeMenu(event: MouseEvent) {
      if (!avatarMenuRef.current?.contains(event.target as Node)) {
        setAvatarMenuOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAvatarMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [avatarMenuOpen]);

  async function handleAvatarUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setAvatarError(null);
    try {
      const avatar = await optimizeAvatar(file);
      if (await onSave({ ...contact, avatar })) {
        setAvatarMenuOpen(false);
      }
    } catch {
      setAvatarError("Couldn't process that image. Try a different file.");
      setAvatarMenuOpen(false);
    } finally {
      event.target.value = "";
    }
  }

  async function handleAttachmentsChange(next: NoteAttachment[]): Promise<boolean> {
    setAttachments(next);
    const saved = await onSave({ ...contact, attachments: next.length > 0 ? next : undefined });
    // Back to the last list that reached the vault rather than the one this
    // call hoped for, so a reported failure matches what the section shows. A
    // batch of uploads keeps the files that landed before the one that failed.
    if (saved) {
      persistedAttachments.current = next;
    } else {
      setAttachments(persistedAttachments.current);
    }
    return saved;
  }

  const socials = contact.socials ?? [];
  const dates = contact.dates ?? [];
  const addresses = ongoingFirst(
    contact.addresses.filter((a) => addressLines(a).length > 0),
    detailed,
  );
  const work = ongoingFirst(
    contact.work.filter((w) => w.organization || w.title),
    detailed,
  );
  const linkProps = {
    contacts,
    readOnly,
    onNavigateToContact,
    onLinkInSection: onLinkInSection
      ? (section: LinkableSection) => {
          setLinkPickerSearch("");
          setLinkingSection(section);
        }
      : undefined,
    onUnlinkFromSection: onUnlinkFromSection
      ? (section: LinkableSection, contactId: string) => {
          void onUnlinkFromSection(section, contactId);
        }
      : undefined,
  };
  const hasAbout = detailed && profileViewHasContent("about", contact.profile, linkProps);
  const hasPeople = detailed && profileViewHasContent("people", contact.profile, linkProps);

  const reach =
    contact.emails.length + contact.phones.length + socials.length > 0 ? (
      <PaneSection title="Contact">
        {contact.emails.map((e) => (
          <FieldRow
            key={e.id}
            icon={<Icon name="mail" className="h-4 w-4" />}
            label={channelKindLabel(e.kind, e.label)}
            value={e.value}
            href={mailtoHref(e.value)}
          />
        ))}
        {contact.phones.map((p) => (
          <FieldRow
            key={p.id}
            icon={<Icon name="phone" className="h-4 w-4" />}
            label={channelKindLabel(p.kind, p.label)}
            value={p.value}
            href={telHref(p.value)}
          />
        ))}
        {socials.map((s) => {
          const url = socialUrl(s.platform, s.handle);
          return (
            <FieldRow
              key={s.id}
              icon={<Icon name="at" className="h-4 w-4" />}
              label={s.platform}
              value={s.handle}
              href={url ?? undefined}
              external
            />
          );
        })}
      </PaneSection>
    ) : null;

  const addressSection =
    addresses.length > 0 ? (
      <PaneSection title="Addresses">
        {addresses.map((a) => {
          const [first, ...rest] = addressLines(a);
          return (
            <EntryRow
              key={a.id}
              leading={leadingIcon("pin")}
              title={first}
              inlineMeta={channelKindLabel(a.kind, a.label)}
              subtitle={rest.length > 0 ? rest.join(", ") : undefined}
              trailingMeta={detailed ? periodOf(a) : undefined}
            />
          );
        })}
      </PaneSection>
    ) : null;

  const detailSection =
    dates.length > 0 ? (
      <PaneSection title="Dates">
        {dates.map((d) => (
          <FieldRow
            key={d.id}
            icon={<Icon name="calendar" className="h-4 w-4" />}
            label={dateKindLabel(d.kind, d.label)}
            value={formatDate(d.date)}
          />
        ))}
      </PaneSection>
    ) : null;

  const workSection =
    work.length > 0 ? (
      <PaneSection title="Workplace">
        {work.map((w) => (
          <EntryRow
            key={w.id}
            leading={leadingIcon("briefcase")}
            title={w.organization || w.title}
            subtitle={w.organization && w.title ? w.title : undefined}
            trailingMeta={detailed ? periodOf(w) : undefined}
            note={detailed ? w.note : undefined}
          />
        ))}
      </PaneSection>
    ) : null;

  const notesSection = contact.notes ? (
    <PaneSection title="Notes">
      <ProseBlock text={contact.notes} />
    </PaneSection>
  ) : null;

  const about = hasAbout ? <ContactProfileView part="about" profile={contact.profile} /> : null;

  const people = hasPeople ? (
    <ContactProfileView part="people" profile={contact.profile} linkProps={linkProps} />
  ) : null;

  // The about column, when there is one, takes the right and people balance
  // the left under it; otherwise the contact's own details split across both
  // so neither column sits empty, and people span the width below.
  const columns: [ReactNode, ReactNode] = hasAbout
    ? [<>{reach}{addressSection}{detailSection}{workSection}{notesSection}{people}</>, about]
    : [<>{reach}{detailSection}{workSection}</>, <>{addressSection}{notesSection}</>];
  const twoColumns = Boolean(columns[0]) && Boolean(columns[1]);

  return (
    <aside
      aria-label={`${contact.name} details`}
      className="flex min-h-[28rem] min-w-0 flex-col overflow-hidden bg-bg animate-fade-in-up max-lg:fixed max-lg:inset-0 max-lg:z-(--z-overlay) max-lg:h-dvh max-lg:min-h-0 max-lg:max-h-none max-lg:w-screen lg:h-full lg:min-h-0"
    >
      <div
        className={`relative z-30 shrink-0 overflow-visible border-b px-5 py-4 ${editing ? "border-accent-dim/50 bg-accent/5" : "border-line"}`}
      >
        <div className="flex items-start gap-4">
          <div ref={avatarMenuRef} className="relative z-40 shrink-0">
            <Avatar name={contact.name} avatar={contact.avatar} size="lg" />
            {!readOnly ? (
              <button
                type="button"
                className={`absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-bg bg-surface text-mute shadow-md transition-colors hover:bg-elevated hover:text-accent ${focusRing}`}
                aria-label="Change profile picture"
                title="Change profile picture"
                onClick={() => setAvatarMenuOpen((open) => !open)}
              >
                <Icon name="camera" />
              </button>
            ) : null}
            {avatarMenuOpen ? (
              <div className={`absolute left-0 top-full z-(--z-popover) mt-2 w-40 animate-pop overflow-hidden ${popover}`}>
                <button
                  type="button"
                  className={`w-full rounded-md px-3 py-2 text-left text-xs text-text transition-colors hover:bg-surface ${focusRing}`}
                  onClick={() => avatarInputRef.current?.click()}
                >
                  {contact.avatar ? "Replace photo" : "Upload photo"}
                </button>
                <button
                  type="button"
                  className={`w-full rounded-md px-3 py-2 text-left text-xs text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}
                  disabled={!contact.avatar || busy}
                  onClick={() => {
                    setAvatarMenuOpen(false);
                    setConfirmRemovePhoto(true);
                  }}
                >
                  Remove photo
                </button>
              </div>
            ) : null}
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarUpload}
            />
          </div>

          <div className="min-w-0 flex-1 pt-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="min-w-0 truncate text-xl font-semibold leading-8 tracking-tight text-text">
                {contact.name}
              </h2>
              {contact.pronouns ? (
                <span className="rounded-full border border-line px-2 text-xs font-medium leading-[18px] text-mute">
                  {contact.pronouns}
                </span>
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mute">
              {contact.nickname ? <span>"{contact.nickname}"</span> : null}
              {bookName ? (
                <span
                  className="max-w-[12rem] truncate rounded-full border border-line px-2 font-medium leading-[18px]"
                  style={bookTone ? tonePill(bookTone) : undefined}
                >
                  {bookName}
                </span>
              ) : null}
              {archived ? (
                <span className="rounded-full border border-line bg-panel px-2 font-medium leading-[18px]">
                  Archived
                </span>
              ) : null}
              {editing ? <span className="font-semibold text-accent">Editing contact</span> : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {editing ? (
              <>
                <button
                  type="button"
                  className={btnSecondarySm}
                  onClick={() => onEditingChange(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="contact-detail-form"
                  className={`ml-1 ${btnPrimarySm}`}
                  disabled={busy}
                >
                  {busy ? "Saving" : "Save"}
                </button>
              </>
            ) : (
              <>
                <HeaderButton label="Edit contact" onClick={() => onEditingChange(true)}>
                  <Icon name="pencil" className="h-4 w-4" />
                </HeaderButton>
                {!readOnly && onArchive ? (
                  <HeaderButton
                    label={archived ? "Restore contact" : "Archive contact"}
                    onClick={onArchive}
                    disabled={busy}
                  >
                    <Icon name={archived ? "unarchive" : "archive"} className="h-4 w-4" />
                  </HeaderButton>
                ) : null}
                {!readOnly && onDelete ? (
                  <HeaderButton label="Delete contact" onClick={onDelete} disabled={busy} danger>
                    <Icon name="trash" className="h-4 w-4" />
                  </HeaderButton>
                ) : null}
              </>
            )}
            {editing ? null : (
              <>
                <HeaderDivider />
                <HeaderButton label="Close contact details" onClick={onClose} disabled={busy}>
                  <Icon name="close" className="h-4 w-4" />
                </HeaderButton>
              </>
            )}
          </div>
        </div>
      </div>

      {avatarError ? (
        <p role="alert" className="border-b border-danger/30 bg-danger/10 px-5 py-2.5 text-xs text-danger">
          {avatarError}
        </p>
      ) : null}

      {editing ? (
        <>
          {error ? (
            <p role="alert" className="border-b border-danger/30 bg-danger/10 px-5 py-2.5 text-xs text-danger">
              {error}
            </p>
          ) : null}
          <ContactForm
            formId="contact-detail-form"
            hideFooter
            busy={busy}
            error={error}
            addressBooks={addressBooks}
            initialDraft={contact}
            submitLabel="Save changes"
            detailed={detailed}
            contacts={contacts}
            currentContactId={contact.id}
            onSubmit={async (draft) => {
              if (await onSave(draft)) {
                onEditingChange(false);
              }
            }}
            onCancel={() => onEditingChange(false)}
          />
        </>
      ) : (
        <div className="@container min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div
            className={`grid ${twoColumns ? "@3xl:grid-cols-2 @3xl:[&>*+*]:border-l @3xl:[&>*+*]:border-line/60" : ""}`}
          >
            {columns[0] ? <div className="min-w-0">{columns[0]}</div> : null}
            {columns[1] ? <div className="min-w-0">{columns[1]}</div> : null}
          </div>

          {people && !hasAbout ? (
            <div className="grid @3xl:auto-cols-fr @3xl:grid-flow-col @3xl:[&>*+*]:border-l @3xl:[&>*+*]:border-line/60">
              {people}
            </div>
          ) : null}

          <ContactAttachmentsSection
            session={session}
            attachments={attachments}
            readOnly={readOnly || attachmentsReadOnly}
            onAttachmentsChange={handleAttachmentsChange}
          />

          {contact.createdAt || contact.updatedAt ? (
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-5 py-3 text-2xs text-mute/70">
              {contact.createdAt ? (
                <span>
                  Created: <span className="text-text/70">{formatTimestamp(contact.createdAt)}</span>
                </span>
              ) : null}
              {contact.updatedAt && contact.updatedAt !== contact.createdAt ? (
                <span>
                  Modified: <span className="text-text/70">{formatTimestamp(contact.updatedAt)}</span>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {confirmRemovePhoto ? (
        <ConfirmDialog
          title="Remove photo"
          tone="danger"
          heading="Remove this profile photo?"
          body="The photo is deleted from your encrypted vault on every paired device. You can upload a new one at any time."
          confirmLabel="Remove photo"
          busy={busy}
          onConfirm={() => {
            onSave({ ...contact, avatar: undefined });
            setConfirmRemovePhoto(false);
          }}
          onClose={() => setConfirmRemovePhoto(false)}
        />
      ) : null}

      {linkingSection ? (
        <ContactLinkPicker
          currentContactId={contact.id}
          currentProfile={contact.profile}
          contacts={contacts ?? []}
          section={linkingSection}
          onLink={async (targetId) => {
            await onLinkInSection?.(linkingSection, targetId);
            setLinkingSection(null);
          }}
          onClose={() => setLinkingSection(null)}
          search={linkPickerSearch}
          onSearchChange={setLinkPickerSearch}
        />
      ) : null}
    </aside>
  );
}


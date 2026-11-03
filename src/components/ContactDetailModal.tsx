import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { addressLines, channelKindLabel, dateKindLabel, isOngoing } from "../lib/contact";
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
import { CloseIcon, TrashIcon } from "./FieldControls";
import { EntryRow, FieldRow, HeaderButton, HeaderDivider, PaneSection, ProseBlock } from "./PaneControls";
import { focusRing } from "../lib/styles";
import { ContactLinkPicker } from "./ContactLinkPicker";

type Props = {
  session: Session;
  contact: Contact;
  bookName?: string;
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

function periodOf(row: { start?: string; end?: string; current?: boolean }): string | undefined {
  return formatDateRange(row.start, row.current ? undefined : row.end) || undefined;
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
            icon={<MailIcon />}
            label={channelKindLabel(e.kind, e.label)}
            value={e.value}
            href={`mailto:${e.value}`}
          />
        ))}
        {contact.phones.map((p) => (
          <FieldRow
            key={p.id}
            icon={<PhoneIcon />}
            label={channelKindLabel(p.kind, p.label)}
            value={p.value}
            href={`tel:${p.value}`}
          />
        ))}
        {socials.map((s) => {
          const url = socialUrl(s.platform, s.handle);
          return (
            <FieldRow
              key={s.id}
              icon={<ProfileIcon />}
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
      <PaneSection title={addresses.length > 1 ? "Addresses" : "Address"}>
        {addresses.map((a) => {
          const [first, ...rest] = addressLines(a);
          return (
            <EntryRow
              key={a.id}
              title={first}
              inlineMeta={channelKindLabel(a.kind, a.label)}
              subtitle={rest.length > 0 ? rest.join(", ") : undefined}
              badge={detailed && a.current ? "Current" : undefined}
              trailingMeta={detailed ? periodOf(a) : undefined}
            />
          );
        })}
      </PaneSection>
    ) : null;

  const detailSection =
    dates.length > 0 ? (
      <PaneSection title="Details">
        {dates.map((d) => (
          <FieldRow
            key={d.id}
            icon={<CalendarIcon />}
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
            leading={
              <span className="flex h-5 w-4 items-center justify-center text-mute/60">
                <BriefcaseIcon />
              </span>
            }
            title={w.organization || w.title}
            subtitle={w.organization && w.title ? w.title : undefined}
            badge={detailed && w.current ? "Current" : undefined}
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
      className="flex min-h-[28rem] min-w-0 flex-col overflow-hidden bg-bg animate-fade-in-up max-lg:fixed max-lg:inset-0 max-lg:z-50 max-lg:h-dvh max-lg:min-h-0 max-lg:max-h-none max-lg:w-screen lg:h-full lg:min-h-0"
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
                <CameraIcon />
              </button>
            ) : null}
            {avatarMenuOpen ? (
              <div className="absolute left-0 top-full z-50 mt-2 w-40 overflow-hidden rounded-lg border border-line bg-elevated p-1 shadow-xl">
                <button
                  type="button"
                  className="w-full rounded-md px-3 py-2 text-left text-xs text-text transition-colors hover:bg-surface"
                  onClick={() => avatarInputRef.current?.click()}
                >
                  {contact.avatar ? "Replace photo" : "Upload photo"}
                </button>
                <button
                  type="button"
                  className="w-full rounded-md px-3 py-2 text-left text-xs text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40"
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
                <span className="max-w-[12rem] truncate rounded-full border border-line px-2 font-medium leading-[18px]">
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
                  className={`h-8 rounded-lg border border-line bg-surface px-3 text-xs font-medium text-mute transition-colors hover:border-line-light hover:text-text disabled:opacity-50 ${focusRing}`}
                  onClick={() => onEditingChange(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="contact-detail-form"
                  className={`ml-1 h-8 rounded-lg bg-accent px-3.5 text-xs font-semibold text-bg transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-50 ${focusRing}`}
                  disabled={busy}
                >
                  {busy ? "Saving" : "Save"}
                </button>
              </>
            ) : (
              <>
                <HeaderButton label="Edit contact" onClick={() => onEditingChange(true)}>
                  <EditIcon />
                </HeaderButton>
                {!readOnly && onArchive ? (
                  <HeaderButton
                    label={archived ? "Restore contact" : "Archive contact"}
                    onClick={onArchive}
                    disabled={busy}
                  >
                    {archived ? <UnarchiveIcon /> : <ArchiveIcon />}
                  </HeaderButton>
                ) : null}
                {!readOnly && onDelete ? (
                  <HeaderButton label="Delete contact" onClick={onDelete} disabled={busy} danger>
                    <TrashIcon />
                  </HeaderButton>
                ) : null}
              </>
            )}
            {editing ? null : (
              <>
                <HeaderDivider />
                <HeaderButton label="Close contact details" onClick={onClose} disabled={busy}>
                  <CloseIcon />
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
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-5 py-3 text-[11px] text-mute/70">
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

const icon = "h-4 w-4";

function CameraIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M1 8a2 2 0 0 1 2-2h.93a2 2 0 0 0 1.664-.89l.812-1.22A2 2 0 0 1 8.07 3h3.86a2 2 0 0 1 1.664.89l.812 1.22A2 2 0 0 0 16.07 6H17a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8Zm13.5 3a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM10 14a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg className={icon} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" />
      <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0 0 10 3H4.75A2.75 2.75 0 0 0 2 5.75v9.5A2.75 2.75 0 0 0 4.75 18h9.5A2.75 2.75 0 0 0 17 15.25V10a.75.75 0 0 0-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5Z" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg className={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4h18v4H3z" />
      <path d="M5 8h14v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" />
      <path d="M10 12h4" />
    </svg>
  );
}

function UnarchiveIcon() {
  return (
    <svg className={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4h18v4H3z" />
      <path d="M5 8h14v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" />
      <path d="M12 17v-5m0 0-2 2m2-2 2 2" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg className={icon} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M3 4a2 2 0 0 0-2 2v1.161l8.441 4.221a1.25 1.25 0 0 0 1.118 0L19 7.162V6a2 2 0 0 0-2-2H3Z" />
      <path d="m19 8.839-7.77 3.885a2.75 2.75 0 0 1-2.46 0L1 8.839V14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.839Z" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg className={icon} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M2 3.5A1.5 1.5 0 0 1 3.5 2h1.148a1.5 1.5 0 0 1 1.465 1.175l.716 3.223a1.5 1.5 0 0 1-1.052 1.767l-.933.267c-.41.117-.643.555-.48.95a11.542 11.542 0 0 0 6.254 6.254c.395.163.833-.07.95-.48l.267-.933a1.5 1.5 0 0 1 1.767-1.052l3.223.716A1.5 1.5 0 0 1 18 15.352V16.5a1.5 1.5 0 0 1-1.5 1.5H15c-1.149 0-2.263-.15-3.326-.43A13.022 13.022 0 0 1 2.43 8.326 13.019 13.019 0 0 1 2 5V3.5Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg className={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg className={icon} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M5.75 2a.75.75 0 0 1 .75.75V4h7V2.75a.75.75 0 0 1 1.5 0V4h.25A2.75 2.75 0 0 1 18 6.75v8.5A2.75 2.75 0 0 1 15.25 18H4.75A2.75 2.75 0 0 1 2 15.25v-8.5A2.75 2.75 0 0 1 4.75 4H5V2.75A.75.75 0 0 1 5.75 2Zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function BriefcaseIcon() {
  return (
    <svg className={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
      <path d="M2 13h20" />
    </svg>
  );
}

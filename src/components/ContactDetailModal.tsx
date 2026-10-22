import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { addressLines, channelKindLabel, dateKindLabel } from "../lib/contact";
import type { LinkableSection } from "../lib/contactProfile";
import { optimizeAvatar } from "../lib/image";
import type { Session } from "../lib/client";
import type { AddressBook, Contact, ContactDraft, NoteAttachment } from "../lib/types";
import { Avatar } from "./ContactCard";
import { ConfirmDialog } from "./ConfirmDialog";
import { ContactForm } from "./ContactForm";
import { ContactAttachmentsSection } from "./ContactAttachmentsSection";
import { ContactProfileView } from "./ContactProfileView";
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
  editing,
  onEditingChange,
  detailed = false,
  contacts,
  onLinkInSection,
  onUnlinkFromSection,
  onNavigateToContact,
}: Props) {
  const archived = contact.archived === true;
  const addresses = addressLines(contact.address);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [confirmRemovePhoto, setConfirmRemovePhoto] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<NoteAttachment[]>(contact.attachments ?? []);
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
    return await onSave({ ...contact, attachments: next.length > 0 ? next : undefined });
  }

  return (
    <aside
      aria-label={`${contact.name} details`}
      className="flex min-h-[28rem] min-w-0 flex-col overflow-hidden bg-bg animate-fade-in-up max-lg:fixed max-lg:inset-0 max-lg:z-50 max-lg:h-dvh max-lg:min-h-0 max-lg:max-h-none max-lg:w-screen lg:h-full lg:min-h-0"
    >
      <div className="relative z-30 shrink-0 overflow-visible border-b border-line px-5 py-4">
        <div className="flex items-center gap-4 pr-36">
            <div ref={avatarMenuRef} className="relative z-40 shrink-0">
            <Avatar name={contact.name} avatar={contact.avatar} size="lg" />
            {!readOnly ? <button
              type="button"
              className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-panel bg-surface text-mute shadow-md transition-colors hover:bg-accent/15 hover:text-accent"
              aria-label="Change profile picture"
              title="Change profile picture"
              onClick={() => setAvatarMenuOpen((open) => !open)}
            >
              <CameraIcon />
            </button> : null}
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
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-semibold tracking-tight text-text">
                {contact.name}
              </h2>
              {contact.pronouns ? (
                <span className="rounded-md border border-line bg-panel px-2 py-0.5 text-xs text-mute font-medium">
                  {contact.pronouns}
                </span>
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mute">
              {contact.nickname ? <span>"{contact.nickname}"</span> : null}
              {bookName ? <span>{bookName}</span> : null}
              {archived ? (
                <span className="rounded-md border border-line bg-panel px-2 py-0.5 font-medium">
                  Archived
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className={`absolute right-4 top-4 flex items-center gap-1.5 ${editing ? "hidden" : ""}`}>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-accent-dim/40 bg-accent/10 text-accent transition-colors hover:border-accent-dim hover:bg-accent/20 disabled:opacity-50"
            aria-label="Edit contact"
            title="Edit contact"
            onClick={() => onEditingChange(true)}
          >
            <EditIcon />
          </button>
          {!readOnly && onArchive ? (
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface/40 text-mute transition-colors hover:border-line-light hover:text-accent disabled:opacity-50"
              aria-label={archived ? "Restore contact" : "Archive contact"}
              title={archived ? "Restore to its address book" : "Move to the Archive"}
              onClick={onArchive}
              disabled={busy}
            >
              {archived ? <UnarchiveIcon /> : <ArchiveIcon />}
            </button>
          ) : null}
          {!readOnly && onDelete ? (
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-danger/20 bg-danger/5 text-danger/70 transition-colors hover:border-danger/40 hover:bg-danger/10 hover:text-danger disabled:opacity-50"
              aria-label="Delete contact"
              title="Delete contact"
              onClick={onDelete}
              disabled={busy}
            >
              <TrashIcon />
            </button>
          ) : null}
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface/40 text-mute transition-colors hover:border-line-light hover:text-text disabled:opacity-50"
            aria-label="Close contact details"
            title="Close contact details"
            onClick={onClose}
            disabled={busy}
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M6.28 5.22a.75.75 0 1 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06l3.72-3.72 3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>
      </div>

      {editing ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-accent-dim/50 bg-accent/10 px-5 py-2">
          <span className="min-w-0 truncate text-xs font-semibold text-accent">
            Editing contact
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="h-8 rounded-md border border-line bg-surface px-3 text-xs font-medium text-mute transition-colors hover:border-line-light hover:text-text disabled:opacity-50"
              onClick={() => onEditingChange(false)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="contact-detail-form"
              className="h-8 rounded-md bg-accent px-3.5 text-xs font-semibold text-bg transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
              disabled={busy}
            >
              {busy ? "Saving" : "Save"}
            </button>
          </div>
        </div>
      ) : null}

      {avatarError ? <p role="alert" className="border-b border-danger/30 bg-danger/10 px-5 py-2.5 text-xs text-danger">{avatarError}</p> : null}

      {editing ? (
        <>
          {error ? <p role="alert" className="border-b border-danger/30 bg-danger/10 px-5 py-2.5 text-xs text-danger">{error}</p> : null}
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
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="2xl:columns-2 2xl:gap-6">
          {/* Emails */}
          {contact.emails.length > 0 ? (
            <Section title="Emails">
              <div>
                {contact.emails.map((e) => (
                  <a
                    key={e.id}
                    href={`mailto:${e.value}`}
                    className="group flex items-center justify-between gap-3 border-b border-line/60 px-5 py-2.5 text-sm transition-colors hover:bg-surface/40"
                  >
                    <div className="flex min-w-0 flex-1 items-baseline gap-3">
                      <span className="w-20 shrink-0 truncate text-[11px] font-medium uppercase tracking-wider text-mute/70">
                        {channelKindLabel(e.kind, e.label)}
                      </span>
                      <span className="truncate font-medium text-text transition-colors group-hover:text-accent">
                        {e.value}
                      </span>
                    </div>
                    <svg
                      className="h-4 w-4 shrink-0 text-mute/40 transition-colors group-hover:text-accent"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path d="M3 4a2 2 0 0 0-2 2v1.161l8.441 4.221a1.25 1.25 0 0 0 1.118 0L19 7.162V6a2 2 0 0 0-2-2H3Z" />
                      <path d="m19 8.839-7.77 3.885a2.75 2.75 0 0 1-2.46 0L1 8.839V14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.839Z" />
                    </svg>
                  </a>
                ))}
              </div>
            </Section>
          ) : null}

          {/* Phones */}
          {contact.phones.length > 0 ? (
            <Section title="Phones">
              <div>
                {contact.phones.map((p) => (
                  <a
                    key={p.id}
                    href={`tel:${p.value}`}
                    className="group flex items-center justify-between gap-3 border-b border-line/60 px-5 py-2.5 text-sm transition-colors hover:bg-surface/40"
                  >
                    <div className="flex min-w-0 flex-1 items-baseline gap-3">
                      <span className="w-20 shrink-0 truncate text-[11px] font-medium uppercase tracking-wider text-mute/70">
                        {channelKindLabel(p.kind, p.label)}
                      </span>
                      <span className="truncate font-medium text-text transition-colors group-hover:text-accent">
                        {p.value}
                      </span>
                    </div>
                    <svg
                      className="h-4 w-4 shrink-0 text-mute/40 transition-colors group-hover:text-accent"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M2 3.5A1.5 1.5 0 0 1 3.5 2h1.148a1.5 1.5 0 0 1 1.465 1.175l.716 3.223a1.5 1.5 0 0 1-1.052 1.767l-.933.267c-.41.117-.643.555-.48.95a11.542 11.542 0 0 0 6.254 6.254c.395.163.833-.07.95-.48l.267-.933a1.5 1.5 0 0 1 1.767-1.052l3.223.716A1.5 1.5 0 0 1 18 15.352V16.5a1.5 1.5 0 0 1-1.5 1.5H15c-1.149 0-2.263-.15-3.326-.43A13.022 13.022 0 0 1 2.43 8.326 13.019 13.019 0 0 1 2 5V3.5Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </a>
                ))}
              </div>
            </Section>
          ) : null}

          {/* Dates */}
          {contact.dates && contact.dates.length > 0 ? (
            <Section title="Dates">
              <div>
                {contact.dates.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between gap-3 border-b border-line/60 px-5 py-2.5 text-sm"
                  >
                    <div className="flex min-w-0 flex-1 items-baseline gap-3">
                      <span className="w-20 shrink-0 truncate text-[11px] font-medium uppercase tracking-wider text-mute/70">
                        {dateKindLabel(d.kind, d.label)}
                      </span>
                      <span className="truncate font-medium text-text">
                        {formatDate(d.date)}
                      </span>
                    </div>
                    <svg
                      className="h-4 w-4 shrink-0 text-mute/30"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M5.75 2a.75.75 0 0 1 .75.75V4h7V2.75a.75.75 0 0 1 1.5 0V4h.25A2.75 2.75 0 0 1 18 6.75v8.5A2.75 2.75 0 0 1 15.25 18H4.75A2.75 2.75 0 0 1 2 15.25v-8.5A2.75 2.75 0 0 1 4.75 4H5V2.75A.75.75 0 0 1 5.75 2Zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          {/* Social Profiles */}
          {contact.socials && contact.socials.length > 0 ? (
            <Section title="Social Profiles">
              <div>
                {contact.socials.map((s) => {
                  const url = socialUrl(s.platform, s.handle);
                  const Content = (
                    <>
                      <div className="flex min-w-0 flex-1 items-baseline gap-3">
                        <span className="w-20 shrink-0 truncate text-[11px] font-medium uppercase tracking-wider text-mute/70">
                          {s.platform}
                        </span>
                        <span className="truncate font-medium text-text transition-colors group-hover:text-accent">
                          {s.handle}
                        </span>
                      </div>
                      {url ? (
                        <svg
                          className="h-4 w-4 shrink-0 text-mute/40 transition-colors group-hover:text-accent"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path
                            fillRule="evenodd"
                            d="M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-4a.75.75 0 0 1 1.5 0v4A2.25 2.25 0 0 1 12.75 17h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h4a.75.75 0 0 1 0 1.5h-4Z"
                            clipRule="evenodd"
                          />
                          <path
                            fillRule="evenodd"
                            d="M6.194 12.753a.75.75 0 0 0 1.06 1.06l7.22-7.22v2.657a.75.75 0 0 0 1.5 0v-4.5a.75.75 0 0 0-.75-.75h-4.5a.75.75 0 0 0 0 1.5h2.657l-7.187 7.253Z"
                            clipRule="evenodd"
                          />
                        </svg>
                      ) : null}
                    </>
                  );

                  return url ? (
                    <a
                      key={s.id}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center justify-between gap-3 border-b border-line/60 px-5 py-2.5 text-sm transition-colors hover:bg-surface/40"
                    >
                      {Content}
                    </a>
                  ) : (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-3 border-b border-line/60 px-5 py-2.5 text-sm"
                    >
                      {Content}
                    </div>
                  );
                })}
              </div>
            </Section>
          ) : null}

          {/* Work */}
          {contact.work.length > 0 ? (
            <Section title="Work">
              <div>
                {contact.work.map((w) => (
                  <div
                    key={w.id}
                    className="border-b border-line/60 px-5 py-3 text-sm"
                  >
                    <p className="font-medium text-text">{w.organization}</p>
                    {w.title ? (
                      <p className="text-xs text-mute mt-0.5">{w.title}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          {/* Address */}
          {addresses.length > 0 ? (
            <Section title="Address">
              <div className="border-b border-line/60 px-5 py-3 text-sm leading-relaxed text-text">
                {addresses.map((line, idx) => (
                  <p key={idx}>{line}</p>
                ))}
              </div>
            </Section>
          ) : null}

          {/* Notes */}
          {contact.notes ? (
            <Section title="Notes">
              <div className="border-b border-line/60 px-5 py-3 text-sm leading-relaxed text-text whitespace-pre-wrap">
                {contact.notes}
              </div>
            </Section>
          ) : null}

          {detailed ? (
            <ContactProfileView
              profile={contact.profile}
              linkProps={{
                contacts,
                readOnly,
                onNavigateToContact,
                onLinkInSection: onLinkInSection
                  ? (section) => { setLinkPickerSearch(""); setLinkingSection(section); }
                  : undefined,
                onUnlinkFromSection: onUnlinkFromSection
                  ? (section, contactId) => { void onUnlinkFromSection(section, contactId); }
                  : undefined,
              }}
            />
          ) : null}

          <ContactAttachmentsSection
            session={session}
            attachments={attachments}
            readOnly={readOnly}
            onAttachmentsChange={handleAttachmentsChange}
          />

          </div>
        </div>

        {/* Metadata timestamps */}
        {contact.createdAt || contact.updatedAt ? (
          <div className="flex shrink-0 flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-line/50 px-5 py-3 text-[11px] text-mute/80">
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

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="break-inside-avoid">
      <h4 className="sticky top-0 z-10 border-b border-line/60 bg-surface/80 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-mute backdrop-blur-sm">
        {title}
      </h4>
      {children}
    </section>
  );
}

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
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" />
      <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0 0 10 3H4.75A2.75 2.75 0 0 0 2 5.75v9.5A2.75 2.75 0 0 0 4.75 18h9.5A2.75 2.75 0 0 0 17 15.25V10a.75.75 0 0 0-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5Z" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4h18v4H3z" />
      <path d="M5 8h14v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" />
      <path d="M10 12h4" />
    </svg>
  );
}

function UnarchiveIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4h18v4H3z" />
      <path d="M5 8h14v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" />
      <path d="M12 17v-5m0 0-2 2m2-2 2 2" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}


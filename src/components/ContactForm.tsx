import { useEffect, useState, type FormEvent } from "react";
import {
  CHANNEL_KINDS,
  MAX_CONTACT_NOTES_CHARS,
  addressLines,
  channelKindLabel,
  contactValidationError,
  emptyChannel,
  emptyDate,
  emptyDraft,
  emptySocial,
  emptyWork,
} from "../lib/contact";
import { DEFAULT_ADDRESS_BOOK_ID } from "../lib/addressBook";
import { emptyProfile, profileOf } from "../lib/contactProfile";
import {
  addLink,
  btnPrimary,
  btnSecondary,
  field,
  fieldBase,
  ghost,
  primary,
  secondary,
  selectField,
} from "../lib/styles";
import type {
  AddressBook,
  ContactAddress,
  ContactChannel,
  ContactChannelKind,
  ContactDate,
  ContactDateKind,
  ContactDraft,
  ContactProfile,
  ContactSocial,
  ContactWork,
} from "../lib/types";
import { AddIcon, FormSection as Section, RemoveButton, labelClass } from "./FieldControls";
import { ContactProfileFields } from "./ContactProfileFields";

type Props = {
  busy: boolean;
  error?: string | null;
  addressBooks: AddressBook[];
  initialDraft?: ContactDraft;
  submitLabel?: string;
  formId?: string;
  hideFooter?: boolean;
  /** Detailed contact mode: adds the relationship sections. */
  detailed?: boolean;
  onSubmit: (draft: ContactDraft) => void;
  onCancel: () => void;
  onDelete?: () => void;
};

function cloneDraft(source?: ContactDraft): ContactDraft {
  if (!source) {
    return { ...emptyDraft(), profile: profileOf() };
  }
  return {
    ...source,
    emails: source.emails ? source.emails.map((e) => ({ ...e })) : [],
    phones: source.phones ? source.phones.map((p) => ({ ...p })) : [],
    work: source.work ? source.work.map((w) => ({ ...w })) : [],
    dates: source.dates ? source.dates.map((d) => ({ ...d })) : [],
    socials: source.socials ? source.socials.map((s) => ({ ...s })) : [],
    address: source.address ? { ...source.address } : {},
    profile: profileOf(source.profile),
  };
}

export function ContactForm({
  busy,
  error,
  addressBooks,
  initialDraft,
  submitLabel,
  formId,
  hideFooter = false,
  detailed = false,
  onSubmit,
  onCancel,
  onDelete,
}: Props) {
  const [draft, setDraft] = useState<ContactDraft>(() => cloneDraft(initialDraft));
  const [showAddress, setShowAddress] = useState(
    () => Boolean(initialDraft?.address && addressLines(initialDraft.address).length > 0),
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  /*
   * The photo is the one field edited from outside this form: the detail pane
   * keeps its control in the header, which stays live while editing and writes
   * straight to the vault. The draft above is a snapshot taken on mount, so
   * without this a photo added mid-edit was saved and then deleted again by the
   * submit that followed, and one removed mid-edit came back.
   *
   * Returning `current` unchanged when it already matches keeps this from
   * re-rendering on mount and from fighting the form over a field it does own.
   */
  useEffect(() => {
    const avatar = initialDraft?.avatar;
    setDraft((current) => (current.avatar === avatar ? current : { ...current, avatar }));
  }, [initialDraft?.avatar]);

  /*
   * The same split, from the other direction: deleting an address book from the
   * sidebar moves its contacts elsewhere, and can happen while this form is open
   * on one of them. The select would then be showing nothing, since its value
   * matches no option, and the submit would write an id no book has.
   *
   * Falls back to a book that exists rather than to `initialDraft`, which still
   * names the deleted one: the detail pane is not resynced by a refresh. Only
   * applied once the draft's own book is gone, so a book chosen here is never
   * overridden.
   */
  useEffect(() => {
    if (addressBooks.length === 0) return;
    setDraft((current) => {
      if (addressBooks.some((book) => book.id === current.addressBookId)) return current;
      const fallback =
        addressBooks.find((book) => book.id === DEFAULT_ADDRESS_BOOK_ID) ?? addressBooks[0];
      return { ...current, addressBookId: fallback.id };
    });
  }, [addressBooks]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim()) {
      return;
    }
    const problem = contactValidationError(draft);
    setValidationError(problem);
    if (problem) {
      return;
    }
    onSubmit(draft);
  }

  function patch(partial: Partial<ContactDraft>) {
    setValidationError(null);
    setDraft((current) => ({ ...current, ...partial }));
  }

  function patchProfile(profile: ContactProfile) {
    setValidationError(null);
    setDraft((current) => ({ ...current, profile }));
  }

  function patchAddress(partial: Partial<ContactAddress>) {
    setDraft((current) => ({
      ...current,
      address: { ...current.address, ...partial },
    }));
  }

  function clearAddress() {
    setDraft((current) => ({ ...current, address: {} }));
    setShowAddress(false);
  }

  const addressOpen = showAddress || addressLines(draft.address).length > 0;
  return (
    <form
      id={formId}
      onSubmit={handleSubmit}
      autoComplete="off"
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
        <div className="mx-auto w-full max-w-3xl">
        <Section title="Identity" first>
          {addressBooks.length > 0 ? (
            <label className={`${labelClass} mb-3`}>
              Address book
              <select
                value={draft.addressBookId}
                onChange={(e) => patch({ addressBookId: e.target.value })}
                className={`${selectField} mt-1.5`}
              >
                {addressBooks.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={labelClass}>
              Full name
              <input
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
                className={field}
                autoFocus
                required
              />
            </label>
            <label className={labelClass}>
              Nickname
              <input
                value={draft.nickname ?? ""}
                onChange={(e) => patch({ nickname: e.target.value })}
                className={field}
              />
            </label>
            <label className={labelClass}>
              Pronouns
              <input
                value={draft.pronouns ?? ""}
                onChange={(e) => patch({ pronouns: e.target.value })}
                placeholder="e.g. they/them"
                className={field}
              />
            </label>
          </div>
        </Section>

        <Section title="Emails">
          <ChannelList
            channels={draft.emails}
            valuePlaceholder="Email"
            inputType="email"
            addLabel="+ Email"
            onChange={(emails) => patch({ emails })}
            newChannel={() => emptyChannel("home")}
          />
        </Section>

        <Section title="Phones">
          <ChannelList
            channels={draft.phones}
            valuePlaceholder="Phone"
            inputType="tel"
            addLabel="+ Phone"
            onChange={(phones) => patch({ phones })}
            newChannel={() => emptyChannel("mobile")}
          />
        </Section>

        <Section title="Dates">
          <DatesList
            dates={draft.dates ?? []}
            onChange={(dates) => patch({ dates })}
          />
        </Section>

        <Section title="Social Profiles">
          <SocialList
            socials={draft.socials ?? []}
            onChange={(socials) => patch({ socials })}
          />
        </Section>

        <Section
          title="Address"
          action={
            addressOpen ? (
              <button type="button" className={ghost} onClick={clearAddress}>
                Clear
              </button>
            ) : null
          }
        >
          {addressOpen ? (
            <div className="grid gap-3">
              <label className={labelClass}>
                Street line 1
                <input
                  value={draft.address?.street1 ?? ""}
                  onChange={(e) =>
                    patchAddress({ street1: e.target.value })
                  }
                  className={field}
                />
              </label>
              <label className={labelClass}>
                Street line 2
                <input
                  value={draft.address?.street2 ?? ""}
                  onChange={(e) =>
                    patchAddress({ street2: e.target.value })
                  }
                  className={field}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={labelClass}>
                  City / town
                  <input
                    value={draft.address?.locality ?? ""}
                    onChange={(e) =>
                      patchAddress({ locality: e.target.value })
                    }
                    className={field}
                  />
                </label>
                <label className={labelClass}>
                  Region / state / province
                  <input
                    value={draft.address?.region ?? ""}
                    onChange={(e) =>
                      patchAddress({ region: e.target.value })
                    }
                    className={field}
                  />
                </label>
                <label className={labelClass}>
                  Postal code
                  <input
                    value={draft.address?.postcode ?? ""}
                    onChange={(e) =>
                      patchAddress({ postcode: e.target.value })
                    }
                    className={field}
                  />
                </label>
                <label className={labelClass}>
                  Country
                  <input
                    value={draft.address?.country ?? ""}
                    onChange={(e) =>
                      patchAddress({ country: e.target.value })
                    }
                    className={field}
                  />
                </label>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={`${addLink} inline-flex items-center gap-1.5`}
              onClick={() => setShowAddress(true)}
            >
              <AddIcon />
              Address
            </button>
          )}
        </Section>

        <Section title="Work">
          <WorkList work={draft.work} onChange={(work) => patch({ work })} />
        </Section>

        <Section title="Notes">
          <div className="grid gap-1.5">
            <textarea
              value={draft.notes ?? ""}
              onChange={(e) => patch({ notes: e.target.value })}
              placeholder="Add notes, context, or meeting reminders…"
              rows={3}
              className={`${fieldBase} h-auto min-h-[5.5rem] py-2.5 resize-y leading-relaxed`}
            />
            <NotesCounter length={(draft.notes ?? "").length} detailed={detailed} />
          </div>
        </Section>

        {detailed ? (
          <ContactProfileFields profile={draft.profile ?? emptyProfile()} onChange={patchProfile} />
        ) : null}
        </div>
      </div>

      {validationError ? (
        <p
          role="alert"
          className="shrink-0 border-t border-danger/30 bg-danger/10 px-5 py-2.5 text-xs leading-relaxed text-danger"
        >
          {validationError}
        </p>
      ) : null}

      {!hideFooter ? <div className="shrink-0 border-t border-line bg-panel">
        {error ? (
          <p role="alert" className="px-5 pt-3 text-sm text-danger">{error}</p>
        ) : null}
        {onDelete ? (
          <div className="flex items-center justify-between gap-3 px-5 py-4">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-danger/80 transition-colors hover:bg-danger/10 hover:text-danger active:scale-[0.98] disabled:opacity-50 cursor-pointer"
              onClick={onDelete}
              disabled={busy}
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
              Delete
            </button>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                className={btnSecondary}
                onClick={onCancel}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className={btnPrimary}
              >
                {busy ? "Please wait…" : (submitLabel ?? "Save")}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-3 px-5 py-4">
            <button
              type="button"
              className={`${secondary} flex-1 cursor-pointer`}
              onClick={onCancel}
              disabled={busy}
            >
              Cancel
            </button>
            <button type="submit" disabled={busy} className={`${primary} flex-1 cursor-pointer`}>
              {busy ? "Please wait…" : (submitLabel ?? (initialDraft ? "Save" : "Add"))}
            </button>
          </div>
        )}
      </div> : null}
    </form>
  );
}

/**
 * Appears only as the field fills up: a counter on an empty box reads as a limit
 * the user is meant to aim for.
 */
function NotesCounter({ length, detailed }: { length: number; detailed: boolean }) {
  if (length <= MAX_CONTACT_NOTES_CHARS * 0.8) {
    return null;
  }
  const over = length > MAX_CONTACT_NOTES_CHARS;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11px]">
      {over && !detailed ? (
        <span className="text-mute">
          Keeping history on people? Turn on detailed contacts in Settings.
        </span>
      ) : (
        <span />
      )}
      <span className={over ? "text-danger" : "text-mute"}>
        {length.toLocaleString()} / {MAX_CONTACT_NOTES_CHARS.toLocaleString()}
      </span>
    </div>
  );
}

function ChannelList({
  channels,
  valuePlaceholder,
  inputType,
  addLabel,
  onChange,
  newChannel,
}: {
  channels: ContactChannel[];
  valuePlaceholder: string;
  inputType: "email" | "tel";
  addLabel: string;
  onChange: (channels: ContactChannel[]) => void;
  newChannel: () => ContactChannel;
}) {
  function update(id: string, patch: Partial<ContactChannel>) {
    onChange(
      channels.map((channel) =>
        channel.id === id ? { ...channel, ...patch } : channel,
      ),
    );
  }

  return (
    <div className="grid min-w-0 gap-2">
      {channels.map((channel) => (
        <div
          key={channel.id}
          className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)_2.5rem] items-start gap-2 sm:grid-cols-[6rem_minmax(0,1fr)_2.5rem]"
        >
          <select
            value={channel.kind}
            aria-label="Type"
            onChange={(e) => {
              const kind = e.target.value as ContactChannelKind;
              update(channel.id, {
                kind,
                label: kind === "custom" ? channel.label : undefined,
              });
            }}
            className={selectField}
          >
            {CHANNEL_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {channelKindLabel(kind)}
              </option>
            ))}
          </select>
          <div className="grid min-w-0 gap-2">
            <input
              type={inputType}
              value={channel.value}
              onChange={(e) =>
                update(channel.id, { value: e.target.value })
              }
              placeholder={valuePlaceholder}
              className={fieldBase}
            />
            {channel.kind === "custom" ? (
              <input
                value={channel.label ?? ""}
                onChange={(e) =>
                  update(channel.id, { label: e.target.value })
                }
                placeholder="Label"
                aria-label="Custom label"
                className={fieldBase}
              />
            ) : null}
          </div>
          <RemoveButton
            label={`Remove ${valuePlaceholder.toLowerCase()}`}
            onClick={() =>
              onChange(channels.filter((row) => row.id !== channel.id))
            }
          />
        </div>
      ))}
      <button
        type="button"
        className={`${addLink} inline-flex items-center gap-1.5`}
        onClick={() => onChange([...channels, newChannel()])}
      >
        <AddIcon />
        {addLabel.replace(/^\+\s*/, "")}
      </button>
    </div>
  );
}

function WorkList({
  work,
  onChange,
}: {
  work: ContactWork[];
  onChange: (work: ContactWork[]) => void;
}) {
  function update(id: string, patch: Partial<ContactWork>) {
    onChange(
      work.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  }

  return (
    <div className="grid min-w-0 gap-2">
      {work.map((row) => (
        <div key={row.id} className="flex min-w-0 items-start gap-2">
          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
            <input
              value={row.organization}
              onChange={(e) =>
                update(row.id, { organization: e.target.value })
              }
              placeholder="Workplace"
              aria-label="Workplace"
              className={fieldBase}
            />
            <input
              value={row.title ?? ""}
              onChange={(e) =>
                update(row.id, { title: e.target.value })
              }
              placeholder="Occupation"
              aria-label="Occupation"
              className={fieldBase}
            />
          </div>
          <RemoveButton
            label="Remove workplace"
            onClick={() =>
              onChange(work.filter((item) => item.id !== row.id))
            }
          />
        </div>
      ))}
      <button
        type="button"
        className={`${addLink} inline-flex items-center gap-1.5`}
        onClick={() => onChange([...work, emptyWork()])}
      >
        <AddIcon />
        Workplace
      </button>
    </div>
  );
}

const DATE_KINDS: { kind: ContactDateKind; label: string }[] = [
  { kind: "birthday", label: "Birthday" },
  { kind: "anniversary", label: "Anniversary" },
  { kind: "custom", label: "Custom" },
];

function DatesList({
  dates,
  onChange,
}: {
  dates: ContactDate[];
  onChange: (dates: ContactDate[]) => void;
}) {
  function update(id: string, patch: Partial<ContactDate>) {
    onChange(
      dates.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  }

  return (
    <div className="grid min-w-0 gap-2">
      {dates.map((row) => (
        <div
          key={row.id}
          className="grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)_2.5rem] items-start gap-2 sm:grid-cols-[7.5rem_minmax(0,1fr)_2.5rem]"
        >
          <select
            value={row.kind}
            aria-label="Date type"
            onChange={(e) => {
              const kind = e.target.value as ContactDateKind;
              update(row.id, {
                kind,
                label: kind === "custom" ? row.label : undefined,
              });
            }}
            className={selectField}
          >
            {DATE_KINDS.map((opt) => (
              <option key={opt.kind} value={opt.kind}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="grid min-w-0 gap-2">
            <input
              type="date"
              value={row.date}
              onChange={(e) => update(row.id, { date: e.target.value })}
              aria-label="Date"
              className={fieldBase}
            />
            {row.kind === "custom" ? (
              <input
                value={row.label ?? ""}
                onChange={(e) => update(row.id, { label: e.target.value })}
                placeholder="Label (e.g. Graduation)"
                aria-label="Custom date label"
                className={fieldBase}
              />
            ) : null}
          </div>
          <RemoveButton
            label="Remove date"
            onClick={() => onChange(dates.filter((item) => item.id !== row.id))}
          />
        </div>
      ))}
      <button
        type="button"
        className={`${addLink} inline-flex items-center gap-1.5`}
        onClick={() => onChange([...dates, emptyDate()])}
      >
        <AddIcon />
        Date
      </button>
    </div>
  );
}

function SocialList({
  socials,
  onChange,
}: {
  socials: ContactSocial[];
  onChange: (socials: ContactSocial[]) => void;
}) {
  function update(id: string, patch: Partial<ContactSocial>) {
    onChange(
      socials.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  }

  return (
    <div className="grid min-w-0 gap-2">
      {socials.map((row) => (
        <div key={row.id} className="flex min-w-0 items-start gap-2">
          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
            <input
              value={row.platform}
              onChange={(e) => update(row.id, { platform: e.target.value })}
              placeholder="Platform"
              aria-label="Social platform"
              list={`social-platforms-${row.id}`}
              className={fieldBase}
            />
            <datalist id={`social-platforms-${row.id}`}>
              <option value="GitHub" />
              <option value="Twitter / X" />
              <option value="LinkedIn" />
              <option value="Instagram" />
              <option value="Bluesky" />
              <option value="Discord" />
              <option value="Telegram" />
              <option value="Mastodon" />
            </datalist>
            <input
              value={row.handle}
              onChange={(e) => update(row.id, { handle: e.target.value })}
              placeholder="Username or handle"
              aria-label="Username or handle"
              className={fieldBase}
            />
          </div>
          <RemoveButton
            label="Remove social profile"
            onClick={() => onChange(socials.filter((item) => item.id !== row.id))}
          />
        </div>
      ))}
      <button
        type="button"
        className={`${addLink} inline-flex items-center gap-1.5`}
        onClick={() => onChange([...socials, emptySocial()])}
      >
        <AddIcon />
        Social Profile
      </button>
    </div>
  );
}

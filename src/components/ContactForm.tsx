import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ADDRESS_KINDS,
  CHANNEL_KINDS,
  MAX_CONTACT_NOTES_CHARS,
  channelKindLabel,
  contactValidationError,
  emptyAddress,
  emptyChannel,
  emptyDate,
  emptyDraft,
  emptySocial,
  emptyWork,
  isOngoing,
} from "../lib/contact";
import { DEFAULT_ADDRESS_BOOK_ID } from "../lib/addressBook";
import { emptyProfile, profileOf } from "../lib/contactProfile";
import { btnPrimary, btnSecondary, field, fieldBase, selectField } from "../lib/styles";
import type {
  AddressBook,
  Contact,
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
import {
  DateRange,
  EntryCard,
  EntryList,
  FieldPair,
  FormSection as Section,
  PillInput,
  ProseField,
  ValueRow,
  labelClass,
} from "./FieldControls";
import { ContactProfileFields } from "./ContactProfileFields";
import { ErrorMessage } from "./ErrorMessage";

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
  contacts?: Contact[];
  currentContactId?: string;
  onSubmit: (draft: ContactDraft) => void;
  onCancel: () => void;
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
    addresses: source.addresses ? source.addresses.map((a) => ({ ...a })) : [],
    profile: profileOf(source.profile),
  };
}

export function ContactForm({
  busy,
  error,
  addressBooks: allBooks,
  initialDraft,
  submitLabel,
  formId,
  hideFooter = false,
  detailed = false,
  contacts,
  currentContactId,
  onSubmit,
  onCancel,
}: Props) {
  const [draft, setDraft] = useState<ContactDraft>(() => cloneDraft(initialDraft));
  const [validationError, setValidationError] = useState<string | null>(null);
  const ownBookId = initialDraft?.addressBookId;
  const addressBooks = useMemo(
    () => allBooks.filter((book) => book.archived !== true || book.id === ownBookId),
    [allBooks, ownBookId],
  );

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

  const identity = (
    <Section title="Identity" first>
      <div className="grid gap-3">
        {addressBooks.length > 0 ? (
          <label className={labelClass}>
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
        <div className="grid gap-3 sm:grid-cols-2">
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
      </div>
    </Section>
  );

  const reach = (
    <>
      <Section
        title="Emails"
        addLabel="Email"
        onAdd={() => patch({ emails: [...draft.emails, emptyChannel("home")] })}
      >
        {draft.emails.length > 0 ? (
          <ChannelList
            channels={draft.emails}
            noun="Email"
            inputType="email"
            onChange={(emails) => patch({ emails })}
          />
        ) : null}
      </Section>

      <Section
        title="Phones"
        addLabel="Phone"
        onAdd={() => patch({ phones: [...draft.phones, emptyChannel("mobile")] })}
      >
        {draft.phones.length > 0 ? (
          <ChannelList
            channels={draft.phones}
            noun="Phone"
            inputType="tel"
            onChange={(phones) => patch({ phones })}
          />
        ) : null}
      </Section>

      <Section
        title="Social Profiles"
        addLabel="Social profile"
        onAdd={() => patch({ socials: [...(draft.socials ?? []), emptySocial()] })}
      >
        {(draft.socials ?? []).length > 0 ? (
          <SocialList socials={draft.socials ?? []} onChange={(socials) => patch({ socials })} />
        ) : null}
      </Section>
    </>
  );

  const details = (first: boolean) => (
    <>
      <Section
        title="Addresses"
        first={first}
        addLabel="Address"
        onAdd={() =>
          patch({
            addresses: [
              ...draft.addresses,
              emptyAddress(draft.addresses.length === 0 ? "home" : "work"),
            ],
          })
        }
      >
        {draft.addresses.some((row) => detailed || isOngoing(row)) ? (
          <AddressList
            addresses={draft.addresses}
            detailed={detailed}
            onChange={(addresses) => patch({ addresses })}
          />
        ) : null}
      </Section>

      <Section
        title="Dates"
        addLabel="Date"
        onAdd={() => patch({ dates: [...(draft.dates ?? []), emptyDate()] })}
      >
        {(draft.dates ?? []).length > 0 ? (
          <DatesList dates={draft.dates ?? []} onChange={(dates) => patch({ dates })} />
        ) : null}
      </Section>

      <Section
        title="Workplace"
        addLabel="Workplace"
        onAdd={() => patch({ work: [...draft.work, emptyWork()] })}
      >
        {draft.work.some((row) => detailed || isOngoing(row)) ? (
          <WorkList work={draft.work} detailed={detailed} onChange={(work) => patch({ work })} />
        ) : null}
      </Section>

      <Section title="Notes">
        <ProseField
          value={draft.notes ?? ""}
          onChange={(notes) => patch({ notes })}
          placeholder="Add notes, context, or meeting reminders…"
          ariaLabel="Notes"
          max={MAX_CONTACT_NOTES_CHARS}
          hint={
            detailed ? undefined : "Keeping history on people? Turn on detailed contacts in Settings."
          }
        />
      </Section>
    </>
  );

  return (
    <form
      id={formId}
      onSubmit={handleSubmit}
      autoComplete="off"
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div className="@container min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
        <div className="mx-auto grid w-full max-w-6xl gap-x-10 @3xl:grid-cols-2">
          <div className="min-w-0">
            {identity}
            {reach}
            {detailed ? details(false) : null}
          </div>
          <div className={secondColumn}>
            {detailed ? (
              <ContactProfileFields
                profile={draft.profile ?? emptyProfile()}
                onChange={patchProfile}
                contacts={contacts}
                currentContactId={currentContactId}
              />
            ) : (
              details(true)
            )}
          </div>
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

      {!hideFooter ? (
        <div className="shrink-0 border-t border-line bg-panel">
          {error ? <ErrorMessage className="mx-5 mt-3">{error}</ErrorMessage> : null}
          <div className="flex items-center justify-end gap-2 px-5 py-3">
            <button
              type="button"
              className={btnSecondary}
              onClick={onCancel}
              disabled={busy}
            >
              Cancel
            </button>
            <button type="submit" disabled={busy} className={btnPrimary}>
              {busy ? "Please wait…" : (submitLabel ?? (initialDraft ? "Save" : "Add"))}
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}

// One column below the container breakpoint, where the second column continues
// the first and so needs the divider a following section would have.
const secondColumn =
  "min-w-0 mt-5 border-t border-line pt-4 @3xl:mt-0 @3xl:border-t-0 @3xl:pt-0";

function rowOps<T extends { id: string }>(rows: T[], onChange: (rows: T[]) => void) {
  return {
    update: (id: string, partial: Partial<T>) =>
      onChange(rows.map((row) => (row.id === id ? { ...row, ...partial } : row))),
    remove: (id: string) => onChange(rows.filter((row) => row.id !== id)),
  };
}

function ChannelList({
  channels,
  noun,
  inputType,
  onChange,
}: {
  channels: ContactChannel[];
  noun: string;
  inputType: "email" | "tel";
  onChange: (channels: ContactChannel[]) => void;
}) {
  const list = rowOps(channels, onChange);
  return (
    <EntryList>
      {channels.map((channel) => (
        <ValueRow
          key={channel.id}
          removeLabel={`Remove ${noun.toLowerCase()}`}
          onRemove={() => list.remove(channel.id)}
          kind={
            <select
              value={channel.kind}
              aria-label="Type"
              onChange={(e) => {
                const kind = e.target.value as ContactChannelKind;
                list.update(channel.id, { kind, label: kind === "custom" ? channel.label : undefined });
              }}
              className={selectField}
            >
              {CHANNEL_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {channelKindLabel(kind)}
                </option>
              ))}
            </select>
          }
        >
          <input
            type={inputType}
            value={channel.value}
            onChange={(e) => list.update(channel.id, { value: e.target.value })}
            placeholder={noun}
            aria-label={noun}
            className={fieldBase}
          />
          {channel.kind === "custom" ? (
            <PillInput
              label="Label"
              value={channel.label ?? ""}
              ariaLabel="Custom label"
              onChange={(label) => list.update(channel.id, { label })}
            />
          ) : null}
        </ValueRow>
      ))}
    </EntryList>
  );
}

function SocialList({
  socials,
  onChange,
}: {
  socials: ContactSocial[];
  onChange: (socials: ContactSocial[]) => void;
}) {
  const list = rowOps(socials, onChange);
  return (
    <EntryList>
      <datalist id="social-platforms">
        {SOCIAL_PLATFORMS.map((platform) => (
          <option key={platform} value={platform} />
        ))}
      </datalist>
      {socials.map((row) => (
        <ValueRow
          key={row.id}
          removeLabel="Remove social profile"
          onRemove={() => list.remove(row.id)}
          kind={
            <input
              value={row.platform}
              onChange={(e) => list.update(row.id, { platform: e.target.value })}
              placeholder="Platform"
              aria-label="Social platform"
              list="social-platforms"
              className={fieldBase}
            />
          }
        >
          <input
            value={row.handle}
            onChange={(e) => list.update(row.id, { handle: e.target.value })}
            placeholder="Username or handle"
            aria-label="Username or handle"
            className={fieldBase}
          />
        </ValueRow>
      ))}
    </EntryList>
  );
}

const SOCIAL_PLATFORMS = [
  "GitHub",
  "Twitter / X",
  "LinkedIn",
  "Instagram",
  "Bluesky",
  "Discord",
  "Telegram",
  "Mastodon",
];

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
  const list = rowOps(dates, onChange);
  return (
    <EntryList>
      {dates.map((row) => (
        <ValueRow
          key={row.id}
          removeLabel="Remove date"
          onRemove={() => list.remove(row.id)}
          kind={
            <select
              value={row.kind}
              aria-label="Date type"
              onChange={(e) => {
                const kind = e.target.value as ContactDateKind;
                list.update(row.id, { kind, label: kind === "custom" ? row.label : undefined });
              }}
              className={selectField}
            >
              {DATE_KINDS.map((opt) => (
                <option key={opt.kind} value={opt.kind}>
                  {opt.label}
                </option>
              ))}
            </select>
          }
        >
          <input
            type="date"
            value={row.date}
            onChange={(e) => list.update(row.id, { date: e.target.value })}
            aria-label="Date"
            className={fieldBase}
          />
          {row.kind === "custom" ? (
            <PillInput
              label="Label"
              value={row.label ?? ""}
              placeholder="e.g. Graduation"
              ariaLabel="Custom date label"
              onChange={(label) => list.update(row.id, { label })}
            />
          ) : null}
        </ValueRow>
      ))}
    </EntryList>
  );
}

/** Like workplaces, a departed address is kept but shows only with detailed contacts. */
function AddressList({
  addresses,
  detailed,
  onChange,
}: {
  addresses: ContactAddress[];
  detailed: boolean;
  onChange: (addresses: ContactAddress[]) => void;
}) {
  const list = rowOps(addresses, onChange);
  return (
    <EntryList>
      {addresses.filter((row) => detailed || isOngoing(row)).map((row) => (
        <EntryCard
          key={row.id}
          label={`${channelKindLabel(row.kind, row.label)} address`}
          removeLabel="Remove address"
          onRemove={() => list.remove(row.id)}
        >
          <div className="grid min-w-0 gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <select
              value={row.kind}
              aria-label="Address type"
              onChange={(e) => {
                const kind = e.target.value as ContactChannelKind;
                list.update(row.id, { kind, label: kind === "custom" ? row.label : undefined });
              }}
              className={selectField}
            >
              {ADDRESS_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {channelKindLabel(kind)}
                </option>
              ))}
            </select>
            {row.kind === "custom" ? (
              <PillInput
                label="Label"
                value={row.label ?? ""}
                ariaLabel="Custom address label"
                onChange={(label) => list.update(row.id, { label })}
              />
            ) : null}
          </div>
          {ADDRESS_FIELDS.map((group, index) => (
            <div key={index} className={group.length > 1 ? "grid min-w-0 gap-2 sm:grid-cols-2" : "grid min-w-0"}>
              {group.map(({ key, pill, label }) => (
                <PillInput
                  key={key}
                  label={pill}
                  ariaLabel={label}
                  value={(row[key] as string | undefined) ?? ""}
                  onChange={(value) => list.update(row.id, { [key]: value })}
                />
              ))}
            </div>
          ))}
          {detailed ? (
            <DateRange
              start={row.start}
              end={row.end}
              current={row.current}
              startLabel="Date moved in"
              endLabel="Date departed"
              currentLabel="Current address"
              onChange={(range) => list.update(row.id, range)}
            />
          ) : null}
        </EntryCard>
      ))}
    </EntryList>
  );
}

const ADDRESS_FIELDS: { key: keyof ContactAddress; pill: string; label: string }[][] = [
  [{ key: "street1", pill: "Street", label: "Street line 1" }],
  [{ key: "street2", pill: "Line 2", label: "Street line 2" }],
  [
    { key: "locality", pill: "City", label: "City / town" },
    { key: "region", pill: "Region", label: "Region / state / province" },
  ],
  [
    { key: "postcode", pill: "Postcode", label: "Postal code" },
    { key: "country", pill: "Country", label: "Country" },
  ],
];

/**
 * Without detailed contacts only the ongoing workplaces show; a finished one
 * is history, which is kept on the draft rather than dropped.
 */
function WorkList({
  work,
  detailed,
  onChange,
}: {
  work: ContactWork[];
  detailed: boolean;
  onChange: (work: ContactWork[]) => void;
}) {
  const list = rowOps(work, onChange);
  return (
    <EntryList>
      {work
        .filter((row) => detailed || isOngoing(row))
        .map((row) => (
          <EntryCard key={row.id} removeLabel="Remove workplace" onRemove={() => list.remove(row.id)}>
            <FieldPair>
              <PillInput
                label="Org"
                value={row.organization}
                ariaLabel="Workplace"
                placeholder="Workplace"
                onChange={(organization) => list.update(row.id, { organization })}
              />
              <PillInput
                label="Role"
                value={row.title ?? ""}
                ariaLabel="Occupation"
                placeholder="Occupation"
                onChange={(title) => list.update(row.id, { title })}
              />
            </FieldPair>
            {detailed ? (
              <>
                <DateRange
                  start={row.start}
                  end={row.end}
                  current={row.current}
                  currentLabel="Current workplace"
                  onChange={(range) => list.update(row.id, range)}
                />
                <PillInput
                  label="Note"
                  value={row.note ?? ""}
                  placeholder="Optional"
                  ariaLabel="Workplace note"
                  onChange={(note) => list.update(row.id, { note })}
                />
              </>
            ) : null}
          </EntryCard>
        ))}
    </EntryList>
  );
}

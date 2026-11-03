import {
  DEFAULT_ADDRESS_BOOK_ID,
  resolveAddressBookId,
} from "./addressBook";
import {
  MAX_PROFILE_ENTRIES,
  MAX_PROFILE_TEXT_CHARS,
  PROFILE_SECTIONS,
  profileFrom,
  profileOf,
  profileTo,
} from "./contactProfile";
import { attachmentFrom, attachmentTo } from "./note";
import type {
  Contact,
  ContactAddress,
  ContactChannel,
  ContactChannelKind,
  ContactDate,
  ContactDateKind,
  ContactDraft,
  ContactSocial,
  ContactWork,
} from "./types";
import { coreContactParse, coreContactWrite } from "./wasm";
import type {
  CoreContact,
  CoreContactAddress,
  CoreContactChannel,
  CoreContactDraft,
} from "./wasm";
import { sortByName } from "./order";

export const CHANNEL_KINDS: ContactChannelKind[] = [
  "work",
  "home",
  "mobile",
  "custom",
];

export const ADDRESS_KINDS: ContactChannelKind[] = ["home", "work", "custom"];

/** Written only when true, so a reader predating it sees the card it expects. */
export const CONTACT_ARCHIVED_PROP = "sealbook:archived";
/** Absent on contacts with no attachments, so old readers ignore it. */
export const CONTACT_ATTACHMENTS_PROP = "sealbook:attachments";

export function channelKindLabel(
  kind: ContactChannelKind,
  label?: string,
): string {
  if (kind === "custom") {
    return label?.trim() || "Custom";
  }
  if (kind === "work") {
    return "Work";
  }
  if (kind === "home") {
    return "Home";
  }
  return "Mobile";
}

export function dateKindLabel(kind: ContactDateKind, label?: string): string {
  if (kind === "custom") {
    return label?.trim() || "Event";
  }
  if (kind === "birthday") {
    return "Birthday";
  }
  return "Anniversary";
}

export function sortContacts<T extends { name: string }>(contacts: T[]): T[] {
  return sortByName(contacts, (contact) => contact.name || "");
}

function newId(): string {
  return crypto.randomUUID();
}

export function emptyChannel(kind: ContactChannelKind): ContactChannel {
  return { id: newId(), kind, value: "" };
}

export function emptyAddress(kind: ContactChannelKind = "home"): ContactAddress {
  return { id: newId(), kind };
}

export function emptyWork(): ContactWork {
  return { id: newId(), organization: "" };
}

/**
 * Not finished: current, or with no finish date. Holds for workplaces and
 * addresses alike, and is what a vCard export lists.
 */
export function isOngoing(row: { current?: boolean; end?: string }): boolean {
  return row.current === true || !row.end;
}

export function emptyDate(kind: ContactDateKind = "birthday"): ContactDate {
  return { id: newId(), kind, date: "" };
}

export function emptySocial(platform = "x"): ContactSocial {
  return { id: newId(), platform, handle: "" };
}

export function emptyDraft(
  addressBookId = DEFAULT_ADDRESS_BOOK_ID,
): ContactDraft {
  return {
    name: "",
    nickname: "",
    pronouns: "",
    emails: [emptyChannel("home")],
    phones: [emptyChannel("mobile")],
    work: [],
    dates: [],
    socials: [],
    notes: "",
    addresses: [],
    addressBookId: resolveAddressBookId(addressBookId),
  };
}

/**
 * Longest the free-text Notes field may be.
 *
 * Not a storage limit: a card is nowhere near the 8 MB object ceiling. It keeps
 * the card inside a padding bucket. `padded_size` is stored and served in the
 * clear and the buckets double (see `BUCKETS` in `sealbook-crypto`), so a card
 * whose text can grow without bound turns every revision into a size delta the
 * server can read. 8 KiB of notes on a full card still lands in the 16 KiB
 * bucket.
 */
export const MAX_CONTACT_NOTES_CHARS = 8192;

/**
 * Mirrors `MAX_PADDED_OBJECT_SIZE` in `sealbook/crates/sealbook-protocol`. The
 * backstop for a card an import or a pasted avatar made oversized; the per-field
 * caps above are what a person actually meets.
 */
const MAX_PADDED_OBJECT_SIZE = 8 * 1024 * 1024;

/** Envelope version, flags and the length-prefixed content type. */
const ENVELOPE_OVERHEAD = 64;

export function contactByteSize(draft: ContactDraft): number {
  return (
    new TextEncoder().encode(serializeCard(draft)).length + ENVELOPE_OVERHEAD
  );
}

export function contactFitsObjectLimit(draft: ContactDraft): boolean {
  return contactByteSize(draft) <= MAX_PADDED_OBJECT_SIZE;
}

/**
 * The first reason this draft cannot be saved, or null.
 *
 * Checked before the write rather than relying on the server's 400, and phrased
 * for the person rather than naming the field.
 */
export function contactValidationError(draft: ContactDraft): string | null {
  const notes = draft.notes ?? "";
  if (notes.length > MAX_CONTACT_NOTES_CHARS) {
    const over = notes.length - MAX_CONTACT_NOTES_CHARS;
    return `Notes hold ${MAX_CONTACT_NOTES_CHARS.toLocaleString()} characters. Shorten by ${over.toLocaleString()}, or move the rest to a note.`;
  }
  if (draft.profile) {
    const profile = profileOf(draft.profile);
    if ((profile.howWeMet ?? "").length > MAX_PROFILE_TEXT_CHARS) {
      return `How We Met holds ${MAX_PROFILE_TEXT_CHARS.toLocaleString()} characters.`;
    }
    for (const section of PROFILE_SECTIONS) {
      if (section === "howWeMet") continue;
      if (profile[section].length > MAX_PROFILE_ENTRIES) {
        return `A section holds ${MAX_PROFILE_ENTRIES} entries.`;
      }
    }
    if (profile.custom.length > MAX_PROFILE_ENTRIES) {
      return `A section holds ${MAX_PROFILE_ENTRIES} entries.`;
    }
    for (const section of profile.custom) {
      if (section.text.length > MAX_PROFILE_TEXT_CHARS) {
        return `A custom section holds ${MAX_PROFILE_TEXT_CHARS.toLocaleString()} characters.`;
      }
    }
  }
  if (!contactFitsObjectLimit(draft)) {
    return "This contact is too large to store. Removing the photo is usually enough.";
  }
  return null;
}

function trim(value?: string): string {
  return value?.trim() ?? "";
}

export function addressLines(address?: Partial<ContactAddress>): string[] {
  if (!address) {
    return [];
  }
  return [
    address.street1,
    address.street2,
    address.locality,
    address.region,
    address.postcode,
    address.country,
  ]
    .map(trim)
    .filter(Boolean);
}

/**
 * The wire form of a card.
 *
 * Both the writer and the reader are core's as of the client unification's
 * phase 8, so the owned key set, the trimming, the kind of an unmarked channel
 * and the omit-rather-than-null rule are one implementation rather than three.
 * What stays here is this client's view model, whose rows carry editor ids that
 * the payload does not.
 */
export function serializeCard(draft: ContactDraft): string {
  return coreContactWrite(coreDraftOf(draft), new Date().toISOString());
}

/** This client's view model as core's draft: the editor ids go, the rest stays. */
export function coreDraftOf(draft: ContactDraft): CoreContactDraft {
  return {
    name:
      draft.derivedName !== undefined && draft.name === draft.derivedName
        ? ""
        : draft.name,
    nickname: draft.nickname,
    pronouns: draft.pronouns,
    emails: draft.emails.map(channelTo),
    phones: draft.phones.map(channelTo),
    addresses: draft.addresses.map(addressTo),
    work: draft.work.map(({ organization, title, start, end, current, note, extra }) => ({
      organization,
      title,
      start,
      end: current ? undefined : end,
      current: current === true,
      note,
      extra,
    })),
    dates: draft.dates.map(({ kind, label, date, extra }) => ({
      kind,
      label,
      date,
      extra,
    })),
    socials: draft.socials.map(({ platform, handle, extra }) => ({
      platform,
      handle,
      extra,
    })),
    notes: draft.notes,
    avatar: draft.avatar,
    profile: draft.profile ? profileTo(draft.profile) : undefined,
    attachments: (draft.attachments ?? []).map(attachmentTo),
    address_book_id: draft.addressBookId,
    archived: draft.archived === true,
    created_at: draft.createdAt,
    raw: draft.raw,
  };
}

/** Core's draft as a view model, with editor ids numbered in order. */
export function draftOfCore(draft: CoreContactDraft): ContactDraft {
  return {
    name: draft.name,
    nickname: draft.nickname,
    pronouns: draft.pronouns,
    emails: draft.emails.map((channel, index) =>
      channelFrom("e", index, channel),
    ),
    phones: draft.phones.map((channel, index) =>
      channelFrom("p", index, channel),
    ),
    addresses: draft.addresses.map(addressFrom),
    work: draft.work.map((row, index) => ({ id: `w${index + 1}`, ...row })),
    dates: draft.dates.map((row, index) => ({ id: `d${index + 1}`, ...row })),
    socials: draft.socials.map((row, index) => ({
      id: `s${index + 1}`,
      ...row,
    })),
    notes: draft.notes,
    avatar: draft.avatar,
    profile: draft.profile ? profileFrom(draft.profile) : undefined,
    addressBookId: draft.address_book_id,
    createdAt: draft.created_at,
  };
}

function channelTo({
  kind,
  label,
  value,
  extra,
}: ContactChannel): CoreContactChannel {
  return { kind, label, value, extra };
}

function addressTo({ id: _id, end, current, ...address }: ContactAddress): CoreContactAddress {
  return { ...address, end: current ? undefined : end, current: current === true };
}

function addressFrom(address: CoreContactAddress, index: number): ContactAddress {
  return { id: `a${index + 1}`, ...address };
}

function channelFrom(
  prefix: string,
  index: number,
  channel: CoreContactChannel,
): ContactChannel {
  return {
    id: `${prefix}${index + 1}`,
    kind: channel.kind,
    label: channel.label,
    value: channel.value,
    extra: channel.extra,
  };
}

function draftFrom(card: CoreContact): ContactDraft {
  return {
    name: card.display_name,
    derivedName: card.name === "" ? card.display_name : undefined,
    nickname: card.nickname,
    pronouns: card.pronouns,
    emails: card.emails.map((channel, index) =>
      channelFrom("e", index, channel),
    ),
    phones: card.phones.map((channel, index) =>
      channelFrom("p", index, channel),
    ),
    addresses: card.addresses.map(addressFrom),
    work: card.work.map((row, index) => ({ id: `w${index + 1}`, ...row })),
    dates: card.dates.map((row, index) => ({ id: `d${index + 1}`, ...row })),
    socials: card.socials.map((row, index) => ({
      id: `s${index + 1}`,
      ...row,
    })),
    notes: card.notes,
    avatar: card.avatar,
    profile: card.profile ? profileFrom(card.profile) : undefined,
    attachments: card.attachments.length
      ? card.attachments.map(attachmentFrom)
      : undefined,
    addressBookId: card.address_book_id,
    archived: card.archived ? true : undefined,
    createdAt: card.created_at,
    updatedAt: card.updated_at,
    readable: card.readable,
  };
}

export function parseDraft(raw: string): ContactDraft {
  return draftFrom(coreContactParse("", raw));
}

export function parseContact(
  id: string,
  raw: string,
  ciphertext: string,
  paddedSize: number,
): Contact {
  const draft = draftFrom(coreContactParse(id, raw));
  return {
    ...draft,
    id,
    email: draft.emails[0]?.value,
    raw,
    ciphertext,
    paddedSize,
  };
}

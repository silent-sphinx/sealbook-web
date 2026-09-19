import {
  ADDRESS_BOOK_ID_PROP,
  DEFAULT_ADDRESS_BOOK_ID,
  resolveAddressBookId,
} from "./addressBook";
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

export const CHANNEL_KINDS: ContactChannelKind[] = ["work", "home", "mobile", "custom"];

export function channelKindLabel(kind: ContactChannelKind, label?: string): string {
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
  return [...contacts].sort((a, b) =>
    (a.name || "").localeCompare(b.name || "", undefined, {
      sensitivity: "base",
      numeric: true,
    }),
  );
}



function newId(): string {
  return crypto.randomUUID();
}

export function emptyChannel(kind: ContactChannelKind): ContactChannel {
  return { id: newId(), kind, value: "" };
}

export function emptyWork(): ContactWork {
  return { id: newId(), organization: "" };
}

export function emptyDate(kind: ContactDateKind = "birthday"): ContactDate {
  return { id: newId(), kind, date: "" };
}

export function emptySocial(platform = "x"): ContactSocial {
  return { id: newId(), platform, handle: "" };
}

export function emptyDraft(addressBookId = DEFAULT_ADDRESS_BOOK_ID): ContactDraft {
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
    address: {},
    addressBookId: resolveAddressBookId(addressBookId),
  };
}

function trim(value?: string): string {
  return value?.trim() ?? "";
}

function isFilled(value?: string): boolean {
  return trim(value).length > 0;
}

export function addressLines(address?: ContactAddress): string[] {
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

function contextsForKind(kind: ContactChannelKind): Record<string, boolean> | undefined {
  if (kind === "work") {
    return { work: true };
  }
  if (kind === "home") {
    return { private: true };
  }
  return undefined;
}

function channelKindFromEntry(
  entry: {
    contexts?: Record<string, boolean>;
    features?: Record<string, boolean>;
    label?: string;
  },
  fallback: ContactChannelKind,
): ContactChannelKind {
  if (entry.features?.mobile) {
    return "mobile";
  }
  const label = trim(entry.label);
  if (label.toLowerCase() === "mobile") {
    return "mobile";
  }
  if (entry.contexts?.work) {
    return "work";
  }
  if (entry.contexts?.private) {
    return "home";
  }
  if (label) {
    return "custom";
  }
  return fallback;
}

function serializeChannels(
  channels: ContactChannel[],
  prefix: string,
  build: (channel: ContactChannel) => Record<string, unknown>,
): Record<string, Record<string, unknown>> | undefined {
  const filled = channels.filter((channel) => isFilled(channel.value));
  if (filled.length === 0) {
    return undefined;
  }
  const out: Record<string, Record<string, unknown>> = {};
  filled.forEach((channel, index) => {
    out[`${prefix}${index + 1}`] = build(channel);
  });
  return out;
}

function emailBody(channel: ContactChannel): Record<string, unknown> {
  const entry: Record<string, unknown> = { address: channel.value.trim() };
  const contexts = contextsForKind(channel.kind);
  if (contexts) {
    entry.contexts = contexts;
  }
  if (channel.kind === "mobile") {
    entry.label = "Mobile";
  } else if (channel.kind === "custom" && isFilled(channel.label)) {
    entry.label = channel.label!.trim();
  }
  return entry;
}

function phoneBody(channel: ContactChannel): Record<string, unknown> {
  const entry: Record<string, unknown> = { number: channel.value.trim() };
  const contexts = contextsForKind(channel.kind);
  if (contexts) {
    entry.contexts = contexts;
  }
  if (channel.kind === "mobile") {
    entry.features = { mobile: true };
  } else if (channel.kind === "custom" && isFilled(channel.label)) {
    entry.label = channel.label!.trim();
  }
  return entry;
}

function serializeAddress(address?: ContactAddress): Record<string, unknown> | undefined {
  if (!address || addressLines(address).length === 0) {
    return undefined;
  }
  const street = [address.street1, address.street2].map(trim).filter(Boolean);
  const body: Record<string, unknown> = {};
  if (street.length > 0) {
    body.street = street;
  }
  if (isFilled(address.locality)) {
    body.locality = address.locality!.trim();
  }
  if (isFilled(address.region)) {
    body.region = address.region!.trim();
  }
  if (isFilled(address.postcode)) {
    body.postCode = address.postcode!.trim();
  }
  if (isFilled(address.country)) {
    body.country = address.country!.trim();
  }
  return { a1: body };
}

export function serializeCard(draft: ContactDraft): string {
  const body: Record<string, unknown> = {
    "@type": "Card",
    version: "1.0",
    name: { full: draft.name.trim() },
    [ADDRESS_BOOK_ID_PROP]: resolveAddressBookId(draft.addressBookId),
  };
  const nickname = trim(draft.nickname);
  if (nickname) {
    body.nickNames = { n1: { name: nickname } };
  }
  const emails = serializeChannels(draft.emails, "e", emailBody);
  if (emails) {
    body.emails = emails;
  }
  const phones = serializeChannels(draft.phones, "p", phoneBody);
  if (phones) {
    body.phones = phones;
  }
  const addresses = serializeAddress(draft.address);
  if (addresses) {
    body.addresses = addresses;
  }

  const organizations: Record<string, { name: string }> = {};
  const titles: Record<string, { name: string; kind: string; organization: string }> = {};
  let orgIndex = 0;
  let titleIndex = 0;
  for (const row of draft.work) {
    const organization = trim(row.organization);
    if (!organization) {
      continue;
    }
    orgIndex += 1;
    const orgId = `o${orgIndex}`;
    organizations[orgId] = { name: organization };
    const title = trim(row.title);
    if (title) {
      titleIndex += 1;
      titles[`t${titleIndex}`] = { name: title, kind: "title", organization: orgId };
    }
  }
  if (orgIndex > 0) {
    body.organizations = organizations;
  }
  if (titleIndex > 0) {
    body.titles = titles;
  }

  const pronouns = trim(draft.pronouns);
  if (pronouns) {
    body.speakToAs = { pronouns };
  }

  if (draft.dates && draft.dates.length > 0) {
    const anniversaries: Record<string, { kind: string; date: string; label?: string }> = {};
    let dIdx = 0;
    for (const d of draft.dates) {
      const dVal = trim(d.date);
      if (!dVal) continue;
      dIdx++;
      anniversaries[`a${dIdx}`] = {
        kind: d.kind === "birthday" ? "birth" : d.kind === "anniversary" ? "wedding" : "other",
        date: dVal,
        label: d.kind === "custom" && d.label?.trim() ? d.label.trim() : undefined,
      };
    }
    if (dIdx > 0) {
      body.anniversaries = anniversaries;
    }
  }

  if (draft.socials && draft.socials.length > 0) {
    const onlineServices: Record<string, { service: string; user: string }> = {};
    let sIdx = 0;
    for (const s of draft.socials) {
      const handle = trim(s.handle);
      if (!handle) continue;
      sIdx++;
      onlineServices[`os${sIdx}`] = {
        service: trim(s.platform) || "custom",
        user: handle,
      };
    }
    if (sIdx > 0) {
      body.onlineServices = onlineServices;
    }
  }

  const notes = trim(draft.notes);
  if (notes) {
    body.notes = { n1: { note: notes } };
  }

  const nowIso = new Date().toISOString();
  body.created = draft.createdAt || nowIso;
  body.updated = nowIso;

  return JSON.stringify(body);
}

type RawCard = {
  name?: { full?: string };
  nickNames?: Record<string, { name?: string }>;
  nicknames?: Record<string, { name?: string }>;
  speakToAs?: { pronouns?: string };
  pronouns?: string;
  emails?: Record<string, { address?: string; contexts?: Record<string, boolean>; label?: string }>;
  phones?: Record<
    string,
    {
      number?: string;
      phoneNumber?: string;
      contexts?: Record<string, boolean>;
      features?: Record<string, boolean>;
      label?: string;
    }
  >;
  addresses?: Record<
    string,
    {
      street?: string | string[];
      locality?: string;
      region?: string;
      postCode?: string;
      postcode?: string;
      country?: string;
    }
  >;
  organizations?: Record<string, { name?: string }>;
  titles?: Record<string, { name?: string; organization?: string }>;
  anniversaries?: Record<
    string,
    {
      kind?: string;
      date?: string;
      label?: string;
    }
  >;
  onlineServices?: Record<
    string,
    {
      service?: string;
      user?: string;
      uri?: string;
      label?: string;
    }
  >;
  notes?: Record<string, { note?: string }> | string;
  created?: string;
  createdAt?: string;
  updated?: string;
  updatedAt?: string;
  [ADDRESS_BOOK_ID_PROP]?: string;
};

function parseChannels<T extends { label?: string; contexts?: Record<string, boolean> }>(
  map: Record<string, T> | undefined,
  valueOf: (entry: T) => string | undefined,
  fallback: ContactChannelKind,
  extraKind?: (entry: T) => ContactChannelKind | undefined,
): ContactChannel[] {
  if (!map) {
    return [];
  }
  const channels: ContactChannel[] = [];
  for (const [id, entry] of Object.entries(map)) {
    const value = trim(valueOf(entry));
    if (!value) {
      continue;
    }
    const kind = extraKind?.(entry) ?? channelKindFromEntry(entry, fallback);
    channels.push({
      id,
      kind,
      value,
      label: kind === "custom" ? trim(entry.label) || undefined : undefined,
    });
  }
  return channels;
}

function parseAddress(
  addresses?: RawCard["addresses"],
): ContactAddress | undefined {
  if (!addresses) {
    return undefined;
  }
  const first = Object.values(addresses)[0];
  if (!first) {
    return undefined;
  }
  const street = Array.isArray(first.street)
    ? first.street
    : first.street
      ? [first.street]
      : [];
  const address: ContactAddress = {
    street1: trim(street[0]) || undefined,
    street2: trim(street[1]) || undefined,
    locality: trim(first.locality) || undefined,
    region: trim(first.region) || undefined,
    postcode: trim(first.postCode ?? first.postcode) || undefined,
    country: trim(first.country) || undefined,
  };
  return addressLines(address).length > 0 ? address : undefined;
}

function parseWork(card: RawCard): ContactWork[] {
  const organizations = card.organizations ?? {};
  const titles = card.titles ?? {};
  const usedTitles = new Set<string>();
  const work: ContactWork[] = [];

  for (const [orgId, org] of Object.entries(organizations)) {
    const organization = trim(org.name);
    if (!organization) {
      continue;
    }
    const linked = Object.entries(titles).filter(
      ([, title]) => title.organization === orgId && isFilled(title.name),
    );
    if (linked.length === 0) {
      work.push({ id: orgId, organization });
      continue;
    }
    for (const [titleId, title] of linked) {
      usedTitles.add(titleId);
      work.push({ id: `${orgId}:${titleId}`, organization, title: title.name!.trim() });
    }
  }
  return work;
}

function parseNickname(card: RawCard): string | undefined {
  const nickMap = card.nickNames ?? card.nicknames;
  if (!nickMap) {
    return undefined;
  }
  for (const entry of Object.values(nickMap)) {
    const name = trim(entry.name);
    if (name) {
      return name;
    }
  }
  return undefined;
}

function parsePronouns(card: RawCard): string | undefined {
  const p = card.speakToAs?.pronouns ?? card.pronouns;
  return trim(p) || undefined;
}

function parseDates(card: RawCard): ContactDate[] {
  if (!card.anniversaries) return [];
  const dates: ContactDate[] = [];
  for (const [id, entry] of Object.entries(card.anniversaries)) {
    const dateVal = trim(entry.date);
    if (!dateVal) continue;
    const kind: ContactDateKind =
      entry.kind === "birth" ? "birthday" : entry.kind === "wedding" ? "anniversary" : "custom";
    dates.push({
      id,
      kind,
      label: trim(entry.label) || undefined,
      date: dateVal,
    });
  }
  return dates;
}

function parseSocials(card: RawCard): ContactSocial[] {
  if (!card.onlineServices) return [];
  const socials: ContactSocial[] = [];
  for (const [id, entry] of Object.entries(card.onlineServices)) {
    const handle = trim(entry.user ?? entry.uri);
    if (!handle) continue;
    socials.push({
      id,
      platform: trim(entry.service) || "custom",
      handle,
    });
  }
  return socials;
}

function parseNotes(card: RawCard): string | undefined {
  if (typeof card.notes === "string") {
    return card.notes.trim() || undefined;
  }
  if (card.notes && typeof card.notes === "object") {
    const first = Object.values(card.notes)[0]?.note;
    return trim(first) || undefined;
  }
  return undefined;
}

export function parseDraft(raw: string): ContactDraft {
  const card = JSON.parse(raw) as RawCard;
  const emails = parseChannels(card.emails, (entry) => entry.address, "home");
  const phones = parseChannels(
    card.phones,
    (entry) => entry.number ?? entry.phoneNumber,
    "home",
    (entry) => (entry.features?.mobile ? "mobile" : undefined),
  );
  return {
    name: trim(card.name?.full) || "Untitled",
    nickname: parseNickname(card),
    pronouns: parsePronouns(card),
    emails,
    phones,
    address: parseAddress(card.addresses),
    work: parseWork(card),
    dates: parseDates(card),
    socials: parseSocials(card),
    notes: parseNotes(card),
    addressBookId: resolveAddressBookId(card[ADDRESS_BOOK_ID_PROP]),
    createdAt: card.created ?? card.createdAt,
    updatedAt: card.updated ?? card.updatedAt,
  };
}

export function parseContact(
  id: string,
  raw: string,
  ciphertext: string,
  paddedSize: number,
): Contact {
  try {
    const draft = parseDraft(raw);
    return {
      ...draft,
      id,
      email: draft.emails[0]?.value,
      raw,
      ciphertext,
      paddedSize,
    };
  } catch {
    return {
      id,
      name: raw,
      emails: [],
      phones: [],
      work: [],
      dates: [],
      socials: [],
      addressBookId: DEFAULT_ADDRESS_BOOK_ID,
      raw,
      ciphertext,
      paddedSize,
    };
  }
}

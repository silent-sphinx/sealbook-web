import { coreContactProfileParse, coreContactProfileWrite } from "./wasm";
import type { CoreContactProfile } from "./wasm";
import type {
  ContactCareer,
  ContactCustomSection,
  ContactLifeEvent,
  ContactPerson,
  ContactPet,
  ContactProfile,
  ContactRelationship,
  ContactTag,
} from "./types";

/**
 * The relationship sections ride in the card under one vendor property, next to
 * `sealbook:addressBookId`.
 *
 * One property rather than a mapping onto JSContact's own objects: every section
 * here needs a field the standard shape lacks (a per-entry note, a date range, a
 * like/dislike polarity), so a half-mapping would split each section between a
 * standard object and a sidecar keyed by a join id.
 */
export const CONTACT_PROFILE_PROP = "sealbook:profile";

/** Longest free-text entry. The whole-card ceiling is in `lib/contact`. */
export const MAX_PROFILE_TEXT_CHARS = 1024;

/** Entries per section. Guards the card's padded size, not correctness. */
export const MAX_PROFILE_ENTRIES = 64;

export const PROFILE_SECTIONS = [
  "howWeMet",
  "interests",
  "food",
  "music",
  "pets",
  "career",
  "relationships",
  "timeline",
  "family",
  "friends",
  "colleagues",
] as const;

export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

/** The sections whose entries can link to another contact in the vault. */
export type LinkableSection = "family" | "friends" | "colleagues";

export const PROFILE_SECTION_LABELS: Record<ProfileSection, string> = {
  howWeMet: "How We Met",
  interests: "Interests",
  food: "Food Likes & Dislikes",
  music: "Music Tastes",
  pets: "Pets",
  career: "Career History",
  relationships: "Relationship History",
  timeline: "Life Events",
  family: "Family",
  friends: "Friends",
  colleagues: "Colleagues",
};

export const LINKABLE_SECTIONS: LinkableSection[] = ["family", "friends", "colleagues"];

export const RELATIONSHIP_KINDS = [
  "Partner",
  "Spouse",
  "Ex-partner",
  "Ex-spouse",
  "Engaged",
  "Dating",
];

function newId(): string {
  return crypto.randomUUID();
}

export function emptyProfile(): ContactProfile {
  return {
    interests: [],
    music: [],
    food: [],
    pets: [],
    career: [],
    relationships: [],
    timeline: [],
    family: [],
    friends: [],
    colleagues: [],
    custom: [],
  };
}

/** A profile for a draft that may predate the field, so callers can skip `??`. */
export function profileOf(profile?: ContactProfile): ContactProfile {
  return profile ? { ...emptyProfile(), ...profile } : emptyProfile();
}

export function emptyTag(): ContactTag {
  return { id: newId(), value: "" };
}

export function emptyPet(): ContactPet {
  return { id: newId(), name: "" };
}

export function emptyCareer(): ContactCareer {
  return { id: newId(), organization: "" };
}

export function emptyRelationship(): ContactRelationship {
  return { id: newId(), name: "", kind: RELATIONSHIP_KINDS[0] };
}

export function emptyLifeEvent(): ContactLifeEvent {
  return { id: newId(), title: "" };
}

export function emptyPerson(): ContactPerson {
  return { id: newId(), name: "" };
}

export function emptyCustomSection(): ContactCustomSection {
  return { id: newId(), title: "", text: "" };
}

function trim(value?: string): string {
  return value?.trim() ?? "";
}

/** True when nothing in the section would survive serialization. */
export function sectionIsEmpty(profile: ContactProfile, section: ProfileSection): boolean {
  switch (section) {
    case "howWeMet":
      return !trim(profile.howWeMet);
    case "interests":
      return profile.interests.every((row) => !trim(row.value));
    case "music":
      return profile.music.every((row) => !trim(row.value));
    case "food":
      return profile.food.every((row) => !trim(row.value));
    case "timeline":
      return profile.timeline.every((row) => !trim(row.title));
    case "career":
      return profile.career.every((row) => !trim(row.organization) && !trim(row.title));
    case "pets":
      return profile.pets.every((row) => !trim(row.name));
    case "relationships":
      return profile.relationships.every((row) => !trim(row.name));
    case "family":
      return profile.family.every((row) => !trim(row.name));
    case "friends":
      return profile.friends.every((row) => !trim(row.name));
    case "colleagues":
      return profile.colleagues.every((row) => !trim(row.name));
  }
}

/** A custom section with neither a title nor body survives no serialization. */
export function customSectionIsEmpty(section: ContactCustomSection): boolean {
  return !trim(section.title) && !trim(section.text);
}

export function profileIsEmpty(profile?: ContactProfile): boolean {
  if (!profile) return true;
  const full = profileOf(profile);
  return (
    PROFILE_SECTIONS.every((section) => sectionIsEmpty(full, section)) &&
    full.custom.every(customSectionIsEmpty)
  );
}

/** The sections with something in them, in display order. */
export function filledSections(profile: ContactProfile): ProfileSection[] {
  return PROFILE_SECTIONS.filter((section) => !sectionIsEmpty(profile, section));
}

/**
 * The profile as core holds it. Rows lose the editor ids this client gives them,
 * and the sections nothing here shows ride in `extra`.
 */
export function profileTo(profile: ContactProfile): CoreContactProfile {
  const full = profileOf(profile);
  return {
    how_we_met: full.howWeMet,
    interests: full.interests.map((row) => row.value),
    music: full.music.map((row) => row.value),
    food: full.food.map(({ polarity, value, note }) => ({ polarity, value, note })),
    pets: full.pets.map(({ name, species, note }) => ({ name, species, note })),
    career: full.career.map(({ organization, title, start, end, note }) => ({
      organization,
      title,
      start,
      end,
      note,
    })),
    relationships: full.relationships.map(({ name, kind, start, end, current, note }) => ({
      name,
      kind,
      start,
      end,
      current: current === true,
      note,
    })),
    timeline: full.timeline.map(({ title, date, description }) => ({ title, date, description })),
    family: full.family.map(personTo),
    friends: full.friends.map(personTo),
    colleagues: full.colleagues.map(personTo),
    custom: full.custom.map(({ title, text }) => ({ title, text })),
    extra: full.extra ?? "{}",
  };
}

function personTo({ name, relation, note, contactId }: ContactPerson) {
  return { name, relation, note, contact_id: contactId };
}

function personFrom(row: CoreContactProfile["family"][number]): ContactPerson {
  return {
    id: newId(),
    name: row.name,
    relation: row.relation,
    note: row.note,
    ...(row.contact_id ? { contactId: row.contact_id } : {}),
  };
}

export function profileFrom(profile: CoreContactProfile): ContactProfile {
  return {
    howWeMet: profile.how_we_met,
    interests: profile.interests.map((value) => ({ id: newId(), value })),
    music: profile.music.map((value) => ({ id: newId(), value })),
    food: profile.food.map((row) => ({ id: newId(), ...row })),
    pets: profile.pets.map((row) => ({ id: newId(), ...row })),
    career: profile.career.map((row) => ({ id: newId(), ...row })),
    relationships: profile.relationships.map((row) => ({
      id: newId(),
      ...row,
      current: row.current ? true : undefined,
    })),
    timeline: profile.timeline.map((row) => ({ id: newId(), ...row })),
    family: profile.family.map(personFrom),
    friends: profile.friends.map(personFrom),
    colleagues: profile.colleagues.map(personFrom),
    custom: profile.custom.map((row) => ({ id: newId(), ...row })),
    extra: profile.extra === "{}" ? undefined : profile.extra,
  };
}

/**
 * The profile as it sits in the card, or undefined when nothing is filled in so
 * an empty profile adds no bytes and no key. Core writes it; this is for the
 * importers and exporters that carry a profile outside a card.
 */
export function serializeProfile(profile?: ContactProfile): Record<string, unknown> | undefined {
  if (!profile) {
    return undefined;
  }
  const text = coreContactProfileWrite(profileTo(profile));
  return text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
}

/**
 * A profile off a raw card. Entries that cannot be read are dropped rather than
 * failing the card, the same rule the note table sidecar follows.
 */
export function parseProfile(value: unknown): ContactProfile | undefined {
  if (value === undefined) {
    return undefined;
  }
  const profile = coreContactProfileParse(JSON.stringify(value));
  return profile ? profileFrom(profile) : undefined;
}

/** How much of a date a value states. Each precision has its own native picker. */
export type DatePrecision = "year" | "month" | "day";

/** The precision a stored value is written at, or null if it is not an ISO date. */
export function precisionOf(value: string): DatePrecision | null {
  if (/^\d{4}$/.test(value)) return "year";
  if (/^\d{4}-\d{2}$/.test(value)) return "month";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "day";
  return null;
}

/**
 * Re-cuts a value to a new precision, keeping what the old one already said.
 *
 * Widening invents the first month or day rather than clearing the field: the
 * user asked for the finer precision and is about to set it in the picker, and
 * dropping the year they had typed would be the worse answer.
 */
export function atPrecision(value: string, precision: DatePrecision): string {
  const year = /^(\d{4})/.exec(value)?.[1];
  if (!year) return "";
  if (precision === "year") return year;
  const month = /^\d{4}-(\d{2})/.exec(value)?.[1] ?? "01";
  if (precision === "month") return `${year}-${month}`;
  const day = /^\d{4}-\d{2}-(\d{2})/.exec(value)?.[1] ?? "01";
  return `${year}-${month}-${day}`;
}

/**
 * Accepts `YYYY`, `YYYY-MM` and `YYYY-MM-DD`. Anything else is a string the user
 * typed and is shown back verbatim rather than rejected.
 */
export function formatPartialDate(value?: string): string {
  const text = trim(value);
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(text);
  if (!match) return text;
  const [, year, month, day] = match;
  if (!month) return year;
  const date = new Date(Number(year), Number(month) - 1, day ? Number(day) : 1);
  if (isNaN(date.getTime())) return text;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    ...(day ? { day: "numeric" } : {}),
  });
}

/**
 * A chronological key for ordering a life event, tolerant of every form the
 * date field can leave behind: ISO at any precision, a month or day missing its
 * leading zero, and a month/year typed as words where a browser renders the
 * month picker as a plain text box. A month- or year-only value sorts at the
 * start of its period rather than below every full date, which is the bug a
 * plain string compare produces (letters and unpadded digits outrank `0`).
 *
 * Null when nothing datelike can be read, which keeps a free-text entry at the
 * end of the column rather than wherever its first character would land.
 */
export function lifeEventOrder(value?: string): number | null {
  const text = trim(value);
  if (!text) return null;
  const iso = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(text);
  if (iso) {
    const [, year, month, day] = iso;
    return Number(year) * 1e4 + Number(month ?? 0) * 100 + Number(day ?? 0);
  }
  const parsed = Date.parse(text);
  if (!isNaN(parsed)) {
    const date = new Date(parsed);
    return date.getFullYear() * 1e4 + (date.getMonth() + 1) * 100 + date.getDate();
  }
  return null;
}

/** `start` to `end` as one label, with an open end reading as "Present". */
export function formatDateRange(start?: string, end?: string): string {
  const from = formatPartialDate(start);
  const to = formatPartialDate(end);
  if (from && to) return `${from} - ${to}`;
  if (from) return `${from} - Present`;
  return to;
}

/** Profile text folded into the contact search haystack. */
export function profileSearchText(profile?: ContactProfile): string {
  if (!profile) return "";
  const full = profileOf(profile);
  const parts: string[] = [];
  if (full.howWeMet) parts.push(full.howWeMet);
  for (const row of [...full.interests, ...full.music]) parts.push(row.value);
  for (const row of full.food) parts.push(row.value, row.note ?? "");
  for (const row of full.pets) parts.push(row.name, row.species ?? "", row.note ?? "");
  for (const row of full.career) {
    parts.push(row.organization, row.title ?? "", row.note ?? "");
  }
  for (const row of full.relationships) parts.push(row.name, row.kind, row.note ?? "");
  for (const row of full.timeline) parts.push(row.title, row.description ?? "");
  for (const row of [...full.family, ...full.friends, ...full.colleagues]) {
    parts.push(row.name, row.relation ?? "", row.note ?? "");
  }
  for (const row of full.custom) parts.push(row.title, row.text);
  return parts.filter(Boolean).join(" ");
}

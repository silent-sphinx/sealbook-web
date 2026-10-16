import type {
  ContactCareer,
  ContactCustomSection,
  ContactFood,
  ContactFoodPolarity,
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
] as const;

export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

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
};

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

export function emptyFood(polarity: ContactFoodPolarity = "like"): ContactFood {
  return { id: newId(), polarity, value: "" };
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

function optional(value?: string): string | undefined {
  return trim(value) || undefined;
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

function tagList(rows: ContactTag[]): string[] | undefined {
  const values = rows.map((row) => trim(row.value)).filter(Boolean);
  return values.length > 0 ? values.slice(0, MAX_PROFILE_ENTRIES) : undefined;
}

function list<T>(rows: T[], build: (row: T) => Record<string, unknown> | null) {
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    const body = build(row);
    if (body) out.push(body);
    if (out.length >= MAX_PROFILE_ENTRIES) break;
  }
  return out.length > 0 ? out : undefined;
}

/**
 * The profile as it sits in the card, or undefined when nothing is filled in so
 * an empty profile adds no bytes and no key.
 *
 * Every optional field is omitted rather than written null, so a reader that
 * predates it sees the shape it expects.
 */
export function serializeProfile(profile?: ContactProfile): Record<string, unknown> | undefined {
  if (!profile || profileIsEmpty(profile)) {
    return undefined;
  }
  const full = profileOf(profile);
  const body: Record<string, unknown> = { "@type": "SealbookProfile", version: "1.0" };

  const howWeMet = trim(full.howWeMet).slice(0, MAX_PROFILE_TEXT_CHARS);
  if (howWeMet) body.howWeMet = howWeMet;

  const interests = tagList(full.interests);
  if (interests) body.interests = interests;
  const music = tagList(full.music);
  if (music) body.music = music;

  const food = list(full.food, (row) => {
    const value = trim(row.value);
    if (!value) return null;
    const entry: Record<string, unknown> = {
      polarity: row.polarity === "dislike" ? "dislike" : "like",
      value,
    };
    const note = optional(row.note);
    if (note) entry.note = note;
    return entry;
  });
  if (food) body.food = food;

  const pets = list(full.pets, (row) => {
    const name = trim(row.name);
    if (!name) return null;
    const entry: Record<string, unknown> = { name };
    const species = optional(row.species);
    if (species) entry.species = species;
    const note = optional(row.note);
    if (note) entry.note = note;
    return entry;
  });
  if (pets) body.pets = pets;

  const career = list(full.career, (row) => {
    const organization = trim(row.organization);
    const title = optional(row.title);
    if (!organization && !title) return null;
    const entry: Record<string, unknown> = {};
    if (organization) entry.organization = organization;
    if (title) entry.title = title;
    const start = optional(row.start);
    if (start) entry.start = start;
    const end = optional(row.end);
    if (end) entry.end = end;
    const note = optional(row.note);
    if (note) entry.note = note;
    return entry;
  });
  if (career) body.career = career;

  const relationships = list(full.relationships, (row) => {
    const name = trim(row.name);
    if (!name) return null;
    const entry: Record<string, unknown> = { name };
    const kind = optional(row.kind);
    if (kind) entry.kind = kind;
    const start = optional(row.start);
    if (start) entry.start = start;
    // A current relationship is ongoing by definition, so its end is never
    // written even if one lingers in the draft from before the flag was set.
    if (row.current) {
      entry.current = true;
    } else {
      const end = optional(row.end);
      if (end) entry.end = end;
    }
    const note = optional(row.note);
    if (note) entry.note = note;
    return entry;
  });
  if (relationships) body.relationships = relationships;

  const timeline = list(full.timeline, (row) => {
    const title = trim(row.title);
    if (!title) return null;
    const entry: Record<string, unknown> = { title };
    const date = optional(row.date);
    if (date) entry.date = date;
    const description = optional(row.description);
    if (description) entry.description = description;
    return entry;
  });
  if (timeline) body.timeline = timeline;

  for (const section of ["family", "friends"] as const) {
    const people = list(full[section], (row) => {
      const name = trim(row.name);
      if (!name) return null;
      const entry: Record<string, unknown> = { name };
      const relation = optional(row.relation);
      if (relation) entry.relation = relation;
      const note = optional(row.note);
      if (note) entry.note = note;
      return entry;
    });
    if (people) body[section] = people;
  }

  const custom = list(full.custom, (row) => {
    const title = trim(row.title).slice(0, MAX_PROFILE_TEXT_CHARS);
    const text = trim(row.text).slice(0, MAX_PROFILE_TEXT_CHARS);
    if (!title && !text) return null;
    const entry: Record<string, unknown> = {};
    if (title) entry.title = title;
    if (text) entry.text = text;
    return entry;
  });
  if (custom) body.custom = custom;

  return body;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value.slice(0, MAX_PROFILE_ENTRIES) : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_PROFILE_TEXT_CHARS) : "";
}

function optionalStr(value: unknown): string | undefined {
  return str(value) || undefined;
}

function parseTags(value: unknown): ContactTag[] {
  return asArray(value)
    .map((entry) => str(entry))
    .filter(Boolean)
    .map((text) => ({ id: newId(), value: text }));
}

/**
 * A profile off a raw card. Entries that cannot be read are dropped rather than
 * failing the card, the same rule the note table sidecar follows.
 */
export function parseProfile(value: unknown): ContactProfile | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const profile = emptyProfile();

  profile.howWeMet = optionalStr(raw.howWeMet);
  profile.interests = parseTags(raw.interests);
  profile.music = parseTags(raw.music);

  for (const entry of asArray(raw.food)) {
    const row = (entry ?? {}) as Record<string, unknown>;
    const text = str(row.value);
    if (!text) continue;
    profile.food.push({
      id: newId(),
      polarity: row.polarity === "dislike" ? "dislike" : "like",
      value: text,
      note: optionalStr(row.note),
    });
  }

  for (const entry of asArray(raw.pets)) {
    const row = (entry ?? {}) as Record<string, unknown>;
    const name = str(row.name);
    if (!name) continue;
    profile.pets.push({
      id: newId(),
      name,
      species: optionalStr(row.species),
      note: optionalStr(row.note),
    });
  }

  for (const entry of asArray(raw.career)) {
    const row = (entry ?? {}) as Record<string, unknown>;
    const organization = str(row.organization);
    const title = optionalStr(row.title);
    if (!organization && !title) continue;
    profile.career.push({
      id: newId(),
      organization,
      title,
      start: optionalStr(row.start),
      end: optionalStr(row.end),
      note: optionalStr(row.note),
    });
  }

  for (const entry of asArray(raw.relationships)) {
    const row = (entry ?? {}) as Record<string, unknown>;
    const name = str(row.name);
    if (!name) continue;
    const current = row.current === true ? true : undefined;
    profile.relationships.push({
      id: newId(),
      name,
      kind: str(row.kind) || RELATIONSHIP_KINDS[0],
      start: optionalStr(row.start),
      end: current ? undefined : optionalStr(row.end),
      current,
      note: optionalStr(row.note),
    });
  }

  for (const entry of asArray(raw.timeline)) {
    const row = (entry ?? {}) as Record<string, unknown>;
    const title = str(row.title);
    if (!title) continue;
    profile.timeline.push({
      id: newId(),
      title,
      date: optionalStr(row.date),
      description: optionalStr(row.description),
    });
  }

  for (const section of ["family", "friends"] as const) {
    for (const entry of asArray(raw[section])) {
      const row = (entry ?? {}) as Record<string, unknown>;
      const name = str(row.name);
      if (!name) continue;
      profile[section].push({
        id: newId(),
        name,
        relation: optionalStr(row.relation),
        note: optionalStr(row.note),
      });
    }
  }

  for (const entry of asArray(raw.custom)) {
    const row = (entry ?? {}) as Record<string, unknown>;
    const title = str(row.title);
    const text = str(row.text);
    if (!title && !text) continue;
    profile.custom.push({ id: newId(), title, text });
  }

  return profileIsEmpty(profile) ? undefined : profile;
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
  for (const row of [...full.family, ...full.friends]) {
    parts.push(row.name, row.relation ?? "", row.note ?? "");
  }
  for (const row of full.custom) parts.push(row.title, row.text);
  return parts.filter(Boolean).join(" ");
}

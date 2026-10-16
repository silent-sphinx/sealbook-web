export type DeviceState = {
  server: string;
  username: string;
  account_id: string;
  collection_id: string;
  device_id: string;
  session_token?: string | null;
  kdf_salt: number[] | string;
  hpke_sk: number[] | string;
  mldsa_seed: number[] | string;
  ed25519_sk: number[] | string;
  /** Highest manifest sequence this device has seen; a lower one means rollback. */
  manifest_seq?: number;
  /**
   * The last device roster this device accepted, by sequence and transcript.
   *
   * Every later roster has to be reachable from this one along device-signed
   * steps, which is what stops the server inserting a device of its own: a
   * device on the list would be handed the collection key at the next rotation.
   * A joining device gets its first pin from the pairing anchor, which the user
   * vouched for by comparing the confirmation code.
   */
  roster_seq?: number;
  /** Base64. Empty until a roster has been pinned. */
  roster_transcript?: string;
};

/** One roster in the signed device history. */
export type Roster = {
  roster_seq: number;
  key_epoch: number;
  devices: DevicePublic[];
  phrase_mldsa_pk: string;
  phrase_ed25519_pk: string;
  signer: { kind: "device"; device_id: string } | { kind: "phrase" };
  signature: DualSignature;
  mac: string;
};

/** A verified roster and the pin to keep in place of the old one. */
export type RosterVerified = {
  roster: Roster;
  pin_seq: number;
  pin_transcript: string;
};

export type KeyWrap = {
  recipient_kind: string;
  recipient_id: string;
  hpke_enc: string;
  wrapped_ck: string;
  ciphersuite: string;
};

export type SealedObject = {
  id: string;
  revision: number;
  tombstone: boolean;
  nonce: string;
  ciphertext: string;
  padded_size: number;
  content_type: string;
};

/** The vault features an account can turn off; settings is always on. */
export type FeatureKey = "contacts" | "calendar" | "notes" | "bookmarks";

/**
 * How much of a contact the UI offers. `detailed` adds the relationship
 * sections in `lib/contactProfile`; `basic` hides them without deleting
 * anything already stored.
 */
export type ContactMode = "basic" | "detailed";

/**
 * Which accent the shell is tinted with. One of a fixed set rather than a free
 * colour: the palette in `lib/accountSettings` is tuned against the dark
 * surfaces, and an arbitrary stored hex could be unreadable on them.
 */
export type AccentKey = "blue" | "cyan" | "green" | "amber" | "rose" | "purple";

/**
 * Account-wide preferences, stored in the vault so they follow the account to
 * every client rather than living in one browser. See `lib/accountSettings`.
 */
export type AccountSettings = {
  features: Record<FeatureKey, boolean>;
  /**
   * Flags for features this build has never heard of, carried through a save
   * unread. `features` is one key, so `mergePayload` cannot protect what is
   * inside it: without this, a client that predates a feature would drop its
   * flag the next time it wrote settings, and the user's choice would silently
   * read back as enabled. See `normalizeFeatures`.
   */
  unknownFeatures?: Record<string, boolean>;
  contactMode: ContactMode;
  accent: AccentKey;
};

export type ContactChannelKind = "work" | "home" | "mobile" | "custom";

export type ContactChannel = {
  id: string;
  kind: ContactChannelKind;
  label?: string;
  value: string;
};

export type ContactAddress = {
  street1?: string;
  street2?: string;
  locality?: string;
  region?: string;
  postcode?: string;
  country?: string;
};

export type ContactWork = {
  id: string;
  organization: string;
  title?: string;
};

export type ContactDateKind = "birthday" | "anniversary" | "custom";

export type ContactDate = {
  id: string;
  kind: ContactDateKind;
  label?: string;
  date: string;
};

export type ContactSocial = {
  id: string;
  platform: string;
  handle: string;
};

/**
 * A free-text row that is only a string on the wire. The id exists so the editor
 * has a stable React key across a delete; it is generated on parse rather than
 * stored.
 */
export type ContactTag = {
  id: string;
  value: string;
};

export type ContactFoodPolarity = "like" | "dislike";

export type ContactFood = {
  id: string;
  polarity: ContactFoodPolarity;
  value: string;
  note?: string;
};

export type ContactPet = {
  id: string;
  name: string;
  species?: string;
  note?: string;
};

/**
 * Dates on the relationship sections are partial ISO strings (`YYYY`,
 * `YYYY-MM`, `YYYY-MM-DD`): a job or a life event often has only a year, which
 * `<input type="date">` cannot express.
 */
export type ContactCareer = {
  id: string;
  organization: string;
  title?: string;
  start?: string;
  end?: string;
  note?: string;
};

export type ContactRelationship = {
  id: string;
  name: string;
  kind: string;
  start?: string;
  end?: string;
  /** Marks an ongoing relationship. Shown as a badge, independent of an open end. */
  current?: boolean;
  note?: string;
};

export type ContactLifeEvent = {
  id: string;
  title: string;
  date?: string;
  description?: string;
};

/** Family and friends share a shape; only family shows the relation field. */
export type ContactPerson = {
  id: string;
  name: string;
  relation?: string;
  note?: string;
};

/**
 * A user-titled free-text section. Several may exist, so these live in a list
 * of their own rather than in `PROFILE_SECTIONS`, which is a fixed set.
 */
export type ContactCustomSection = {
  id: string;
  title: string;
  text: string;
};

/**
 * The relationship-manager half of a contact, carried in the card under
 * `sealbook:profile`. Stored whatever the account's contact mode is, so turning
 * `basic` back on hides it rather than dropping it. See `lib/contactProfile`.
 */
export type ContactProfile = {
  howWeMet?: string;
  interests: ContactTag[];
  music: ContactTag[];
  food: ContactFood[];
  pets: ContactPet[];
  career: ContactCareer[];
  relationships: ContactRelationship[];
  timeline: ContactLifeEvent[];
  family: ContactPerson[];
  friends: ContactPerson[];
  custom: ContactCustomSection[];
};

export type ContactDraft = {
  name: string;
  nickname?: string;
  pronouns?: string;
  emails: ContactChannel[];
  phones: ContactChannel[];
  address?: ContactAddress;
  work: ContactWork[];
  dates: ContactDate[];
  socials: ContactSocial[];
  notes?: string;
  avatar?: string;
  profile?: ContactProfile;
  addressBookId: string;
  /**
   * Out of its address book and the contact list, into the archive the
   * sidebar shows on its own, with the card left in the vault untouched.
   * `addressBookId` is kept rather than cleared, so restoring puts the contact
   * back where it was. Absent rather than `false` on a contact that has never
   * been archived.
   */
  archived?: boolean;
  createdAt?: string;
  updatedAt?: string;
  /** As `NoteDraft.raw`: what a save merges onto, so unknown fields survive. */
  raw?: string;
};

export type Contact = ContactDraft & {
  id: string;
  email?: string;
  raw: string;
  ciphertext: string;
  paddedSize: number;
};

export type AddressBook = {
  id: string;
  name: string;
  raw: string;
};

export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end?: string;
  notes?: string;
  location?: string;
  participants?: string[];
  timezone?: string;
  calendarId?: string;
  recurrence?: RecurrenceRule;
  /** As `NoteDraft.raw`: what a save merges onto, so unknown fields survive. */
  raw?: string;
};

export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";

export type RecurrenceRule = {
  frequency: RecurrenceFrequency;
  interval?: number;
  until?: string;
  count?: number;
  weekdays?: number[];
  dayOfMonth?: number;
  nthWeekday?: {
    ordinal: 1 | 2 | 3 | 4 | 5;
    weekday: number;
  };
};

export type Calendar = {
  id: string;
  name: string;
  color: string;
  favorite?: boolean;
  /**
   * Put away: out of the calendar list and the event pickers, and off the grid
   * unless it is switched on for a look, with its events left in the vault
   * untouched. Absent rather than `false` on a calendar that has never been
   * archived.
   */
  archived?: boolean;
  /** As `NoteDraft.raw`: what a save merges onto, so unknown fields survive. */
  raw?: string;
};

/**
 * A photo (or other binary) attached to a note. The bytes live outside the
 * sealed-object store, chunked and encrypted under `adk`, so this reference is
 * all the note payload carries. A reader that predates the field ignores it; the
 * body refers to it as `![filename](attachment:<id>)`.
 */
export type NoteAttachment = {
  /** Matches the server-side attachment id and the `attachment:<id>` body ref. */
  id: string;
  filename: string;
  mimeType: string;
  /** Original plaintext size, for display. */
  byteSize: number;
  width?: number;
  height?: number;
  /** Base64url attachment data key, sealed with the rest of the note. */
  adk: string;
  /** Base64url rolled-up content hash, checked on download. */
  contentHash: string;
  chunkSize: number;
  chunkCount: number;
  /**
   * Displayed width in CSS pixels, as the user dragged it. Presentational, so it
   * lives here rather than in the body markdown, which has no width syntax and
   * must round-trip unchanged. Absent means show at natural size.
   */
  displayWidth?: number;
  /**
   * Small inline preview (data URI) that rides inside the sealed note, so a list
   * or an offline view shows something without fetching the full photo. Absent
   * for a non-image attachment.
   */
  thumbnail?: string;
};

export type NoteDraft = {
  title: string;
  /** Markdown source, as typed. Rendered by `parseMarkdown`, never as HTML. */
  body: string;
  notebookId: string;
  /**
   * The note this one sits under, making the notebook a tree rather than a flat
   * list. Absent for a note at the notebook's top level, which is every note
   * written before the field existed. A parent in another notebook, or one that
   * is missing, is read as absent rather than followed.
   */
  parentId?: string;
  /**
   * Photos and other binary attachments. Omitted when empty, so a note with no
   * attachments looks the same to a reader that predates the field.
   */
  attachments?: NoteAttachment[];
  /**
   * Client-generated, like a contact's. The server keeps no user timestamps, so
   * an edit that does not carry `createdAt` forward loses it. Both are optional:
   * the CLI may write a note without them.
   */
  createdAt?: string;
  updatedAt?: string;
  /**
   * The payload this draft was parsed from, when it came from one. A save
   * merges onto it, so a field written by a newer build survives an edit here
   * rather than being dropped. Absent for a draft started from scratch.
   */
  raw?: string;
};

export type Note = NoteDraft & { id: string; raw: string };

export type Notebook = {
  id: string;
  name: string;
  raw: string;
};

export type BookmarkDraft = {
  /**
   * As the user typed it, after `normalizeUrl` has added a scheme. Nothing ever
   * fetches it: which URLs an account holds must not leak to the sites in them.
   */
  url: string;
  title: string;
  /** The user's own note about why the URL was saved, not the page's text. */
  notes?: string;
  tags?: string[];
  collectionId: string;
  /** Client-generated, as a note's, and carried forward by an edit. */
  createdAt?: string;
  updatedAt?: string;
  /**
   * The payload this draft was parsed from, when it came from one. A save merges
   * onto it, so a field written by a newer build survives an edit here.
   */
  raw?: string;
};

export type Bookmark = BookmarkDraft & { id: string; raw: string };

/**
 * Collections nest: `parentId` points at the collection this one sits inside,
 * and is absent at the top level. A pointer that is missing, is the collection
 * itself, or sits on a cycle is read as absent rather than allowed to hide a
 * collection or spin a walk forever. See `lib/tree`.
 */
export type BookmarkCollection = {
  id: string;
  name: string;
  parentId?: string;
  /**
   * Explicit colour. Only meaningful on a top-level collection: every
   * collection nested under it adopts its root's colour rather than carrying
   * one of its own. See `collectionTone` in `lib/bookmark`.
   */
  color?: string;
  raw: string;
};

/**
 * Colour a calendar starts life with, and the fallback for one stored without
 * a colour. Matches `--color-accent`, but is duplicated here on purpose: the
 * value is persisted per calendar, so it cannot follow the theme token once a
 * calendar exists. Keep the two in step by hand if the accent ever changes.
 */
export const DEFAULT_CALENDAR_COLOR = "#7aa2f7";

export type OpaqueStart = {
  request: string;
  state: string;
};

export type Enrollment = {
  device_id: string;
  hpke_sk: string;
  hpke_pk: string;
  mldsa_seed: string;
  mldsa_pk: string;
  ed25519_sk: string;
  ed25519_pk: string;
  kdf_salt: string;
  collection_key: string;
  enrollment_mldsa: string;
  enrollment_ed25519: string;
  device_enc: string;
  device_wrapped_ck: string;
  recovery_nonce: string;
  recovery_wrapped_ck: string;
  phrase: string;
  phrase_nonce: string;
  phrase_wrapped_ck: string;
  phrase_mldsa_pk: string;
  phrase_ed25519_pk: string;
  phrase_lookup_id: string;
  phrase_scheme: string;
  phrase_ciphersuite: string;
  xwing_ciphersuite: string;
  recovery_ciphersuite: string;
};

/** Hybrid recovery-phrase material registered with the server. */
export type PhraseRecovery = {
  mldsa_pk: string;
  ed25519_pk: string;
  lookup_id: string;
  scheme: string;
};

export type DualSignature = {
  mldsa: string;
  ed25519: string;
};

export type DeviceOut = {
  device_id: string;
  hpke_sk: string;
  hpke_pk: string;
  mldsa_seed: string;
  mldsa_pk: string;
  ed25519_sk: string;
  ed25519_pk: string;
  enrollment_mldsa: string;
  enrollment_ed25519: string;
};

export type DevicePublic = {
  device_id: string;
  mldsa_pk: string;
  ed25519_pk: string;
  xwing_hpke_pk: string;
};

/** Step 2 of login: the opened challenge plus the device's proof of it. */
export type LoginStartProof = DualSignature & {
  challenge: string;
};

/** Step 3 of login. */
export type LoginProof = DualSignature & {
  finalization: string;
};

export type ManifestEntry = {
  id: string;
  revision: number;
  tombstone: boolean;
  content_digest: string;
};

export type ManifestBody = {
  manifest_seq: number;
  key_epoch: number;
  latest_revision: number;
  object_count: number;
  digest: string;
  device_id: string;
  signature: DualSignature;
};

export type RotatedObject = {
  id: string;
  revision: number;
  nonce: string;
  ciphertext: string;
  padded_size: number;
  content_type: string;
  tombstone: boolean;
};

export type EncryptedOut = {
  nonce: string;
  ciphertext: string;
  padded_size: number;
};

/** One object's plaintext after its sealed envelope has been opened. */
export type OpenedObject = {
  /**
   * Authenticated by the AEAD along with the payload, so this is the type to
   * parse by rather than the label the server serves.
   */
  contentType: string;
  tombstone: boolean;
  payload: string;
};

export type PasswordWrapOut = {
  kdf_salt: string;
  recovery_nonce: string;
  recovery_wrapped_ck: string;
  recovery_ciphersuite: string;
};

export type PhraseWrapOut = {
  phrase: string;
  phrase_nonce: string;
  phrase_wrapped_ck: string;
  phrase_mldsa_pk: string;
  phrase_ed25519_pk: string;
  phrase_lookup_id: string;
  phrase_scheme: string;
  phrase_ciphersuite: string;
};

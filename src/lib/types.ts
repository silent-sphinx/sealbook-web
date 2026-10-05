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

/** The three vault features an account can turn off; settings is always on. */
export type FeatureKey = "contacts" | "calendar" | "notes";

/**
 * Account-wide preferences, stored in the vault so they follow the account to
 * every client rather than living in one browser. See `lib/accountSettings`.
 */
export type AccountSettings = {
  features: Record<FeatureKey, boolean>;
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
  addressBookId: string;
  createdAt?: string;
  updatedAt?: string;
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
};

export type NoteDraft = {
  title: string;
  /** Markdown source, as typed. Rendered by `parseMarkdown`, never as HTML. */
  body: string;
  notebookId: string;
  pinned?: boolean;
  /**
   * Client-generated, like a contact's. The server keeps no user timestamps, so
   * an edit that does not carry `createdAt` forward loses it. Both are optional:
   * the CLI may write a note without them.
   */
  createdAt?: string;
  updatedAt?: string;
};

/**
 * `raw` is the payload as stored, kept for parity with `Contact` and for a debug
 * view. It is not authoritative: a save serialises from the draft, so a field a
 * build does not know about is dropped on edit, exactly as for contacts.
 */
export type Note = NoteDraft & { id: string; raw: string };

export type Notebook = {
  id: string;
  name: string;
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
   * False for an object stored before the envelope existed. Its type is only the
   * label the server serves, which nothing authenticates, and the next rotation
   * seals a type into it.
   */
  sealed: boolean;
  contentType: string | null;
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

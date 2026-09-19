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
  phrase_verifier: string;
  phrase_ciphersuite: string;
  xwing_ciphersuite: string;
  recovery_ciphersuite: string;
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

export type LoginProof = {
  finalization: string;
  challenge: string;
  mldsa: string;
  ed25519: string;
};

export type EncryptedOut = {
  nonce: string;
  ciphertext: string;
  padded_size: number;
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
  phrase_verifier: string;
  phrase_ciphersuite: string;
};

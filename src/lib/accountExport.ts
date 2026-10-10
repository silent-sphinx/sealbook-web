import type { VaultExport } from "./client";
import type { DeviceState } from "./types";

/**
 * Identifies a full account export. Mirrors `ACCOUNT_EXPORT_TYPE` and
 * `ACCOUNT_EXPORT_VERSION` in `sealbook/crates/sealbook-protocol/src/lib.rs`, so
 * an export written here and one written by the CLI are the same document. Bump
 * the version in both or neither.
 */
export const ACCOUNT_EXPORT_TYPE = "SealbookAccountExport";
export const ACCOUNT_EXPORT_VERSION = "1.0";

/**
 * One object as the export carries it. `payload` holds the parsed JSON; `text`
 * holds the plaintext verbatim when it is not JSON, which no content type in use
 * produces but which keeps an unreadable object in the backup rather than
 * dropping it.
 */
export type AccountExportObject = {
  id: string;
  contentType: string;
  payload?: unknown;
  text?: string;
};

export type AccountExportBundle = {
  "@type": typeof ACCOUNT_EXPORT_TYPE;
  version: typeof ACCOUNT_EXPORT_VERSION;
  exportedAt: string;
  account: {
    server: string;
    username: string;
    accountId: string;
    collectionId: string;
    deviceId: string;
  };
  objectCount: number;
  objects: AccountExportObject[];
  /**
   * Objects this device could not open, omitted when there were none. A reader
   * that sees it knows the backup is short of the vault by that many objects.
   */
  unreadable?: number;
};

/**
 * The whole vault as one JSON document.
 *
 * Payloads go out as stored, not as the fields a view reads, so an object
 * written by a newer build is in the backup intact. Sorted by content type then
 * id, so two exports of an unchanged vault are the same bytes.
 */
export function buildAccountExport(
  state: DeviceState,
  vault: VaultExport,
  exportedAt: string = new Date().toISOString(),
): AccountExportBundle {
  const objects = vault.objects
    .map(({ id, contentType, payload }) => {
      const entry: AccountExportObject = { id, contentType };
      try {
        entry.payload = JSON.parse(payload);
      } catch {
        entry.text = payload;
      }
      return entry;
    })
    .sort((a, b) => a.contentType.localeCompare(b.contentType) || a.id.localeCompare(b.id));

  return {
    "@type": ACCOUNT_EXPORT_TYPE,
    version: ACCOUNT_EXPORT_VERSION,
    exportedAt,
    account: {
      server: state.server,
      username: state.username,
      accountId: state.account_id,
      collectionId: state.collection_id,
      deviceId: state.device_id,
    },
    objectCount: objects.length,
    objects,
    ...(vault.unreadable > 0 ? { unreadable: vault.unreadable } : {}),
  };
}

/** A filename carrying the account and the day, safe on every filesystem. */
export function accountExportFilename(username: string, date = new Date()): string {
  const slug = username.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
  return `sealbook-account-${slug || "export"}-${date.toISOString().slice(0, 10)}.json`;
}

export function generateAccountExportData(
  state: DeviceState,
  vault: VaultExport,
): { filename: string; mime: string; data: string } {
  const bundle = buildAccountExport(state, vault);
  return {
    filename: accountExportFilename(state.username),
    mime: "application/json;charset=utf-8",
    data: JSON.stringify(bundle, null, 2),
  };
}

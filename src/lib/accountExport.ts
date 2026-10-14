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

/** One object as an import writes it: the payload is the text that goes back. */
export type AccountImportObject = {
  id: string;
  contentType: string;
  payload: string;
};

export type AccountImport = {
  objects: AccountImportObject[];
  /** The account the file was written from, for the line the import reports. */
  source: string;
  /**
   * Objects the exporting device could not open, from the file's `unreadable`
   * count. The file is short of the vault it came from by this many, so an
   * import of it cannot be a complete restore and has to say so.
   */
  unreadable: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const major = (version: string) => version.split(".")[0] ?? "";

/**
 * Reads an export document, refusing one that cannot be restored faithfully.
 *
 * Mirrors `parse_account_export` in `sealbook/crates/sealbook-cli/src/main.rs`:
 * a file written by either client has to read back in the other. A payload is
 * carried as the file writes it, so a field this build does not know survives
 * the round trip, and `text` is restored as those same bytes. A newer minor
 * version is accepted, since the format only gains fields and objects go back
 * untouched either way; a newer major is refused, because the meaning of what is
 * already there may have changed.
 */
export function parseAccountExport(document: string): AccountImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(document);
  } catch {
    throw new Error("This is not a JSON document.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("This is not a JSON document.");
  }
  const bundle = parsed as Record<string, unknown>;
  if (bundle["@type"] !== ACCOUNT_EXPORT_TYPE) {
    throw new Error(`This is not a Sealbook account export file.`);
  }
  const version = bundle.version;
  if (typeof version !== "string") {
    throw new Error("The file has no version.");
  }
  if (major(version) !== major(ACCOUNT_EXPORT_VERSION)) {
    throw new Error(
      `The file is version ${version} and this app reads ${ACCOUNT_EXPORT_VERSION}. ` +
        `Update whichever is older.`,
    );
  }
  if (!Array.isArray(bundle.objects)) {
    throw new Error("The file has no objects.");
  }

  const objects: AccountImportObject[] = [];
  const seen = new Set<string>();
  bundle.objects.forEach((entry: unknown, index) => {
    const position = index + 1;
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`Object ${position} is not an object.`);
    }
    const { id, contentType, payload, text } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !UUID.test(id)) {
      throw new Error(`Object ${position} has an id that is not a UUID.`);
    }
    if (seen.has(id)) {
      throw new Error(`Object ${position} repeats id ${id}.`);
    }
    seen.add(id);
    if (typeof contentType !== "string" || contentType === "") {
      throw new Error(`Object ${id} has no contentType.`);
    }
    if (payload === undefined || payload === null) {
      if (typeof text !== "string") {
        throw new Error(`Object ${id} has neither a payload nor text.`);
      }
      objects.push({ id, contentType, payload: text });
      return;
    }
    objects.push({ id, contentType, payload: JSON.stringify(payload) });
  });

  const account = (bundle.account ?? {}) as Record<string, unknown>;
  const source =
    typeof account.username === "string" && typeof account.server === "string"
      ? `${account.username} at ${account.server}`
      : "an export with no account block";
  const unreadable = typeof bundle.unreadable === "number" ? bundle.unreadable : 0;
  return { objects, source, unreadable };
}

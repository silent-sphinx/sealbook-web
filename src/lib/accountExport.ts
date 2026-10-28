import type { VaultExport } from "./client";
import type { DeviceState } from "./types";
import {
  coreAccountExportFilename,
  coreAccountExportParse,
  coreAccountExportWrite,
  coreErrorOf,
} from "./wasm";

/**
 * The whole vault as one JSON document, written by `sealbook-core` so that an
 * export from here, from the CLI and from Android are the same document.
 */
export function generateAccountExportData(
  state: DeviceState,
  vault: VaultExport,
  exportedAt: string = new Date().toISOString(),
): { filename: string; mime: string; data: string } {
  const data = coreAccountExportWrite(
    {
      server: state.server,
      username: state.username,
      account_id: state.account_id,
      collection_id: state.collection_id,
      device_id: state.device_id,
    },
    vault.objects.map(({ id, contentType, payload }) => ({
      id,
      content_type: contentType,
      payload,
    })),
    vault.unreadable,
    exportedAt,
  );
  return {
    filename: accountExportFilename(state.username),
    mime: "application/json;charset=utf-8",
    data,
  };
}

/** A filename carrying the account and the day, safe on every filesystem. */
export function accountExportFilename(username: string, date = new Date()): string {
  return coreAccountExportFilename(username, date.toISOString().slice(0, 10));
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

/** Reads an export document, throwing an `Error` that says why it cannot be restored. */
export function parseAccountExport(document: string): AccountImport {
  try {
    const { objects, source, unreadable } = coreAccountExportParse(document);
    return {
      objects: objects.map(({ id, content_type, payload }) => ({
        id,
        contentType: content_type,
        payload,
      })),
      source,
      unreadable,
    };
  } catch (err) {
    const core = coreErrorOf(err);
    throw core?.kind === "Malformed" ? new Error(core.detail) : err;
  }
}

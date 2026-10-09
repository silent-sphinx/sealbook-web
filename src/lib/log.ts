/**
 * Console logging for the web client.
 *
 * Nothing logged here may carry secret material: no password, recovery word,
 * collection key, session token, or decrypted payload. Fields are restricted to
 * scalars so an object holding one cannot be passed in by accident, and request
 * logging strips identifiers out of paths rather than printing them.
 */

import { PAYLOAD_SCHEMA_VERSION } from "./payload";
import { PROTOCOL_VERSION } from "./protocol";

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

export type Fields = Record<string, string | number | boolean | undefined>;

const RANK: Record<LogLevel, number> = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

/** Set to a level name in localStorage to override the build's default. */
export const LOG_LEVEL_KEY = "sealbook.log";

const BADGE_BASE = "border-radius:3px;padding:0 5px;color:#161616;font-weight:600";
const BADGE_COLOR: Record<Exclude<LogLevel, "silent">, string> = {
  error: "#e49090",
  warn: "#e4c48c",
  info: "#8fcbbc",
  debug: "#9aa0a6",
};

function isLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && value in RANK;
}

function storedLevel(): LogLevel | null {
  try {
    const raw = localStorage.getItem(LOG_LEVEL_KEY);
    return isLevel(raw) ? raw : null;
  } catch {
    return null;
  }
}

function defaultLevel(): LogLevel {
  if (import.meta.env.MODE === "test") return "silent";
  return import.meta.env.DEV ? "debug" : "info";
}

let level: LogLevel = storedLevel() ?? defaultLevel();

export function getLogLevel(): LogLevel {
  return level;
}

/** Changes the level for this page, and remembers it for later loads. */
export function setLogLevel(next: LogLevel): void {
  level = next;
  try {
    localStorage.setItem(LOG_LEVEL_KEY, next);
  } catch {
    // level still applies to this page
  }
}

export function formatFields(fields?: Fields): string {
  if (!fields) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    parts.push(`${key}=${value}`);
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

/** `name: message` for an unknown throwable, without the stack or own fields. */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.name && err.name !== "Error" ? `${err.name}: ${err.message}` : err.message;
  }
  return String(err);
}

function emit(
  kind: Exclude<LogLevel, "silent">,
  // console.debug is filtered out of Chrome's default view, so everything below
  // a warning goes through console.log instead.
  write: (...args: unknown[]) => void,
  message: string,
  fields?: Fields,
  cause?: unknown,
): void {
  if (RANK[level] < RANK[kind]) return;
  const line = `%csealbook%c ${message}${formatFields(fields)}`;
  const badge = `${BADGE_BASE};background:${BADGE_COLOR[kind]}`;
  if (cause === undefined) {
    write(line, badge, "");
  } else {
    write(line, badge, "", cause);
  }
}

export const log = {
  error(message: string, fields?: Fields, cause?: unknown): void {
    emit("error", console.error, message, fields, cause);
  },
  warn(message: string, fields?: Fields, cause?: unknown): void {
    emit("warn", console.warn, message, fields, cause);
  },
  info(message: string, fields?: Fields): void {
    emit("info", console.log, message, fields);
  },
  debug(message: string, fields?: Fields): void {
    emit("debug", console.log, message, fields);
  },
  /** For call sites whose fields cost something to assemble. */
  enabled(kind: Exclude<LogLevel, "silent">): boolean {
    return RANK[level] >= RANK[kind];
  },
};

/** Milliseconds since a `performance.now()` mark, rounded. */
export function elapsed(start: number): number {
  return Math.round(performance.now() - start);
}

/**
 * The host of a server address, for logs that name the instance in use.
 *
 * The host is what distinguishes one deployment from another; the rest of the
 * URL is not worth printing and a malformed value is not worth echoing back.
 */
export function serverHost(server: string): string {
  try {
    return new URL(server).host;
  } catch {
    return "invalid";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * A request path with the account's identifiers replaced and the query dropped.
 *
 * Collection, object and pairing ids are not secret, but a console full of them
 * is unreadable and they are of no use when diagnosing a request.
 */
export function logPath(url: string): string {
  const path = url.startsWith("http") ? new URL(url).pathname : url.split("?")[0];
  return path
    .split("/")
    .map((segment) => (UUID.test(segment) || segment.length > 40 ? ":id" : segment))
    .join("/");
}

const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "unknown";

type Capabilities = {
  secure_context: boolean;
  crypto_subtle: boolean;
  indexeddb: boolean;
  local_storage: boolean;
  service_worker: boolean;
  /** A controlling worker means the page may be served from its cache. */
  service_worker_active: boolean;
};

function capabilities(): Capabilities {
  let localStorageWorks = false;
  try {
    const probe = "sealbook.probe";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    localStorageWorks = true;
  } catch {
    localStorageWorks = false;
  }
  return {
    secure_context: window.isSecureContext,
    crypto_subtle: typeof crypto !== "undefined" && typeof crypto.subtle === "object",
    indexeddb: typeof indexedDB !== "undefined",
    local_storage: localStorageWorks,
    service_worker: "serviceWorker" in navigator,
    service_worker_active:
      "serviceWorker" in navigator && navigator.serviceWorker.controller !== null,
  };
}

/**
 * The first lines in the console on every load.
 *
 * Sealbook is self-hosted, so the first question about any report is which
 * build is talking to which server over which protocol generation. The browser
 * capabilities follow because three of the five are hard requirements, and
 * without them the app fails somewhere far from the cause.
 */
export function logStartup(): void {
  if (RANK[level] < RANK.info) return;
  log.info("starting sealbook-web", {
    version: APP_VERSION,
    build: import.meta.env.DEV ? "development" : "production",
    protocol: PROTOCOL_VERSION,
    payload_schema: PAYLOAD_SCHEMA_VERSION,
  });
  const caps = capabilities();
  log.info("browser capabilities", { ...caps });
  if (!caps.secure_context || !caps.crypto_subtle) {
    log.error(
      "this page is not a secure context with Web Crypto, so nothing can be encrypted; " +
        "serve it over https or from localhost",
    );
  }
  if (!caps.local_storage) {
    log.warn(
      "site data is blocked, so this browser cannot be enrolled as a device; " +
        "private browsing is the usual cause",
    );
  } else if (!caps.indexeddb) {
    log.warn("IndexedDB is unavailable, so the vault cannot be used offline");
  }
  if (level !== "debug") {
    log.info(
      `for request-level detail run localStorage.setItem("${LOG_LEVEL_KEY}", "debug") and reload`,
    );
  }
}

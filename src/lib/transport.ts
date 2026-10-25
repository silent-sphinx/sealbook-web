import { describeError, elapsed, log, logPath } from "./log";

export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export const REQUEST_TIMEOUT_MS = 30_000;

export class ServerUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerUnreachableError";
  }
}

export class RequestTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestTimeoutError";
  }
}

export function errorMessage(text: string, statusText: string): string {
  try {
    const body = JSON.parse(text) as { error?: string };
    return body.error ?? text;
  } catch {
    return text || statusText;
  }
}

export async function request<T>(method: string, url: string, init: RequestInit): Promise<T> {
  return JSON.parse(await requestText(method, url, init)) as T;
}

/**
 * As `request`, stopping at the text the server sent.
 *
 * For a body that goes straight to core, which parses it itself: `Vec<u8>`
 * crosses the wasm boundary as `number[]`, so handing it the text avoids both a
 * parse here and an array of bytes there.
 */
export async function requestText(method: string, url: string, init: RequestInit): Promise<string> {
  const path = logPath(url);
  const started = performance.now();
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;

  const failure = (err: unknown): Error => {
    if (signal.aborted && !timeout.aborted) {
      return err instanceof Error ? err : new Error(describeError(err));
    }
    log.error(timeout.aborted ? "request timed out" : "request did not reach the server", {
      method,
      path,
      ms: elapsed(started),
      reason: describeError(err),
    });
    return timeout.aborted
      ? new RequestTimeoutError(
          `The server accepted the connection but sent nothing back within ${
            REQUEST_TIMEOUT_MS / 1000
          } seconds.`,
        )
      : new ServerUnreachableError("The server could not be reached.");
  };

  let res: Response;
  try {
    res = await fetch(url, { ...init, signal });
  } catch (err) {
    throw failure(err);
  }
  const ms = elapsed(started);
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    throw failure(err);
  }
  if (!res.ok) {
    const message = errorMessage(text, res.statusText);
    log.warn("server refused a request", { method, path, status: res.status, ms, reason: message });
    throw new ApiError(message);
  }
  log.debug("request", { method, path, status: res.status, ms, bytes: text.length });
  return text;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function normalizeServer(server: string): string {
  const trimmed = server.trim().replace(/\/$/u, "");
  if (!trimmed) {
    return "";
  }
  const candidate = /^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(candidate);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Connection domain must use http or https.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Connection domain cannot contain credentials.");
  }
  if (parsed.protocol === "http:" && !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error("Connection domain must use https.");
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/$/u, "")}`;
}

// The dev server's default loopback origins are collapsed to relative paths so
// requests ride the Vite proxy (vite.config.ts). A host with no proxy turns this
// off once at bootstrap: in a browser extension a relative path resolves against
// the extension's own package, where every request 404s.
let proxyLoopback = true;

export function setProxyLoopback(enabled: boolean): void {
  proxyLoopback = enabled;
}

export function apiRoot(server: string): string {
  const trimmed = normalizeServer(server);
  if (!trimmed) {
    return "";
  }
  if (
    proxyLoopback &&
    (trimmed === "https://127.0.0.1:8443" || trimmed === "https://localhost:8443")
  ) {
    return "";
  }
  return trimmed;
}

export async function postJson<T>(url: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return request<T>("POST", url, { method: "POST", headers, body: JSON.stringify(body) });
}

export async function putJson<T>(url: string, body: unknown, token: string): Promise<T> {
  return request<T>("PUT", url, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

export async function getJson<T>(url: string, token?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return request<T>("GET", url, { headers });
}

export async function getText(url: string, token?: string): Promise<string> {
  const headers: Record<string, string> = {};
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return requestText("GET", url, { headers });
}

export async function deleteJson<T>(url: string, token: string, body?: unknown): Promise<T> {
  return request<T>("DELETE", url, {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

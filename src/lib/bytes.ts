export function b64encode(bytes: Uint8Array): string {
  let bin = "";
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function bytesFromJson(value: number[] | string): string {
  if (typeof value === "string") {
    if (value.includes(",") || /^\d/u.test(value)) {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (Array.isArray(parsed)) {
          return b64encode(Uint8Array.from(parsed));
        }
      } catch {
        return value;
      }
    }
    return value;
  }
  return b64encode(Uint8Array.from(value));
}

export function b64ToByteArray(b64: string): number[] {
  const pad = "=".repeat((4 - (b64.length % 4 || 4)) % 4);
  const normalized = b64.replaceAll("-", "+").replaceAll("_", "/") + pad;
  const bin = atob(normalized);
  const out = new Array<number>(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export function isPayloadOfType(raw: string, type: string): boolean {
  try {
    return (JSON.parse(raw) as { "@type"?: string })["@type"] === type;
  } catch {
    return false;
  }
}

export function isAddressBookPayload(raw: string): boolean {
  return isPayloadOfType(raw, "AddressBook");
}

/**
 * A Card, or the untagged legacy shape that predates @type. Anything else is
 * not a contact, which keeps a future content type from being rendered and
 * then overwritten as one.
 */
export function isContactPayload(raw: string): boolean {
  try {
    const body = JSON.parse(raw) as { "@type"?: string; name?: unknown };
    if (typeof body["@type"] === "string") return body["@type"] === "Card";
    return typeof body.name === "object" && body.name !== null;
  } catch {
    return false;
  }
}

export function isCalendarEventPayload(raw: string): boolean {
  return isPayloadOfType(raw, "CalendarEvent");
}

export function isCalendarPayload(raw: string): boolean {
  return isPayloadOfType(raw, "Calendar");
}

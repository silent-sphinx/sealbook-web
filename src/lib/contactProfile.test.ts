import { describe, expect, it } from "vitest";

import {
  MAX_PROFILE_ENTRIES,
  customSectionIsEmpty,
  MAX_PROFILE_TEXT_CHARS,
  emptyProfile,
  filledSections,
  formatDateRange,
  formatPartialDate,
  lifeEventOrder,
  parseProfile,
  profileIsEmpty,
  sectionIsEmpty,
  serializeProfile,
} from "./contactProfile";
import {
  MAX_CONTACT_NOTES_CHARS,
  contactValidationError,
  emptyDraft,
  parseDraft,
  serializeCard,
} from "./contact";
import type { ContactProfile } from "./types";

function profile(over: Partial<ContactProfile> = {}): ContactProfile {
  return { ...emptyProfile(), ...over };
}

const filled = (): ContactProfile =>
  profile({
    howWeMet: "Queue for the wrong train at Reading, 2019.",
    interests: [{ id: "a", value: "Bouldering" }],
    music: [{ id: "b", value: "Talking Heads" }],
    food: [{ id: "c", polarity: "dislike", value: "Coriander", note: "Tastes of soap" }],
    pets: [{ id: "d", name: "Mabel", species: "Border terrier" }],
    career: [
      { id: "e", organization: "Ordnance Survey", title: "Cartographer", start: "2019-04", end: "2023-01" },
    ],
    relationships: [
      { id: "f", name: "Sam", kind: "Partner", start: "2015", current: true },
    ],
    timeline: [{ id: "g", title: "Moved to Bristol", date: "2021-09", description: "For the job." }],
    family: [{ id: "h", name: "Rosa", relation: "Mother" }],
    friends: [{ id: "i", name: "Tomas", note: "Also climbs" }],
    colleagues: [{ id: "k", name: "Priya", note: "Leads the data team" }],
    custom: [{ id: "j", title: "Coffee order", text: "Flat white, oat milk." }],
  });

describe("the profile payload", () => {
  it("round trips every section through a card", () => {
    const draft = { ...emptyDraft(), name: "Jo Bell", profile: filled() };
    const parsed = parseDraft(serializeCard(draft));
    const back = parsed.profile;
    expect(back).toBeDefined();
    expect(back?.howWeMet).toBe(filled().howWeMet);
    expect(back?.interests.map((row) => row.value)).toEqual(["Bouldering"]);
    expect(back?.food[0]).toMatchObject({
      polarity: "dislike",
      value: "Coriander",
      note: "Tastes of soap",
    });
    expect(back?.career).toEqual([]);
    expect(parsed.work[0]).toMatchObject({
      organization: "Ordnance Survey",
      title: "Cartographer",
      start: "2019-04",
      end: "2023-01",
    });
    expect(back?.timeline[0]).toMatchObject({ title: "Moved to Bristol", date: "2021-09" });
    expect(back?.family[0]).toMatchObject({ name: "Rosa", relation: "Mother" });
    expect(back?.friends[0]).toMatchObject({ name: "Tomas", note: "Also climbs" });
    expect(back?.colleagues[0]).toMatchObject({ name: "Priya", note: "Leads the data team" });
    expect(back?.relationships[0]).toMatchObject({ name: "Sam", current: true });
    expect(back?.custom[0]).toMatchObject({ title: "Coffee order", text: "Flat white, oat milk." });
  });

  it("omits a relationship's current flag when it is not set", () => {
    const body = serializeProfile(
      profile({ relationships: [{ id: "a", name: "Alex", kind: "Partner" }] }),
    );
    expect(JSON.stringify(body)).not.toContain("current");
  });

  it("never stores an end date for a current relationship", () => {
    const body = serializeProfile(
      profile({
        relationships: [
          { id: "a", name: "Sam", kind: "Partner", start: "2015", end: "2020", current: true },
        ],
      }),
    );
    expect(body?.relationships).toEqual([
      { name: "Sam", kind: "Partner", start: "2015", current: true },
    ]);
  });

  it("drops an end date carried alongside a current flag on parse", () => {
    const back = parseProfile({ relationships: [{ name: "Sam", current: true, end: "2020" }] });
    expect(back?.relationships[0].current).toBe(true);
    expect(back?.relationships[0].end).toBeUndefined();
  });

  it("drops a custom section with neither a title nor a body", () => {
    const body = serializeProfile(
      profile({
        custom: [
          { id: "a", title: "  ", text: "" },
          { id: "b", title: "Nicknames", text: "Bubs" },
        ],
      }),
    );
    expect(body?.custom).toEqual([{ title: "Nicknames", text: "Bubs" }]);
  });

  it("keeps a custom section that has only a body", () => {
    const body = serializeProfile(profile({ custom: [{ id: "a", title: "", text: "Loose note" }] }));
    expect(body?.custom).toEqual([{ text: "Loose note" }]);
  });

  it("adds no key to a card when nothing is filled in", () => {
    const draft = { ...emptyDraft(), name: "Jo Bell", profile: emptyProfile() };
    expect(serializeCard(draft)).not.toContain("sealbook:profile");
    expect(parseDraft(serializeCard(draft)).profile).toBeUndefined();
  });

  it("omits absent fields rather than writing null", () => {
    const body = serializeProfile(profile({ pets: [{ id: "p", name: "Mabel" }] }));
    expect(body?.pets).toEqual([{ name: "Mabel" }]);
    expect(JSON.stringify(body)).not.toContain("null");
  });

  it("names its type so the payload is recognisable on its own", () => {
    expect(serializeProfile(filled())?.["@type"]).toBe("SealbookProfile");
  });

  it("drops a row with no identifying value instead of storing a blank", () => {
    const body = serializeProfile(
      profile({
        pets: [{ id: "a", name: "   " }, { id: "b", name: "Mabel" }],
        friends: [{ id: "c", name: "", note: "a note with nobody attached" }],
      }),
    );
    expect(body?.pets).toEqual([{ name: "Mabel" }]);
    expect(body?.friends).toBeUndefined();
  });

  it("reads an unreadable entry as absent rather than failing the profile", () => {
    const back = parseProfile({
      interests: "not a list",
      pets: [null, 7, { name: "Mabel" }],
      food: [{ value: "Olives", polarity: "indifferent" }],
    });
    expect(back?.interests).toEqual([]);
    expect(back?.pets.map((row) => row.name)).toEqual(["Mabel"]);
    // An unknown polarity reads as a like, which is the field's default.
    expect(back?.food[0].polarity).toBe("like");
  });

  it("is undefined for a value that is not a profile at all", () => {
    expect(parseProfile(undefined)).toBeUndefined();
    expect(parseProfile("text")).toBeUndefined();
    expect(parseProfile({})).toBeUndefined();
  });

  it("gives each parsed row an id, so the editor can key on it", () => {
    const back = parseProfile({ interests: ["Bouldering", "Baking"] });
    const ids = back?.interests.map((row) => row.id) ?? [];
    expect(new Set(ids).size).toBe(2);
  });

  it("caps a section at the entry limit on both serialize and parse", () => {
    const many = Array.from({ length: MAX_PROFILE_ENTRIES + 10 }, (_, index) => ({
      id: String(index),
      value: `Interest ${index}`,
    }));
    const body = serializeProfile(profile({ interests: many }));
    expect(body?.interests).toHaveLength(MAX_PROFILE_ENTRIES);
    const back = parseProfile({ interests: many.map((row) => row.value) });
    expect(back?.interests.length).toBe(MAX_PROFILE_ENTRIES);
  });

  it("truncates an over-long text field on parse rather than rejecting the card", () => {
    const back = parseProfile({ howWeMet: "x".repeat(MAX_PROFILE_TEXT_CHARS + 50) });
    expect(back?.howWeMet?.length).toBe(MAX_PROFILE_TEXT_CHARS);
  });
});

describe("section emptiness", () => {
  it("counts whitespace-only rows as empty", () => {
    expect(sectionIsEmpty(profile({ interests: [{ id: "a", value: "  " }] }), "interests")).toBe(
      true,
    );
    expect(profileIsEmpty(profile({ howWeMet: "   " }))).toBe(true);
  });

  it("lists filled sections in display order, not insertion order", () => {
    expect(filledSections(filled())).toEqual([
      "howWeMet",
      "interests",
      "food",
      "music",
      "pets",
      "relationships",
      "timeline",
      "family",
      "friends",
      "colleagues",
    ]);
  });
});

describe("partial dates", () => {
  it("shows a year alone as a year", () => {
    expect(formatPartialDate("2019")).toBe("2019");
  });

  it("shows a year and month without inventing a day", () => {
    expect(formatPartialDate("2019-04")).toMatch(/2019/);
    expect(formatPartialDate("2019-04")).not.toMatch(/\b1\b/);
  });

  it("passes anything it cannot read back verbatim", () => {
    expect(formatPartialDate("the summer of 2019")).toBe("the summer of 2019");
    expect(formatPartialDate(undefined)).toBe("");
  });

  it("reads an open end as present, and a range with no start as the end alone", () => {
    expect(formatDateRange("2019", undefined)).toBe("2019 - Present");
    expect(formatDateRange(undefined, "2019")).toBe("2019");
    expect(formatDateRange("2015", "2018")).toBe("2015 - 2018");
    expect(formatDateRange(undefined, undefined)).toBe("");
  });
});

describe("life event order", () => {
  function sortDates(dates: string[]): string[] {
    return [...dates]
      .map((date) => ({ date, key: lifeEventOrder(date) }))
      .sort((a, b) => {
        if (a.key === null) return b.key === null ? 0 : 1;
        if (b.key === null) return -1;
        return a.key - b.key;
      })
      .map((entry) => entry.date);
  }

  it("places a month/year event in its month, not below the full dates", () => {
    expect(sortDates(["2015-06-20", "2021-03", "2022-01-01"])).toEqual([
      "2015-06-20",
      "2021-03",
      "2022-01-01",
    ]);
  });

  it("orders a value missing its leading zero as the same month", () => {
    expect(lifeEventOrder("2021-3")).toBe(lifeEventOrder("2021-03"));
    expect(sortDates(["2021-12-25", "2021-3"])).toEqual(["2021-3", "2021-12-25"]);
  });

  it("reads a month and year typed as words, where a browser has no month picker", () => {
    expect(sortDates(["2022-01-01", "March 2021", "2015-06-20"])).toEqual([
      "2015-06-20",
      "March 2021",
      "2022-01-01",
    ]);
  });

  it("sorts a month/year above the first full day of the same month", () => {
    expect(lifeEventOrder("2021-03")).toBeLessThan(lifeEventOrder("2021-03-01") as number);
  });

  it("is null for an absent or unreadable date, which sends the entry to the end", () => {
    expect(lifeEventOrder(undefined)).toBeNull();
    expect(lifeEventOrder("")).toBeNull();
    expect(lifeEventOrder("one summer")).toBeNull();
    expect(sortDates(["2020", "one summer", "2019"])).toEqual(["2019", "2020", "one summer"]);
  });
});

describe("custom sections", () => {
  it("counts a section with only whitespace as empty", () => {
    expect(customSectionIsEmpty({ id: "a", title: "  ", text: "\n" })).toBe(true);
    expect(customSectionIsEmpty({ id: "b", title: "Order", text: "" })).toBe(false);
  });

  it("holds a profile that has nothing but a custom section", () => {
    expect(profileIsEmpty(profile({ custom: [{ id: "a", title: "Order", text: "Oat flat white" }] }))).toBe(
      false,
    );
    expect(profileIsEmpty(profile({ custom: [{ id: "a", title: "", text: "" }] }))).toBe(true);
  });
});

describe("the contact size caps", () => {
  it("accepts notes at the limit and reports the overflow past it", () => {
    const at = { ...emptyDraft(), name: "Jo", notes: "x".repeat(MAX_CONTACT_NOTES_CHARS) };
    expect(contactValidationError(at)).toBeNull();
    const over = { ...emptyDraft(), name: "Jo", notes: "x".repeat(MAX_CONTACT_NOTES_CHARS + 12) };
    expect(contactValidationError(over)).toContain("12");
  });

  it("passes a full profile, which is nowhere near the object ceiling", () => {
    expect(contactValidationError({ ...emptyDraft(), name: "Jo", profile: filled() })).toBeNull();
  });

  it("keeps a card with notes at the cap inside the 16 KiB padding bucket", () => {
    const draft = {
      ...emptyDraft(),
      name: "Jo Bell",
      notes: "x".repeat(MAX_CONTACT_NOTES_CHARS),
      profile: filled(),
    };
    expect(new TextEncoder().encode(serializeCard(draft)).length).toBeLessThanOrEqual(16384);
  });
});


describe("partial dates", () => {
  it("formats every precision the date field stores", () => {
    for (const value of ["2019", "2019-04", "2019-04-12"]) {
      expect(formatPartialDate(value)).not.toBe("");
    }
  });
});

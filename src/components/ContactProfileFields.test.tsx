// @vitest-environment jsdom
/**
 * The relationship sections of the contact form, mounted on their own.
 *
 * The component holds which sections are showing; the profile itself belongs to
 * the form around it. What is under test is that pairing: a section opens with
 * a row ready to type into, removing one takes its data with it, and each row
 * list reports a whole new profile rather than mutating the one it was handed.
 */

import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "../test/dom";
import {
  MAX_PROFILE_ENTRIES,
  MAX_PROFILE_TEXT_CHARS,
  emptyProfile,
} from "../lib/contactProfile";
import type { Contact, ContactProfile } from "../lib/types";
import { ContactProfileFields } from "./ContactProfileFields";

/** Stands in for the form's own state, so an edit comes back as the next render. */
function Harness({
  initial,
  contacts,
  onChange,
}: {
  initial: ContactProfile;
  contacts?: Contact[];
  onChange?: (profile: ContactProfile) => void;
}) {
  const [profile, setProfile] = useState(initial);
  return (
    <ContactProfileFields
      profile={profile}
      contacts={contacts}
      currentContactId="contact-ada"
      onChange={(next) => {
        onChange?.(next);
        setProfile(next);
      }}
    />
  );
}

function mount(initial: ContactProfile = emptyProfile(), contacts?: Contact[]) {
  const onChange = vi.fn<(profile: ContactProfile) => void>();
  render(<Harness initial={initial} contacts={contacts} onChange={onChange} />);
  /** The profile as of the last edit, which is what the form would be holding. */
  const latest = (): ContactProfile =>
    onChange.mock.calls.length === 0
      ? initial
      : onChange.mock.calls[onChange.mock.calls.length - 1]![0];
  return { onChange, latest };
}

function aContact(name: string, id: string): Contact {
  return {
    id,
    name,
    emails: [],
    phones: [],
    work: [],
    dates: [],
    socials: [],
    addresses: [],
    addressBookId: "default",
    raw: "{}",
    ciphertext: "",
    paddedSize: 0,
  };
}

/** Opens the picker and chooses a section by its label. */
function addSection(label: string) {
  fireEvent.click(screen.getByRole("button", { name: "Add section" }));
  fireEvent.click(screen.getByRole("button", { name: label }));
}

/** The `<section>` a heading names, for scoping a query to one of them. */
function sectionFor(title: string): HTMLElement {
  const heading = screen.getByRole("heading", { name: title });
  const box = heading.closest("section") ?? heading.parentElement?.parentElement;
  if (!box) throw new Error(`no section around ${title}`);
  return box as HTMLElement;
}

beforeEach(() => {
  // The flash scrolls the new section into view, which jsdom does not implement.
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
});

describe("ContactProfileFields, choosing sections", () => {
  it("starts with only the sections this contact already has", () => {
    mount({ ...emptyProfile(), howWeMet: "At a conference" });

    expect(screen.getByRole("heading", { name: "How We Met" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Pets" })).toBeNull();
  });

  it("opens a list section with one row ready to type into", () => {
    const { latest } = mount();

    addSection("Pets");

    expect(screen.getByLabelText("Pet name")).not.toBeNull();
    expect(latest().pets).toHaveLength(1);
  });

  it("opens a tag section with nothing seeded, since its own field adds rows", () => {
    const { onChange } = mount();

    addSection("Interests");

    expect(screen.getByLabelText("Interest")).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stops offering a section once it is showing", () => {
    mount();

    addSection("Pets");
    fireEvent.click(screen.getByRole("button", { name: "Add section" }));

    expect(screen.queryByRole("button", { name: "Pets" })).toBeNull();
    expect(screen.getByRole("button", { name: "Relationship History" })).not.toBeNull();
  });

  it("clears a section's data when it is removed", () => {
    const { latest } = mount({ ...emptyProfile(), howWeMet: "At a conference" });

    fireEvent.click(within(sectionFor("How We Met")).getByRole("button", { name: "Remove section" }));

    expect(screen.queryByRole("heading", { name: "How We Met" })).toBeNull();
    expect(latest().howWeMet).toBeUndefined();
  });

  it("keeps the sections in their display order, not the order they were added", () => {
    mount();

    addSection("Colleagues");
    addSection("Pets");

    const headings = screen
      .getAllByRole("heading")
      .map((heading) => heading.textContent);
    expect(headings.indexOf("Pets")).toBeLessThan(headings.indexOf("Colleagues"));
  });

  it("closes the picker on Escape", () => {
    mount();

    fireEvent.click(screen.getByRole("button", { name: "Add section" }));
    expect(screen.getByRole("button", { name: "Pets" })).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Pets" })).toBeNull();
  });

  it("adds a second custom section, unlike the fixed ones", () => {
    const { latest } = mount();

    addSection("Custom section…");
    addSection("Custom section…");

    expect(latest().custom).toHaveLength(2);
    expect(screen.getAllByLabelText("Section title")).toHaveLength(2);
  });

  it("removes one custom section without touching the other", () => {
    const { latest } = mount();
    addSection("Custom section…");
    addSection("Custom section…");
    const kept = latest().custom[1]!.id;

    const sections = screen.getAllByRole("heading", { name: "Custom Section" });
    fireEvent.click(
      within(sections[0]!.closest("section")!).getByRole("button", { name: "Remove section" }),
    );

    expect(latest().custom.map((section) => section.id)).toEqual([kept]);
  });
});

describe("ContactProfileFields, tag rows", () => {
  it("commits an interest on Enter and clears the field", () => {
    const { latest } = mount();
    addSection("Interests");

    const field = screen.getByLabelText("Interest") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Rock climbing" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(latest().interests.map((row) => row.value)).toEqual(["Rock climbing"]);
    expect(field.value).toBe("");
  });

  it("commits on a comma as well as Enter", () => {
    const { latest } = mount();
    addSection("Interests");

    const field = screen.getByLabelText("Interest");
    fireEvent.change(field, { target: { value: "Baking" } });
    fireEvent.keyDown(field, { key: "," });

    expect(latest().interests.map((row) => row.value)).toEqual(["Baking"]);
  });

  it("commits what is half typed when the field loses focus", () => {
    const { latest } = mount();
    addSection("Interests");

    const field = screen.getByLabelText("Interest");
    fireEvent.change(field, { target: { value: "Sailing" } });
    fireEvent.blur(field);

    expect(latest().interests.map((row) => row.value)).toEqual(["Sailing"]);
  });

  it("ignores an empty commit rather than adding a blank tag", () => {
    const { onChange } = mount();
    addSection("Interests");

    const field = screen.getByLabelText("Interest");
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("takes the last tag off on backspace in an empty field", () => {
    const { latest } = mount({
      ...emptyProfile(),
      interests: [
        { id: "i1", value: "Chess" },
        { id: "i2", value: "Cycling" },
      ],
    });

    fireEvent.keyDown(screen.getByLabelText("Interest"), { key: "Backspace" });

    expect(latest().interests.map((row) => row.value)).toEqual(["Chess"]);
  });

  it("removes one tag by its own chip button", () => {
    const { latest } = mount({
      ...emptyProfile(),
      interests: [
        { id: "i1", value: "Chess" },
        { id: "i2", value: "Cycling" },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove interest: Chess" }));

    expect(latest().interests.map((row) => row.value)).toEqual(["Cycling"]);
  });

  it("closes the field at the entry cap", () => {
    const interests = Array.from({ length: MAX_PROFILE_ENTRIES }, (_, index) => ({
      id: `i${index}`,
      value: `Interest ${index}`,
    }));
    mount({ ...emptyProfile(), interests });

    const field = screen.getByLabelText("Interest") as HTMLInputElement;
    expect(field.disabled).toBe(true);
    expect(field.placeholder).toBe(`Up to ${MAX_PROFILE_ENTRIES} entries`);
  });
});

describe("ContactProfileFields, food likes and dislikes", () => {
  it("files an entry under the field it was typed into", () => {
    const { latest } = mount();
    addSection("Food Likes & Dislikes");

    const likes = screen.getByLabelText("Likes");
    fireEvent.change(likes, { target: { value: "Coriander" } });
    fireEvent.keyDown(likes, { key: "Enter" });
    const dislikes = screen.getByLabelText("Dislikes");
    fireEvent.change(dislikes, { target: { value: "Oysters" } });
    fireEvent.keyDown(dislikes, { key: "Enter" });

    expect(latest().food.map((row) => [row.polarity, row.value])).toEqual([
      ["like", "Coriander"],
      ["dislike", "Oysters"],
    ]);
  });

  it("draws each entry in its own group", () => {
    mount({
      ...emptyProfile(),
      food: [
        { id: "f1", polarity: "like", value: "Coriander" },
        { id: "f2", polarity: "dislike", value: "Oysters" },
      ],
    });

    expect(screen.getByRole("button", { name: "Remove likes: Coriander" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Remove dislikes: Oysters" })).not.toBeNull();
  });
});

describe("ContactProfileFields, multi-row sections", () => {
  it("adds a further row from the section's own pill", () => {
    const { latest } = mount();
    addSection("Pets");

    fireEvent.click(within(sectionFor("Pets")).getByRole("button", { name: "Add pet" }));

    expect(latest().pets).toHaveLength(2);
    expect(screen.getAllByLabelText("Pet name")).toHaveLength(2);
  });

  it("holds the add pill at the entry cap", () => {
    const pets = Array.from({ length: MAX_PROFILE_ENTRIES }, (_, index) => ({
      id: `p${index}`,
      name: `Pet ${index}`,
    }));
    mount({ ...emptyProfile(), pets });

    const add = within(sectionFor("Pets")).getByRole("button", { name: "Add pet" });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    expect(add.getAttribute("title")).toBe(`Up to ${MAX_PROFILE_ENTRIES} entries`);
  });

  it("edits one row without disturbing its neighbour", () => {
    const { latest } = mount({
      ...emptyProfile(),
      pets: [
        { id: "p1", name: "Ada" },
        { id: "p2", name: "Byron" },
      ],
    });

    fireEvent.change(screen.getAllByLabelText("Pet species")[1]!, {
      target: { value: "Tortoise" },
    });

    expect(latest().pets).toEqual([
      { id: "p1", name: "Ada" },
      { id: "p2", name: "Byron", species: "Tortoise" },
    ]);
  });

  it("removes one row by its own button", () => {
    const { latest } = mount({
      ...emptyProfile(),
      pets: [
        { id: "p1", name: "Ada" },
        { id: "p2", name: "Byron" },
      ],
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Remove pet" })[0]!);

    expect(latest().pets.map((row) => row.id)).toEqual(["p2"]);
  });

  it("drops the end date when a relationship is marked current", () => {
    const { latest } = mount({
      ...emptyProfile(),
      relationships: [{ id: "r1", name: "Grace", kind: "Partner", end: "2024-01" }],
    });

    fireEvent.click(screen.getByRole("checkbox"));

    expect(latest().relationships[0]!.current).toBe(true);
    expect(latest().relationships[0]!.end).toBeUndefined();
  });

  it("hides the finish date for a current relationship", () => {
    mount({
      ...emptyProfile(),
      relationships: [{ id: "r1", name: "Grace", kind: "Partner", current: true }],
    });

    const box = sectionFor("Relationship History");
    expect(within(box).queryByText("Date finished")).toBeNull();
    expect(within(box).getByText("Date started")).not.toBeNull();
  });

  it("clears the finish date when a relationship is marked current", () => {
    const { latest } = mount({
      ...emptyProfile(),
      relationships: [{ id: "r1", name: "Grace", kind: "Partner", start: "2015", end: "2019" }],
    });

    const box = sectionFor("Relationship History");
    expect(within(box).getByText("Date finished")).not.toBeNull();
    fireEvent.click(within(box).getByRole("checkbox", { name: "Current partner" }));

    expect(latest().relationships[0]).toMatchObject({ start: "2015", current: true });
    expect(latest().relationships[0]?.end).toBeUndefined();
  });

  it("no longer offers Career History, which lives under Workplace", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Add section" }));

    expect(screen.queryByRole("button", { name: "Career History" })).toBeNull();
  });
});

describe("ContactProfileFields, long text", () => {
  it("says nothing about the length until the field is nearly full", () => {
    mount({ ...emptyProfile(), howWeMet: "At a conference" });

    expect(screen.queryByText(new RegExp(`/ ${MAX_PROFILE_TEXT_CHARS.toLocaleString()}`))).toBeNull();
  });

  it("counts up as the field fills, and flags going over", () => {
    const nearly = "x".repeat(Math.round(MAX_PROFILE_TEXT_CHARS * 0.9));
    mount({ ...emptyProfile(), howWeMet: nearly });

    const counter = screen.getByText(
      `${nearly.length.toLocaleString()} / ${MAX_PROFILE_TEXT_CHARS.toLocaleString()}`,
    );
    expect(counter.className).toContain("text-mute");

    fireEvent.change(screen.getByPlaceholderText(/Where you met/), {
      target: { value: "x".repeat(MAX_PROFILE_TEXT_CHARS + 1) },
    });
    expect(
      screen.getByText(
        `${(MAX_PROFILE_TEXT_CHARS + 1).toLocaleString()} / ${MAX_PROFILE_TEXT_CHARS.toLocaleString()}`,
      ).className,
    ).toContain("text-danger");
  });
});

describe("ContactProfileFields, linking another contact", () => {
  it("offers the link only where the form was given the vault's contacts", () => {
    mount();
    addSection("Family");

    expect(screen.queryByRole("button", { name: "Link a contact" })).toBeNull();
  });

  it("links a contact into the section it was asked from", () => {
    const { latest } = mount(emptyProfile(), [
      aContact("Ada Lovelace", "contact-ada"),
      aContact("Grace Hopper", "contact-grace"),
    ]);
    addSection("Family");

    fireEvent.click(screen.getByRole("button", { name: "Link a contact" }));
    fireEvent.click(screen.getByText("Grace Hopper"));

    expect(latest().family.map((row) => [row.name, row.contactId])).toEqual([
      ["", undefined],
      ["Grace Hopper", "contact-grace"],
    ]);
  });
});

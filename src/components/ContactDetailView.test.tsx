// @vitest-environment jsdom
/**
 * The contact detail pane, mounted on its own.
 *
 * Under test: the reach-them values share one section, sections with nothing
 * in them are left out, every person row carries an avatar whether or not it
 * is linked, and editing swaps the header's actions for Save and Cancel.
 */

import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "../test/dom";
import { emptyProfile } from "../lib/contactProfile";
import type { Session } from "../lib/client";
import type { Contact } from "../lib/types";
import { ContactDetailModal } from "./ContactDetailModal";

function aContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: "c1",
    name: "Amelia Hughes",
    emails: [{ id: "e1", kind: "home", value: "amelia@example.co.uk" }],
    phones: [{ id: "p1", kind: "mobile", value: "07700 900101" }],
    work: [],
    dates: [],
    socials: [{ id: "s1", platform: "Instagram", handle: "amelia.hughes" }],
    addresses: [],
    addressBookId: "default",
    raw: "{}",
    ciphertext: "",
    paddedSize: 0,
    ...overrides,
  };
}

function mount(contact: Contact, { editing = false, detailed = false } = {}) {
  render(
    <ContactDetailModal
      session={{} as Session}
      contact={contact}
      addressBooks={[]}
      busy={false}
      editing={editing}
      onEditingChange={vi.fn<(editing: boolean) => void>()}
      onSave={vi.fn<() => boolean>().mockReturnValue(true)}
      onClose={vi.fn<() => void>()}
      detailed={detailed}
      contacts={[contact]}
    />,
  );
}

function headings(): string[] {
  return screen.queryAllByRole("heading", { level: 4 }).map((h) => h.textContent ?? "");
}

function sectionOf(title: string): HTMLElement {
  const section = screen.getByRole("heading", { name: title, level: 4 }).closest("section");
  if (!section) throw new Error(`no section for ${title}`);
  return section as HTMLElement;
}

describe("the contact detail pane", () => {
  it("lists emails, phones and socials together under Contact", () => {
    mount(aContact());

    const contact = sectionOf("Contact");
    expect(contact.textContent).toContain("amelia@example.co.uk");
    expect(contact.textContent).toContain("07700 900101");
    expect(contact.textContent).toContain("amelia.hughes");
    expect(headings()).not.toContain("Emails");
    expect(headings()).not.toContain("Phones");
  });

  it("leaves out the sections a contact has nothing in", () => {
    mount(aContact({ socials: [], phones: [] }));

    expect(headings()).toEqual(["Contact", "Photos & Attachments"]);
  });

  it("gives an unlinked person an avatar as well as a linked one", () => {
    const linked = aContact({ id: "c2", name: "Jack Thompson" });
    const contact = aContact({
      profile: {
        ...emptyProfile(),
        family: [
          { id: "f1", name: "Brian", relation: "Father" },
          { id: "f2", name: "Jack Thompson", contactId: "c2" },
        ],
      },
    });
    render(
      <ContactDetailModal
        session={{} as Session}
        contact={contact}
        addressBooks={[]}
        busy={false}
        editing={false}
        onEditingChange={vi.fn<(editing: boolean) => void>()}
        onSave={vi.fn<() => boolean>().mockReturnValue(true)}
        onClose={vi.fn<() => void>()}
        detailed
        contacts={[contact, linked]}
      />,
    );

    const family = sectionOf("Family");
    expect(within(family).getByText("B")).toBeDefined();
    expect(within(family).getByText("JT")).toBeDefined();
    expect(within(family).getByText("Father")).toBeDefined();
  });

  it("shows a current relationship as running to the present, with no badge", () => {
    mount(
      aContact({
        profile: {
          ...emptyProfile(),
          relationships: [
            { id: "r1", name: "Billy", kind: "Partner", current: true },
            { id: "r2", name: "Sam", kind: "Partner", start: "2019", end: "2021", current: true },
            { id: "r3", name: "Edward", kind: "Ex-spouse", start: "2023-02", end: "2024" },
          ],
        },
      }),
      { detailed: true },
    );

    const section = sectionOf("Relationship History");
    expect(within(section).getByText("Current")).toBeDefined();
    expect(section.textContent).toContain("2019 - Present");
    expect(section.textContent).not.toContain("2021");
    expect(section.textContent).toContain("2024");
    expect(within(section).getAllByText(/current/i)).toHaveLength(1);
  });

  it("lists workplaces under Workplace, with dates and history only for detailed contacts", () => {
    const contact = aContact({
      work: [
        { id: "w1", organization: "Analytical Engines", title: "Programmer", start: "2018", current: true },
        { id: "w2", organization: "Royal Society", start: "2010", end: "2015" },
      ],
    });

    mount(contact);
    let workplace = sectionOf("Workplace");
    expect(workplace.textContent).toContain("Analytical Engines");
    expect(workplace.textContent).not.toContain("Royal Society");
    expect(workplace.textContent).not.toContain("2018");
    expect(headings()).not.toContain("Details");
    cleanup();

    mount(contact, { detailed: true });
    workplace = sectionOf("Workplace");
    expect(workplace.textContent).toContain("Royal Society");
    expect(workplace.textContent).toContain("2018 - Present");
    expect(workplace.textContent).toContain("2010 - 2015");
    expect(within(workplace).getByText("Current")).toBeDefined();
  });

  it("dates addresses and lists former ones only for detailed contacts", () => {
    const contact = aContact({
      addresses: [
        { id: "a1", kind: "home", locality: "Leeds", start: "2010", end: "2015" },
        { id: "a2", kind: "home", locality: "London", start: "2018", current: true },
      ],
    });

    mount(contact);
    let section = sectionOf("Address");
    expect(section.textContent).toContain("London");
    expect(section.textContent).not.toContain("Leeds");
    cleanup();

    mount(contact, { detailed: true });
    section = sectionOf("Addresses");
    expect(section.textContent).toContain("2018 - Present");
    expect(section.textContent).toContain("2010 - 2015");
    expect(section.textContent!.indexOf("London")).toBeLessThan(section.textContent!.indexOf("Leeds"));
  });

  it("swaps the header actions for Save and Cancel while editing", () => {
    mount(aContact(), { editing: true });

    expect(screen.getByRole("button", { name: "Save" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Close contact details" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit contact" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete contact" })).toBeNull();
  });
});

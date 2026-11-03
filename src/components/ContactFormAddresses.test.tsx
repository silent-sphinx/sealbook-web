// @vitest-environment jsdom
/**
 * The address list of the contact form, mounted with the form around it.
 *
 * A card holds any number of addresses, each with a kind. Under test: a stored
 * card opens with every address it has, a new one can be added and labelled,
 * removing one leaves the rest, and the draft the form submits carries them in
 * the order shown.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "../test/dom";
import { parseContact } from "../lib/contact";
import type { ContactDraft } from "../lib/types";
import { ContactForm } from "./ContactForm";

const STORED = JSON.stringify({
  "@type": "Card",
  version: "1.0",
  name: { full: "Ada" },
  addresses: {
    a1: { locality: "London", contexts: { private: true } },
    a2: { locality: "Leeds", contexts: { work: true } },
  },
});

const DATED = JSON.stringify({
  "@type": "Card",
  version: "1.0",
  name: { full: "Ada" },
  addresses: {
    a1: { locality: "London", "sealbook:start": "2018-04", "sealbook:current": true },
    a2: { locality: "Leeds", "sealbook:start": "2010", "sealbook:end": "2015-06-12" },
  },
});

function mount(initialDraft?: ContactDraft, detailed = false) {
  const onSubmit = vi.fn<(draft: ContactDraft) => void>();
  render(
    <ContactForm
      busy={false}
      addressBooks={[]}
      initialDraft={initialDraft}
      detailed={detailed}
      onSubmit={onSubmit}
      onCancel={() => {}}
    />,
  );
  const submit = () => fireEvent.click(screen.getByRole("button", { name: initialDraft ? "Save" : "Add" }));
  return { onSubmit, submit };
}

function groups() {
  return screen.queryAllByRole("group", { name: /address$/ });
}

describe("the contact form's addresses", () => {
  it("opens a stored card with every address it has, each under its kind", () => {
    mount(parseContact("c1", STORED, "", 0));
    expect(groups().map((group) => group.getAttribute("aria-label"))).toEqual([
      "Home address",
      "Work address",
    ]);
    const cities = screen.getAllByLabelText("City / town") as HTMLInputElement[];
    expect(cities.map((input) => input.value)).toEqual(["London", "Leeds"]);
  });

  it("adds a labelled address after the others and submits all of them in order", () => {
    const { onSubmit, submit } = mount(parseContact("c1", STORED, "", 0));
    fireEvent.click(screen.getByRole("button", { name: "Add address" }));
    const added = groups()[2];
    fireEvent.change(within(added).getByLabelText("Address type"), {
      target: { value: "custom" },
    });
    fireEvent.change(within(added).getByLabelText("Custom address label"), {
      target: { value: "Cabin" },
    });
    fireEvent.change(within(added).getByLabelText("City / town"), {
      target: { value: "Bergen" },
    });
    submit();
    const draft = onSubmit.mock.calls[0][0];
    expect(draft.addresses.map((a) => [a.kind, a.label, a.locality])).toEqual([
      ["home", undefined, "London"],
      ["work", undefined, "Leeds"],
      ["custom", "Cabin", "Bergen"],
    ]);
  });

  it("removes only the address whose button was pressed", () => {
    const { onSubmit, submit } = mount(parseContact("c1", STORED, "", 0));
    fireEvent.click(within(groups()[0]).getByRole("button", { name: "Remove address" }));
    submit();
    expect(onSubmit.mock.calls[0][0].addresses.map((a) => a.locality)).toEqual(["Leeds"]);
  });

  it("starts a new card with no address, and the first one added is a home one", () => {
    mount();
    expect(groups()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Add address" }));
    expect(groups()[0].getAttribute("aria-label")).toBe("Home address");
  });

  it("shows only the addresses they live at, with no dates, without detailed contacts", () => {
    const { onSubmit, submit } = mount(parseContact("c1", DATED, "", 0));
    const cities = screen.getAllByLabelText("City / town") as HTMLInputElement[];
    expect(cities.map((input) => input.value)).toEqual(["London"]);
    expect(screen.queryByRole("group", { name: "Date moved in" })).toBeNull();
    submit();
    expect(onSubmit.mock.calls[0][0].addresses.map((a) => a.locality)).toEqual(["London", "Leeds"]);
  });

  it("dates every address with detailed contacts, and a current one has no departure", () => {
    mount(parseContact("c1", DATED, "", 0), true);
    const [london, leeds] = groups();
    expect(within(london).getByRole("checkbox", { name: "Current address" })).toHaveProperty("checked", true);
    expect(within(london).queryByRole("group", { name: "Date departed" })).toBeNull();
    expect((within(london).getByLabelText("Date moved in month") as HTMLSelectElement).value).toBe("04");
    expect((within(leeds).getByLabelText("Date departed day") as HTMLSelectElement).value).toBe("12");
  });

  it("clears the departure date when an address is marked current", () => {
    const { onSubmit, submit } = mount(parseContact("c1", DATED, "", 0), true);
    fireEvent.click(within(groups()[1]).getByRole("checkbox", { name: "Current address" }));
    expect(within(groups()[1]).queryByRole("group", { name: "Date departed" })).toBeNull();
    submit();
    expect(onSubmit.mock.calls[0][0].addresses[1]).toMatchObject({
      locality: "Leeds",
      start: "2010",
      current: true,
      end: undefined,
    });
  });
});

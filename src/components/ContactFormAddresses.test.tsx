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

function mount(initialDraft?: ContactDraft) {
  const onSubmit = vi.fn<(draft: ContactDraft) => void>();
  render(
    <ContactForm
      busy={false}
      addressBooks={[]}
      initialDraft={initialDraft}
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
    fireEvent.click(screen.getByRole("button", { name: "Address" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Address" }));
    expect(groups()[0].getAttribute("aria-label")).toBe("Home address");
  });
});

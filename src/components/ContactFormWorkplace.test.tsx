// @vitest-environment jsdom
/**
 * The Workplace section of the contact form, mounted with the form around it.
 *
 * Under test: dates show only with detailed contacts, a finished workplace is
 * kept but not shown without them, ticking Current hides and clears the finish
 * date, and a card whose jobs were in the profile's career history opens with
 * them under Workplace and saves them there.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "../test/dom";
import { parseContact } from "../lib/contact";
import type { ContactDraft } from "../lib/types";
import { ContactForm } from "./ContactForm";

const STORED = JSON.stringify({
  "@type": "Card",
  version: "1.0",
  name: { full: "Ada" },
  organizations: {
    o1: { name: "Analytical Engines", "sealbook:start": "2018", "sealbook:current": true },
    o2: { name: "Royal Society", "sealbook:start": "2010", "sealbook:end": "2015" },
  },
});

const LEGACY = JSON.stringify({
  "@type": "Card",
  version: "1.0",
  name: { full: "Ada" },
  organizations: { o1: { name: "Analytical Engines" } },
  "sealbook:profile": {
    "@type": "SealbookProfile",
    version: "1.0",
    career: [{ organization: "Royal Society", title: "Fellow", start: "2010", end: "2015" }],
  },
});

function mount(raw: string, detailed: boolean) {
  const onSubmit = vi.fn<(draft: ContactDraft) => void>();
  render(
    <ContactForm
      busy={false}
      addressBooks={[]}
      initialDraft={parseContact("c1", raw, "", 0)}
      detailed={detailed}
      onSubmit={onSubmit}
      onCancel={() => {}}
    />,
  );
  const submit = () => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    return onSubmit.mock.calls[0]![0];
  };
  return { submit };
}

function workplaces(): string[] {
  return (screen.queryAllByLabelText("Workplace") as HTMLInputElement[]).map((input) => input.value);
}

describe("the contact form's workplaces", () => {
  it("shows only ongoing workplaces and no dates without detailed contacts, and keeps the rest", () => {
    const { submit } = mount(STORED, false);

    expect(workplaces()).toEqual(["Analytical Engines"]);
    expect(screen.queryByText("Date started")).toBeNull();
    expect(submit().work.map((w) => w.organization)).toEqual(["Analytical Engines", "Royal Society"]);
  });

  it("shows every workplace with its dates with detailed contacts", () => {
    mount(STORED, true);

    expect(workplaces()).toEqual(["Analytical Engines", "Royal Society"]);
    expect(screen.getAllByText("Date started")).toHaveLength(2);
    expect(screen.getAllByText("Date finished")).toHaveLength(1);
  });

  it("hides and clears the finish date when a workplace is marked current", () => {
    const { submit } = mount(STORED, true);

    fireEvent.click(screen.getAllByRole("checkbox", { name: "Current workplace" })[1]!);

    expect(screen.queryByText("Date finished")).toBeNull();
    expect(submit().work[1]).toMatchObject({ organization: "Royal Society", current: true, end: undefined });
  });

  it("opens career history from an older card under Workplace, and saves it there", () => {
    const { submit } = mount(LEGACY, true);

    expect(workplaces()).toEqual(["Analytical Engines", "Royal Society"]);
    expect(screen.queryByRole("heading", { name: "Career History" })).toBeNull();
    const draft = submit();
    expect(draft.work[1]).toMatchObject({ organization: "Royal Society", title: "Fellow", start: "2010", end: "2015" });
    expect(draft.profile?.career ?? []).toEqual([]);
  });
});

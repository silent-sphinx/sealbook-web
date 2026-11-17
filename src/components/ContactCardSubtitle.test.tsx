// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ContactCard } from "./ContactCard";
import { aContact } from "../test/vault";

const work = [{ id: "w1", organization: "Analytical Engine", title: "" }];
const phones = [{ id: "p1", kind: "mobile" as const, value: "+44 7700 900000" }];

function show(overrides: Record<string, unknown>) {
  render(
    <ul>
      <ContactCard contact={{ ...aContact("Ada"), email: "", phones: [], work: [], ...overrides }} />
    </ul>,
  );
}

describe("ContactCard sub-line", () => {
  it("prefers the phone number over email and workplace", () => {
    show({ phones, email: "ada@example.com", work });
    expect(screen.getByText("+44 7700 900000")).toBeTruthy();
    expect(screen.queryByText("ada@example.com")).toBeNull();
  });

  it("falls back to email, then workplace", () => {
    show({ email: "ada@example.com", work });
    expect(screen.getByText("ada@example.com")).toBeTruthy();
  });

  it("shows the workplace when nothing else is set", () => {
    show({ work });
    expect(screen.getByText("Analytical Engine")).toBeTruthy();
  });
});

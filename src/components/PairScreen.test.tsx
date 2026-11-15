// @vitest-environment jsdom
/**
 * The joining device's screen, mounted on its own.
 *
 * The code and its QR come from `App`, which holds the pairing. What is under
 * test is what the user is shown: the eight words and the same code as a QR,
 * nothing to compare by eye, and the password form only once approved.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "../test/dom";
import { PairScreen } from "./PairScreen";

const CODE = "abandon ability able about above absent absorb abstract";

type Props = Parameters<typeof PairScreen>[0];

function mount(overrides: Partial<Props> = {}) {
  render(
    <PairScreen
      connectionDomain="vault.example.com"
      saveDomain={() => true}
      error={null}
      pairCode={CODE}
      pairQrText={`SEALBOOK-PAIR:${CODE.toUpperCase()}`}
      pairApproved={false}
      password=""
      busy={false}
      copied={false}
      onPasswordChange={vi.fn<(value: string) => void>()}
      onCopied={vi.fn<(value: boolean) => void>()}
      onSubmit={vi.fn<(event: { preventDefault: () => void }) => void>()}
      onBack={vi.fn<() => void>()}
      onGoToRecover={vi.fn<() => void>()}
      {...overrides}
    />,
  );
}

describe("PairScreen", () => {
  it("shows the eight words and the same code as a QR", () => {
    mount();

    for (const word of CODE.split(" ")) {
      expect(screen.getByText(word)).not.toBeNull();
    }
    const qr = screen.getByRole("img", { name: "Pairing code as a QR code" });
    expect(qr.querySelector("path")?.getAttribute("d")).toMatch(/^M\d+ \d+h1v1h-1z/u);
  });

  it("has no code to compare by eye", () => {
    mount();

    expect(screen.queryByText(/confirmation code/iu)).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/Waiting for approval/u);
  });

  it("asks for the password only once the pairing is approved", () => {
    mount({ pairApproved: true });

    expect(screen.getByLabelText("Password")).not.toBeNull();
  });
});

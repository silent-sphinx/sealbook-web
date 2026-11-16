// @vitest-environment jsdom
/**
 * The fields that hold a secret in the clear must opt out of spellcheck and
 * keyboard learning, including while the password toggle shows the text.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "../test/dom";
import { PasswordField } from "./PasswordField";
import { RecoverScreen } from "./RecoverScreen";

describe("secret fields", () => {
  it("keeps the recovery words out of spellcheck and writing assistants", () => {
    render(
      <RecoverScreen
        connectionDomain="vault.example.com"
        saveDomain={() => true}
        error={null}
        username=""
        phrase=""
        password=""
        busy={false}
        onUsernameChange={vi.fn()}
        onPhraseChange={vi.fn()}
        onPasswordChange={vi.fn()}
        onSubmit={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    const words = document.getElementById("recovery-phrase") as HTMLTextAreaElement;
    expect(words.getAttribute("spellcheck")).toBe("false");
    expect(words.getAttribute("autocomplete")).toBe("off");
    expect(words.getAttribute("autocorrect")).toBe("off");
    expect(words.getAttribute("autocapitalize")).toBe("none");
    expect(words.getAttribute("data-gramm")).toBe("false");
    expect(words.getAttribute("data-enable-grammarly")).toBe("false");
  });

  it("keeps a revealed password out of spellcheck", () => {
    render(<PasswordField aria-label="Password" />);
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    const input = screen.getByLabelText("Password") as HTMLInputElement;
    expect(input.type).toBe("text");
    expect(input.getAttribute("spellcheck")).toBe("false");
    expect(input.getAttribute("autocorrect")).toBe("off");
    expect(input.getAttribute("autocapitalize")).toBe("none");
  });
});

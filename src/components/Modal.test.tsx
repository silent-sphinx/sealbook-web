// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "../test/dom";
import { Modal } from "./Modal";

const noop = () => {};

describe("Modal", () => {
  it("labels each dialog with its own title", () => {
    render(
      <>
        <Modal title="Outer" onClose={noop}>
          outer
        </Modal>
        <Modal title="Inner" onClose={noop}>
          inner
        </Modal>
      </>,
    );

    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs).toHaveLength(2);
    for (const dialog of dialogs) {
      expect(dialog.getAttribute("aria-modal")).toBe("true");
    }

    const labels = dialogs.map((dialog) => {
      const id = dialog.getAttribute("aria-labelledby");
      return id === null ? null : document.getElementById(id)?.textContent;
    });
    expect(labels).toEqual(["Outer", "Inner"]);
    // Stacked dialogs rendering the same id would point both at one heading.
    expect(new Set(dialogs.map((dialog) => dialog.getAttribute("aria-labelledby"))).size).toBe(2);
  });

  it("locks the page while open and restores the previous overflow", () => {
    document.body.style.overflow = "auto";
    const view = render(
      <Modal title="Settings" onClose={noop}>
        body
      </Modal>,
    );
    expect(document.body.style.overflow).toBe("hidden");

    // Restored to what it was, not cleared: the page behind may have been
    // scroll-locked for its own reasons.
    view.unmount();
    expect(document.body.style.overflow).toBe("auto");
  });

  it("puts the caret on the panel so the dialog is announced", () => {
    render(
      <Modal title="Settings" onClose={noop}>
        <p>body</p>
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("leaves the caret where the dialog's own content put it", () => {
    render(
      <Modal title="Settings" onClose={noop}>
        <input aria-label="first" />
        <input aria-label="second" autoFocus />
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("second"));
  });

  it("returns focus to whatever opened it", () => {
    render(
      <button type="button">
        opener
      </button>,
    );
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();

    const view = render(
      <Modal title="Settings" onClose={noop}>
        body
      </Modal>,
    );
    expect(document.activeElement).not.toBe(opener);

    // Without this the caret lands on <body> and the next Tab restarts from the
    // top of the page.
    view.unmount();
    expect(document.activeElement).toBe(opener);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Modal title="Settings" onClose={onClose}>
        body
      </Modal>,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses only the topmost of two stacked dialogs", () => {
    const onCloseOuter = vi.fn();
    const onCloseInner = vi.fn();
    render(
      <>
        <Modal title="Form" onClose={onCloseOuter}>
          form
        </Modal>
        <Modal title="Confirm" onClose={onCloseInner}>
          confirm
        </Modal>
      </>,
    );

    // A confirm stacked on a form must not take the form down with it.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCloseInner).toHaveBeenCalledTimes(1);
    expect(onCloseOuter).not.toHaveBeenCalled();
  });

  it("closes from the header button", () => {
    const onClose = vi.fn();
    render(
      <Modal title="Settings" onClose={onClose}>
        body
      </Modal>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a click on the backdrop but not on one inside the panel", () => {
    const onClose = vi.fn();
    render(
      <Modal title="Settings" onClose={onClose}>
        <p>body</p>
      </Modal>,
    );

    fireEvent.click(screen.getByText("body"));
    expect(onClose).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog.parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("wraps Tab from the last focusable back to the first", () => {
    render(
      <Modal title="Settings" onClose={noop}>
        <input aria-label="first" />
        <input aria-label="last" />
      </Modal>,
    );

    screen.getByLabelText("last").focus();
    fireEvent.keyDown(window, { key: "Tab" });
    // The header's close button precedes the content in DOM order, so it is the
    // first focusable in the panel.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
  });

  it("wraps shift+Tab from the first focusable to the last", () => {
    render(
      <Modal title="Settings" onClose={noop}>
        <input aria-label="first" />
        <input aria-label="last" />
      </Modal>,
    );

    screen.getByRole("button", { name: "Close" }).focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByLabelText("last"));
  });

  it("wraps shift+Tab off the panel itself to the last focusable", () => {
    render(
      <Modal title="Settings" onClose={noop}>
        <input aria-label="only" />
      </Modal>,
    );

    // The panel holds the caret until the user tabs, so the first shift+Tab
    // comes from the panel rather than from a control.
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByLabelText("only"));
  });
});

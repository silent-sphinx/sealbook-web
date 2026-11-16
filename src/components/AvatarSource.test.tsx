// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import "../test/dom";
import { Avatar } from "./ContactCard";
import { safeImageSrc } from "../lib/image";

describe("safeImageSrc", () => {
  it("passes an inline image and a blob", () => {
    expect(safeImageSrc("data:image/webp;base64,AAAA")).toBe("data:image/webp;base64,AAAA");
    expect(safeImageSrc("DATA:IMAGE/PNG;base64,AAAA")).toBeDefined();
    expect(safeImageSrc("blob:https://app.example/1234")).toBeDefined();
  });

  it("refuses anything that would be fetched or is not an image", () => {
    for (const value of [
      "https://tracker.example/p.png",
      "http://tracker.example/p.png",
      "//tracker.example/p.png",
      "/relative.png",
      "data:text/html;base64,AAAA",
      "javascript:alert(1)",
      "",
      undefined,
      null,
    ]) {
      expect(safeImageSrc(value)).toBeUndefined();
    }
  });
});

describe("Avatar", () => {
  it("draws no <img> for a remote URL a vault carries, and shows initials instead", () => {
    const { container } = render(<Avatar name="Ada Lovelace" avatar="https://tracker.example/p.png" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("AL");
  });

  it("draws an inline image", () => {
    const { container } = render(<Avatar name="Ada Lovelace" avatar="data:image/webp;base64,AAAA" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/webp;base64,AAAA");
  });
});

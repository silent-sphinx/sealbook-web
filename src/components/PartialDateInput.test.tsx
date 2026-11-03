// @vitest-environment jsdom
/**
 * The partial date field: day, month and year parts joined into an ISO
 * `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, with nothing stored until the year is
 * complete.
 */
import "../test/dom";

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { PartialDateInput } from "./PartialDateInput";

function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <PartialDateInput label="When" value={value} onChange={setValue} />
      <output data-testid="value">{value}</output>
    </>
  );
}

const shown = () => screen.getByTestId("value").textContent;
const year = () => screen.getByLabelText("When year") as HTMLInputElement;
const month = () => screen.getByLabelText("When month") as HTMLSelectElement;
const day = () => screen.getByLabelText("When day") as HTMLSelectElement;

describe("the partial date field", () => {
  it("stores a year alone, then a month, then a day", () => {
    render(<Harness />);
    fireEvent.change(year(), { target: { value: "2021" } });
    expect(shown()).toBe("2021");
    fireEvent.change(month(), { target: { value: "03" } });
    expect(shown()).toBe("2021-03");
    fireEvent.change(day(), { target: { value: "09" } });
    expect(shown()).toBe("2021-03-09");
  });

  it("lets the year be typed a digit at a time without resetting", () => {
    render(<Harness />);
    for (const partial of ["2", "20", "202", "2021"]) {
      fireEvent.change(year(), { target: { value: partial } });
      expect(year().value).toBe(partial);
    }
    expect(shown()).toBe("2021");
  });

  it("keeps a month chosen before the year is typed", () => {
    render(<Harness />);
    fireEvent.change(month(), { target: { value: "09" } });
    expect(shown()).toBe("");
    fireEvent.change(year(), { target: { value: "2020" } });
    expect(shown()).toBe("2020-09");
  });

  it("offers a day only once a month is chosen, and drops it with the month", () => {
    render(<Harness initial="2019-06-12" />);
    expect(day().value).toBe("12");
    fireEvent.change(month(), { target: { value: "" } });
    expect(shown()).toBe("2019");
    expect(day().disabled).toBe(true);
  });

  it("drops a day the new month does not have", () => {
    render(<Harness initial="2023-01-31" />);
    fireEvent.change(month(), { target: { value: "02" } });
    expect(shown()).toBe("2023-02");
  });

  it("clears the value when the year is emptied", () => {
    render(<Harness initial="2019-06" />);
    fireEvent.change(year(), { target: { value: "" } });
    expect(shown()).toBe("");
  });

  it("accepts a year before 1900, which a bounded number field would refuse", () => {
    render(<Harness />);
    fireEvent.change(year(), { target: { value: "1843" } });
    expect(shown()).toBe("1843");
  });

  it("shows a value that is not an ISO date as text", () => {
    render(<Harness initial="the summer of 2019" />);
    expect((screen.getByRole("textbox", { name: "When" }) as HTMLInputElement).value).toBe("the summer of 2019");
  });
});

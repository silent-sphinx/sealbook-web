// @vitest-environment jsdom
/**
 * The month branch is a select plus a year, not `<input type="month">`, so a
 * month/year is stored as an ISO `YYYY-MM` on every browser rather than as
 * whatever text a native-less month box would keep.
 */
import "../test/dom";

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { PartialDateInput } from "./PartialDateInput";
import type { DatePrecision } from "../lib/contactProfile";

function Harness({ initial = "", precision }: { initial?: string; precision?: DatePrecision }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <PartialDateInput label="When" value={value} defaultPrecision={precision} onChange={setValue} />
      <output data-testid="value">{value}</output>
    </>
  );
}

const shown = () => screen.getByTestId("value").textContent;

describe("the month picker", () => {
  it("joins a selected month and a typed year into an ISO value", () => {
    render(<Harness precision="month" />);
    fireEvent.change(screen.getByLabelText("When year"), { target: { value: "2021" } });
    expect(shown()).toBe("2021-01");
    fireEvent.change(screen.getByLabelText("When month"), { target: { value: "03" } });
    expect(shown()).toBe("2021-03");
  });

  it("lets the year be typed a digit at a time without resetting", () => {
    render(<Harness precision="month" />);
    const year = screen.getByLabelText("When year") as HTMLInputElement;
    for (const partial of ["2", "20", "202", "2021"]) {
      fireEvent.change(year, { target: { value: partial } });
      // The input keeps what has been typed rather than snapping back to empty.
      expect((screen.getByLabelText("When year") as HTMLInputElement).value).toBe(partial);
    }
    expect(shown()).toBe("2021-01");
  });

  it("keeps a month chosen before the year is typed", () => {
    render(<Harness precision="month" />);
    fireEvent.change(screen.getByLabelText("When month"), { target: { value: "09" } });
    // No year yet, so nothing is stored, but the choice is not lost.
    expect(shown()).toBe("");
    fireEvent.change(screen.getByLabelText("When year"), { target: { value: "2020" } });
    expect(shown()).toBe("2020-09");
  });

  it("clears the value when the year is emptied, since a month needs one", () => {
    render(<Harness initial="2019-06" precision="month" />);
    expect((screen.getByLabelText("When month") as HTMLSelectElement).value).toBe("06");
    fireEvent.change(screen.getByLabelText("When year"), { target: { value: "" } });
    expect(shown()).toBe("");
  });
});

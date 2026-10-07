import { describe, expect, it } from "vitest";

import { normalizeFeatures, withContactMode, withFeature } from "./accountSettings";
import { DEFAULT_ADDRESS_BOOK_NAME } from "./addressBook";
import { DEFAULT_NOTEBOOK_NAME } from "./note";
import {
  SUGGESTED_CALENDAR_NAME,
  initialOnboardingDraft,
  nextOnboardingStep,
  onboardingPlan,
  onboardingSteps,
  plannedContainerCount,
  previousOnboardingStep,
} from "./onboarding";

const allOn = normalizeFeatures({ contacts: true, calendar: true, notes: true });

describe("onboarding steps", () => {
  it("opens on the welcome and ends on the client recommendations", () => {
    const steps = onboardingSteps(allOn);
    expect(steps[0]).toBe("welcome");
    expect(steps[steps.length - 1]).toBe("clients");
  });

  it("drops the contact detail step when contacts is turned off", () => {
    const steps = onboardingSteps(withFeature(allOn, "contacts", false));
    expect(steps).not.toContain("contacts");
    expect(steps).toContain("containers");
  });

  it("walks forwards and backwards and stops at the ends", () => {
    const steps = onboardingSteps(allOn);
    expect(nextOnboardingStep(steps, "welcome")).toBe("features");
    expect(previousOnboardingStep(steps, "features")).toBe("welcome");
    expect(previousOnboardingStep(steps, "welcome")).toBeNull();
    expect(nextOnboardingStep(steps, "clients")).toBeNull();
  });

  it("skips the step a feature toggle removed rather than stranding the wizard", () => {
    const steps = onboardingSteps(withFeature(allOn, "contacts", false));
    expect(nextOnboardingStep(steps, "features")).toBe("containers");
  });
});

describe("onboarding plan", () => {
  it("suggests a calendar, since a new account has none", () => {
    const plan = onboardingPlan(initialOnboardingDraft());
    expect(plan.calendars).toEqual([SUGGESTED_CALENDAR_NAME]);
    expect(plan.addressBooks).toEqual([]);
    expect(plan.notebooks).toEqual([]);
  });

  it("trims names and drops the rows left blank", () => {
    const plan = onboardingPlan({
      ...initialOnboardingDraft(),
      addressBooks: ["  Family  ", "", "   "],
    });
    expect(plan.addressBooks).toEqual(["Family"]);
  });

  it("drops a repeated name regardless of case", () => {
    const plan = onboardingPlan({
      ...initialOnboardingDraft(),
      notebooks: ["Journal", "journal", "Recipes"],
    });
    expect(plan.notebooks).toEqual(["Journal", "Recipes"]);
  });

  it("will not create a second container shadowing one the account already has", () => {
    const plan = onboardingPlan({
      ...initialOnboardingDraft(),
      addressBooks: [DEFAULT_ADDRESS_BOOK_NAME.toUpperCase(), "Work"],
      notebooks: [DEFAULT_NOTEBOOK_NAME, "Ideas"],
    });
    expect(plan.addressBooks).toEqual(["Work"]);
    expect(plan.notebooks).toEqual(["Ideas"]);
  });

  it("creates nothing for a feature that was turned back off", () => {
    const plan = onboardingPlan({
      settings: withFeature(allOn, "calendar", false),
      addressBooks: ["Work"],
      calendars: ["Personal"],
      notebooks: ["Ideas"],
    });
    expect(plan.calendars).toEqual([]);
    expect(plannedContainerCount(plan)).toBe(2);
  });

  it("carries the chosen settings through untouched", () => {
    const settings = withContactMode(withFeature(allOn, "notes", false), "detailed");
    expect(onboardingPlan({ ...initialOnboardingDraft(), settings }).settings).toEqual(settings);
  });
});

import { useMemo, useState } from "react";
import { Modal } from "./Modal";
import {
  CONTACT_MODES,
  CONTACT_MODE_LABELS,
  FEATURES,
  FEATURE_LABELS,
  canDisableFeature,
  isFeatureEnabled,
  normalizeContactMode,
  withContactMode,
  withFeature,
} from "../lib/accountSettings";
import { DEFAULT_ADDRESS_BOOK_NAME } from "../lib/addressBook";
import { DEFAULT_CALENDAR_NAME } from "../lib/calendar";
import { DEFAULT_NOTEBOOK_NAME } from "../lib/note";
import { DEFAULT_BOOKMARK_COLLECTION_NAME } from "../lib/bookmark";
import { DEFAULT_TASK_LIST_NAME } from "../lib/task";
import {
  CONTAINER_KEYS,
  type ContainerKey,
  type OnboardingDraft,
  type OnboardingPlan,
  type OnboardingStep,
  initialOnboardingDraft,
  nextOnboardingStep,
  onboardingPlan,
  onboardingSteps,
  plannedContainerCount,
  previousOnboardingStep,
} from "../lib/onboarding";
import type { ContactMode, FeatureKey } from "../lib/types";
import { btnPrimary, btnSecondary, fieldBase, focusRing, ghost } from "../lib/styles";

type Props = {
  username: string;
  /** Resolves to an error to show in place, or null when the writes went through. */
  onComplete: (plan: OnboardingPlan, jumpTo: FeatureKey | null) => Promise<string | null>;
  onDismiss: () => void;
};

const STEP_TITLES: Record<OnboardingStep, string> = {
  welcome: "Welcome to Sealbook",
  features: "Choose what you want",
  contacts: "How much should a contact hold?",
  containers: "Set up your containers",
  import: "Bring your data with you",
  clients: "Sealbook on your other devices",
};

const FEATURE_BLURBS: Record<FeatureKey, string> = {
  contacts: "Address books, with names, numbers, emails, addresses and dates.",
  calendar: "Calendars and events, including repeating ones.",
  notes: "Notebooks of Markdown notes, arranged in a tree.",
  bookmarks: "Saved links, filed into collections that nest.",
  tasks: "To-dos with due dates, repeats and subtasks, in lists that nest.",
};

const CONTAINER_COPY: Record<
  FeatureKey,
  { label: string; singular: string; article: string; existing: string | null; placeholder: string }
> = {
  contacts: {
    label: "Address books",
    singular: "address book",
    article: "an",
    existing: `You already have "${DEFAULT_ADDRESS_BOOK_NAME}". Add more to keep work and personal apart.`,
    placeholder: "Family",
  },
  calendar: {
    label: "Calendars",
    singular: "calendar",
    article: "a",
    existing: `"${DEFAULT_CALENDAR_NAME}" is created the first time you open Calendar.`,
    placeholder: "Personal",
  },
  notes: {
    label: "Notebooks",
    singular: "notebook",
    article: "a",
    existing: `"${DEFAULT_NOTEBOOK_NAME}" is created the first time you open Notes.`,
    placeholder: "Journal",
  },
  bookmarks: {
    label: "Collections",
    singular: "collection",
    article: "a",
    existing: `"${DEFAULT_BOOKMARK_COLLECTION_NAME}" is created the first time you open Bookmarks.`,
    placeholder: "Reading list",
  },
  tasks: {
    label: "Task lists",
    singular: "task list",
    article: "a",
    existing: `"${DEFAULT_TASK_LIST_NAME}" is created the first time you open Tasks.`,
    placeholder: "Groceries",
  },
};

const IMPORT_COPY: Record<FeatureKey, { formats: string; sources: string }> = {
  contacts: {
    formats: "vCard (.vcf), CSV, or a Sealbook JSON backup",
    sources: "Google Contacts, iCloud and Outlook all export one of these.",
  },
  calendar: {
    formats: "iCalendar (.ics) or a Sealbook JSON backup",
    sources: "Google Calendar and Apple Calendar both export .ics.",
  },
  notes: {
    formats: "Markdown (.md, .txt) or a Sealbook JSON backup",
    sources: "Obsidian, Bear and Logseq keep their notes as Markdown already.",
  },
  bookmarks: {
    formats: "a Sealbook JSON backup",
    sources: "Links can also be added one at a time from the Bookmarks tab.",
  },
  tasks: {
    formats: "a Sealbook JSON backup",
    sources: "Tasks can also be added one at a time from the Tasks tab.",
  },
};

const CLIENTS: { name: string; status: string; blurb: string; href?: string }[] = [
  {
    name: "Android",
    status: "Available",
    blurb:
      "The full vault on your phone, with contacts, calendars and offline access. Pair it from Add device rather than typing your password again.",
    href: "https://github.com/silent-sphinx/sealbook-android",
  },
  {
    name: "Command line",
    status: "Available",
    blurb: "Ships with the server, for scripting and bulk import or export.",
    href: "https://github.com/silent-sphinx/sealbook",
  },
  { name: "iOS", status: "Planned", blurb: "Not yet started." },
  { name: "Desktop", status: "Planned", blurb: "Not yet started." },
];

export function WelcomeModal({ username, onComplete, onDismiss }: Props) {
  const [draft, setDraft] = useState<OnboardingDraft>(initialOnboardingDraft);
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const steps = useMemo(() => onboardingSteps(draft.settings), [draft.settings]);
  const plan = useMemo(() => onboardingPlan(draft), [draft]);
  const position = steps.indexOf(step);
  const back = previousOnboardingStep(steps, step);
  const forward = nextOnboardingStep(steps, step);

  function toggleFeature(feature: FeatureKey, enabled: boolean) {
    setDraft((current) => ({
      ...current,
      settings: withFeature(current.settings, feature, enabled),
    }));
  }

  function chooseContactMode(mode: ContactMode) {
    setDraft((current) => ({
      ...current,
      settings: withContactMode(current.settings, mode),
    }));
  }

  function setName(key: ContainerKey, at: number, value: string) {
    setDraft((current) => {
      const names = [...current[key]];
      names[at] = value;
      return { ...current, [key]: names };
    });
  }

  function addName(key: ContainerKey) {
    setDraft((current) => ({ ...current, [key]: [...current[key], ""] }));
  }

  function removeName(key: ContainerKey, at: number) {
    setDraft((current) => ({
      ...current,
      [key]: current[key].filter((_, index) => index !== at),
    }));
  }

  async function finish(jumpTo: FeatureKey | null) {
    setBusy(true);
    setError(null);
    const failure = await onComplete(plan, jumpTo);
    if (failure) {
      setError(failure);
      setBusy(false);
      return;
    }
    // Left busy: a successful finish unmounts the dialog.
  }

  const enabled = FEATURES.filter((feature) => isFeatureEnabled(draft.settings, feature));
  const mode = normalizeContactMode(draft.settings.contactMode);

  return (
    <Modal title={STEP_TITLES[step]} onClose={busy ? () => {} : onDismiss}>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
        {step === "welcome" ? (
          <div>
            <p className="text-sm leading-relaxed text-mute">
              Your account is ready{username ? `, ${username}` : ""}. Everything you put in
              Sealbook is sealed in this browser before it leaves, so the server stores your
              contacts, events and notes without ever being able to read them.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-mute">
              That is also why the recovery words you just wrote down matter: they are the only
              way back into the vault if you forget your password. Nobody can reset it for you.
            </p>
            <p className="mt-5 text-sm leading-relaxed text-mute">
              The next few steps set up the parts you want to use. Every one of them can be
              changed later in Settings, so nothing here is final.
            </p>
          </div>
        ) : null}

        {step === "features" ? (
          <div>
            <p className="text-sm leading-relaxed text-mute">
              Turning one off hides its tab on every device signed in to this account. Nothing is
              deleted, and you can turn it back on in Settings at any time.
            </p>
            <ul className="mt-5 space-y-3">
              {FEATURES.map((feature) => {
                const on = isFeatureEnabled(draft.settings, feature);
                const isLastEnabled = on && !canDisableFeature(draft.settings, feature);
                const label = FEATURE_LABELS[feature];
                return (
                  <li
                    key={feature}
                    className="flex items-center justify-between gap-4 rounded-xl border border-line/80 bg-bg/50 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-text">{label}</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-mute">
                        {isLastEnabled
                          ? "Your only enabled feature, so it has to stay on."
                          : FEATURE_BLURBS[feature]}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={`${label} enabled`}
                      disabled={isLastEnabled || busy}
                      onClick={() => toggleFeature(feature, !on)}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing} ${on
                        ? "border-accent/40 bg-accent"
                        : "border-line bg-surface"}`}
                    >
                      <span
                        aria-hidden="true"
                        className={`inline-block h-4 w-4 rounded-full bg-bg transition-transform duration-150 ${on ? "translate-x-[22px]" : "translate-x-1"}`}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {step === "contacts" ? (
          <div>
            <p className="text-sm leading-relaxed text-mute">
              Basic keeps the address book to the usual fields. Detailed turns it into a personal
              relationship manager, with sections for how you met, interests, work history, family and
              life events. Switching back later hides those sections without deleting anything.
            </p>
            <div
              role="radiogroup"
              aria-label="Contact detail level"
              className="mt-5 grid gap-3 sm:grid-cols-2"
            >
              {CONTACT_MODES.map((option) => {
                const active = mode === option;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={busy}
                    onClick={() => chooseContactMode(option)}
                    className={`rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${focusRing} ${active
                      ? "border-accent/40 bg-accent/10"
                      : "border-line/80 bg-bg/50 hover:border-line-light"}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-text">
                        {CONTACT_MODE_LABELS[option]}
                      </span>
                      {active ? (
                        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">
                          Chosen
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-mute">
                      {option === "basic"
                        ? "Names, channels, dates, socials, work, address and notes."
                        : "Everything in basic, plus ten relationship sections you add one at a time."}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {step === "containers" ? (
          <div className="space-y-6">
            <p className="text-sm leading-relaxed text-mute">
              Name as many as you like, or none at all. You can add and rename them from the
              sidebar later.
            </p>
            {enabled.map((feature) => {
              const key = CONTAINER_KEYS[feature];
              const copy = CONTAINER_COPY[feature];
              const names = draft[key];
              return (
                <section key={feature}>
                  <h3 className="text-sm font-semibold text-text">{copy.label}</h3>
                  {copy.existing ? (
                    <p className="mt-1 text-[11px] leading-relaxed text-mute">{copy.existing}</p>
                  ) : null}
                  <ul className="mt-3 space-y-2">
                    {names.map((name, at) => (
                      <li key={at} className="flex items-center gap-2">
                        <input
                          value={name}
                          onChange={(event) => setName(key, at, event.target.value)}
                          placeholder={copy.placeholder}
                          aria-label={`New ${copy.singular} name`}
                          disabled={busy}
                          className={fieldBase}
                        />
                        <button
                          type="button"
                          onClick={() => removeName(key, at)}
                          disabled={busy}
                          aria-label={`Remove this ${copy.singular}`}
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`}
                        >
                          &times;
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={() => addName(key)}
                    disabled={busy}
                    className={`${ghost} mt-2.5`}
                  >
                    + Add {names.length === 0 ? copy.article : "another"} {copy.singular}
                  </button>
                </section>
              );
            })}
          </div>
        ) : null}

        {step === "import" ? (
          <div>
            <p className="text-sm leading-relaxed text-mute">
              You do not have to start from an empty vault. Sealbook reads the formats the apps
              you are leaving already export, and importing sets everything up in one pass.
            </p>
            <div className="mt-5 space-y-3">
              {enabled.map((feature) => (
                <section
                  key={feature}
                  className="rounded-xl border border-line/80 bg-bg/50 px-4 py-3"
                >
                  <h3 className="text-sm font-semibold text-text">{FEATURE_LABELS[feature]}</h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-mute">
                    Accepts {IMPORT_COPY[feature].formats}. {IMPORT_COPY[feature].sources}
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void finish(feature)}
                    className={`${btnSecondary} mt-3`}
                  >
                    Finish and import {FEATURE_LABELS[feature].toLowerCase()}
                  </button>
                </section>
              ))}
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-mute">
              Importing lives in Settings, so you can also come back to it whenever the export
              from your old app is ready.
            </p>
          </div>
        ) : null}

        {step === "clients" ? (
          <div>
            <p className="text-sm leading-relaxed text-mute">
              One account covers every client. Each device gets its own keys through pairing, so
              adding a phone never means handing your password to it.
            </p>
            <ul className="mt-5 space-y-3">
              {CLIENTS.map((client) => (
                <li
                  key={client.name}
                  className="rounded-xl border border-line/80 bg-bg/50 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-text">{client.name}</p>
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${client.href ? "text-accent" : "text-mute"}`}
                    >
                      {client.status}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-mute">{client.blurb}</p>
                  {client.href ? (
                    <a
                      href={client.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className={`${ghost} mt-2 inline-block`}
                    >
                      Get {client.name} &rarr;
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="shrink-0 border-t border-danger/30 bg-danger/10 px-6 py-2.5 text-xs leading-relaxed text-danger"
        >
          {error}
        </p>
      ) : null}

      <div className="shrink-0 border-t border-line bg-panel px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] text-mute tabular-nums">
              Step {position + 1} of {steps.length}
            </p>
            {back ? (
              <button type="button" className={ghost} disabled={busy} onClick={onDismiss}>
                Skip the rest
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {back ? (
              <button
                type="button"
                className={btnSecondary}
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setStep(back);
                }}
              >
                Back
              </button>
            ) : (
              <button type="button" className={btnSecondary} disabled={busy} onClick={onDismiss}>
                Skip setup
              </button>
            )}
            {forward ? (
              <button
                type="button"
                className={btnPrimary}
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setStep(forward);
                }}
              >
                {step === "welcome" ? "Get started" : "Next"}
              </button>
            ) : (
              <button
                type="button"
                className={btnPrimary}
                disabled={busy}
                onClick={() => void finish(null)}
              >
                {busy
                  ? "Finishing…"
                  : plannedContainerCount(plan) > 0
                    ? "Create and finish"
                    : "Finish"}
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

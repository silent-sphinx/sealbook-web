import { useEffect, useRef, useState } from "react";

import {
  MAX_PROFILE_ENTRIES,
  MAX_PROFILE_TEXT_CHARS,
  PROFILE_SECTIONS,
  PROFILE_SECTION_LABELS,
  RELATIONSHIP_KINDS,
  emptyCareer,
  emptyCustomSection,
  emptyFood,
  emptyLifeEvent,
  emptyPerson,
  emptyPet,
  emptyRelationship,
  emptyTag,
  sectionIsEmpty,
  type LinkableSection,
  type ProfileSection,
} from "../lib/contactProfile";
import { addLink, fieldBase, focusRing, selectField } from "../lib/styles";
import { useMediaQuery } from "../lib/useMediaQuery";
import type {
  Contact,
  ContactCareer,
  ContactCustomSection,
  ContactFood,
  ContactFoodPolarity,
  ContactLifeEvent,
  ContactPerson,
  ContactPet,
  ContactProfile,
  ContactRelationship,
  ContactTag,
} from "../lib/types";
import { AddIcon, FormSection, RemoveButton } from "./FieldControls";
import { PartialDateInput } from "./PartialDateInput";
import { ContactLinkPicker } from "./ContactLinkPicker";

/** What each section's add button says, singular. */
const ADD_LABELS: Record<Exclude<ProfileSection, "howWeMet">, string> = {
  interests: "Interest",
  food: "Food",
  music: "Artist or genre",
  pets: "Pet",
  career: "Role",
  relationships: "Relationship",
  timeline: "Life event",
  family: "Family member",
  friends: "Friend",
  colleagues: "Colleague",
};

/** Long enough to notice, short enough not to linger over the next edit. */
const FLASH_MS = 1000;

// Career and relationship entries span several rows, so a hairline rule marks
// where one ends and the next begins. The same divider the form uses between
// sections, not a card, which reads as foreign here.
const entrySeparator = "border-t border-line/60 pt-4";

/**
 * The add-item and remove-section controls for a section header, as discreet
 * pills on transparent fills: green to add, red to remove. `onAdd` is omitted
 * for a section with no list to add to.
 */
function SectionActions({
  onAdd,
  addDisabled,
  onRemove,
}: {
  onAdd?: () => void;
  addDisabled?: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          disabled={addDisabled}
          title={addDisabled ? `Up to ${MAX_PROFILE_ENTRIES} entries` : undefined}
          className={`inline-flex items-center gap-1 rounded-full border border-note-new/30 bg-note-new/10 px-2.5 py-1 text-[11px] font-medium text-note-new transition-colors hover:bg-note-new/20 disabled:opacity-40 disabled:hover:bg-note-new/10 ${focusRing}`}
        >
          <AddIcon />
          Add
        </button>
      ) : null}
      <button
        type="button"
        onClick={onRemove}
        className={`inline-flex items-center rounded-full border border-danger/30 bg-danger/10 px-2.5 py-1 text-[11px] font-medium text-danger transition-colors hover:bg-danger/20 ${focusRing}`}
      >
        Remove
      </button>
    </div>
  );
}

type Props = {
  profile: ContactProfile;
  onChange: (profile: ContactProfile) => void;
  contacts?: Contact[];
  currentContactId?: string;
};

/**
 * The relationship sections, shown only in detailed contact mode.
 *
 * Sections are added one at a time rather than all ten being rendered: the form
 * then shows what this contact actually has, and a further section later is a
 * row in `PROFILE_SECTIONS` rather than more height for everybody.
 */
export function ContactProfileFields({ profile, onChange, contacts, currentContactId }: Props) {
  const [shown, setShown] = useState<ProfileSection[]>(() =>
    PROFILE_SECTIONS.filter((section) => !sectionIsEmpty(profile, section)),
  );
  const [picking, setPicking] = useState(false);
  const [linkingSection, setLinkingSection] = useState<LinkableSection | null>(null);
  const [linkSearch, setLinkSearch] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  // An object rather than the key: removing a section and adding it again has to
  // flash a second time, which an equal value would not re-trigger. The key is a
  // ProfileSection name or a custom section's id.
  const [flash, setFlash] = useState<{ key: string } | null>(null);
  const sectionNodes = useRef(new Map<string, HTMLElement | null>());
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  // The section is in the DOM by the time this runs, which is why the scroll
  // lives here rather than in the click handler.
  useEffect(() => {
    if (!flash) return;
    sectionNodes.current.get(flash.key)?.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "center",
    });
    const timer = window.setTimeout(() => setFlash(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flash, reducedMotion]);

  function addCustomSection() {
    const section = emptyCustomSection();
    setPicking(false);
    setFlash({ key: section.id });
    onChange({ ...profile, custom: [...profile.custom, section] });
  }

  function updateCustomSection(id: string, partial: Partial<ContactCustomSection>) {
    patch({
      custom: profile.custom.map((section) =>
        section.id === id ? { ...section, ...partial } : section,
      ),
    });
  }

  function removeCustomSection(id: string) {
    patch({ custom: profile.custom.filter((section) => section.id !== id) });
  }

  useEffect(() => {
    if (!picking) return;

    function closeOnClick(event: MouseEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setPicking(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setPicking(false);
    }

    document.addEventListener("mousedown", closeOnClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [picking]);

  const available = PROFILE_SECTIONS.filter((section) => !shown.includes(section));

  function patch(partial: Partial<ContactProfile>) {
    onChange({ ...profile, ...partial });
  }

  // Seeded with one row so the section opens ready to type in rather than as a
  // heading above another button.
  function addSection(section: ProfileSection) {
    setShown((current) => [...current, section]);
    setPicking(false);
    setFlash({ key: section });
    switch (section) {
      case "howWeMet":
        return;
      case "interests":
        return patch({ interests: [...profile.interests, emptyTag()] });
      case "music":
        return patch({ music: [...profile.music, emptyTag()] });
      case "food":
        return patch({ food: [...profile.food, emptyFood()] });
      case "pets":
        return patch({ pets: [...profile.pets, emptyPet()] });
      case "career":
        return patch({ career: [...profile.career, emptyCareer()] });
      case "relationships":
        return patch({ relationships: [...profile.relationships, emptyRelationship()] });
      case "timeline":
        return patch({ timeline: [...profile.timeline, emptyLifeEvent()] });
      case "family":
        return patch({ family: [...profile.family, emptyPerson()] });
      case "friends":
        return patch({ friends: [...profile.friends, emptyPerson()] });
      case "colleagues":
        return patch({ colleagues: [...profile.colleagues, emptyPerson()] });
    }
  }

  function removeSection(section: ProfileSection) {
    setShown((current) => current.filter((id) => id !== section));
    switch (section) {
      case "howWeMet":
        return patch({ howWeMet: undefined });
      case "interests":
        return patch({ interests: [] });
      case "music":
        return patch({ music: [] });
      case "food":
        return patch({ food: [] });
      case "pets":
        return patch({ pets: [] });
      case "career":
        return patch({ career: [] });
      case "relationships":
        return patch({ relationships: [] });
      case "timeline":
        return patch({ timeline: [] });
      case "family":
        return patch({ family: [] });
      case "friends":
        return patch({ friends: [] });
      case "colleagues":
        return patch({ colleagues: [] });
    }
  }

  // Appends one empty entry to a list section, which the header's add pill
  // drives now that the per-list add button is gone. `howWeMet` is a single
  // field, so it has nothing to add to.
  function addEntry(section: ProfileSection) {
    switch (section) {
      case "howWeMet":
        return;
      case "interests":
        return patch({ interests: [...profile.interests, emptyTag()] });
      case "music":
        return patch({ music: [...profile.music, emptyTag()] });
      case "food":
        return patch({ food: [...profile.food, emptyFood()] });
      case "pets":
        return patch({ pets: [...profile.pets, emptyPet()] });
      case "career":
        return patch({ career: [...profile.career, emptyCareer()] });
      case "relationships":
        return patch({ relationships: [...profile.relationships, emptyRelationship()] });
      case "timeline":
        return patch({ timeline: [...profile.timeline, emptyLifeEvent()] });
      case "family":
        return patch({ family: [...profile.family, emptyPerson()] });
      case "friends":
        return patch({ friends: [...profile.friends, emptyPerson()] });
      case "colleagues":
        return patch({ colleagues: [...profile.colleagues, emptyPerson()] });
    }
  }

  function sectionCount(section: ProfileSection): number {
    return section === "howWeMet" ? 0 : profile[section].length;
  }

  // Rendered in PROFILE_SECTIONS order rather than the order they were added, so
  // the form reads the same as the detail pane.
  const ordered = PROFILE_SECTIONS.filter((section) => shown.includes(section));

  return (
    <>
      {ordered.map((section) => (
        <FormSection
          key={section}
          // A block body: a ref callback that returns a value is read by React 19
          // as a cleanup function, and `Map.set` returns the map.
          ref={(node) => {
            sectionNodes.current.set(section, node);
          }}
          // Tinted to its own box rather than inset: the section is delimited by
          // a full-width rule, and padding the flash would carry that rule out
          // past its neighbours for the second the class is on.
          className={flash?.key === section ? "animate-flash-block" : undefined}
          title={PROFILE_SECTION_LABELS[section]}
          action={
            <SectionActions
              onAdd={section === "howWeMet" ? undefined : () => addEntry(section)}
              addDisabled={sectionCount(section) >= MAX_PROFILE_ENTRIES}
              onRemove={() => removeSection(section)}
            />
          }
        >
          <SectionBody
            section={section}
            profile={profile}
            patch={patch}
            onLinkRequest={
              contacts &&
              (section === "family" || section === "friends" || section === "colleagues")
                ? () => setLinkingSection(section as LinkableSection)
                : undefined
            }
          />
        </FormSection>
      ))}

      {profile.custom.map((section) => (
        <FormSection
          key={section.id}
          ref={(node) => {
            sectionNodes.current.set(section.id, node);
          }}
          className={flash?.key === section.id ? "animate-flash-block" : undefined}
          title="Custom Section"
          action={<SectionActions onRemove={() => removeCustomSection(section.id)} />}
        >
          <CustomSectionBody
            section={section}
            onChange={(partial) => updateCustomSection(section.id, partial)}
          />
        </FormSection>
      ))}

      {linkingSection ? (
        <ContactLinkPicker
          positionFixed
          currentContactId={currentContactId ?? ""}
          currentProfile={profile}
          contacts={contacts ?? []}
          section={linkingSection}
          onLink={(targetId) => {
            const linked = contacts?.find((c) => c.id === targetId);
            if (!linked) return;
            const newPerson: ContactPerson = { id: crypto.randomUUID(), name: linked.name, contactId: linked.id };
            onChange({ ...profile, [linkingSection]: [...profile[linkingSection], newPerson] });
            setLinkingSection(null);
            setLinkSearch("");
          }}
          onClose={() => { setLinkingSection(null); setLinkSearch(""); }}
          search={linkSearch}
          onSearchChange={setLinkSearch}
        />
      ) : null}

      <div ref={pickerRef} className="relative mt-6 border-t border-line pt-5">
        <button
          type="button"
          className={`${addLink} inline-flex items-center gap-1.5`}
          aria-expanded={picking}
          onClick={() => setPicking((open) => !open)}
        >
          <AddIcon />
          Add section
        </button>
        {picking ? (
          <div className="absolute bottom-full left-0 z-20 mb-2 w-60 overflow-hidden rounded-lg border border-line bg-elevated p-1 shadow-xl">
            {available.map((section) => (
              <button
                key={section}
                type="button"
                className={`w-full rounded-md px-3 py-2 text-left text-xs text-text transition-colors hover:bg-surface ${focusRing}`}
                onClick={() => addSection(section)}
              >
                {PROFILE_SECTION_LABELS[section]}
              </button>
            ))}
            {/* Custom stays on offer however many already exist, unlike the
                fixed sections, which leave the list once added. */}
            <button
              type="button"
              className={`w-full rounded-md px-3 py-2 text-left text-xs text-text transition-colors hover:bg-surface ${focusRing} ${available.length > 0 ? "mt-1 border-t border-line pt-2.5" : ""}`}
              onClick={addCustomSection}
            >
              Custom section…
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}

function SectionBody({
  section,
  profile,
  patch,
  onLinkRequest,
}: {
  section: ProfileSection;
  profile: ContactProfile;
  patch: (partial: Partial<ContactProfile>) => void;
  onLinkRequest?: () => void;
}) {
  switch (section) {
    case "howWeMet":
      return (
        <TextAreaField
          value={profile.howWeMet ?? ""}
          placeholder="Where you met, who introduced you, what you talked about…"
          onChange={(howWeMet) => patch({ howWeMet })}
        />
      );
    case "interests":
      return (
        <TagRows
          rows={profile.interests}
          placeholder="e.g. Rock climbing"
          addLabel={ADD_LABELS.interests}
          onChange={(interests) => patch({ interests })}
        />
      );
    case "music":
      return (
        <TagRows
          rows={profile.music}
          placeholder="e.g. Talking Heads"
          addLabel={ADD_LABELS.music}
          onChange={(music) => patch({ music })}
        />
      );
    case "food":
      return <FoodRows rows={profile.food} onChange={(food) => patch({ food })} />;
    case "pets":
      return <PetRows rows={profile.pets} onChange={(pets) => patch({ pets })} />;
    case "career":
      return <CareerRows rows={profile.career} onChange={(career) => patch({ career })} />;
    case "relationships":
      return (
        <RelationshipRows
          rows={profile.relationships}
          onChange={(relationships) => patch({ relationships })}
        />
      );
    case "timeline":
      return <TimelineRows rows={profile.timeline} onChange={(timeline) => patch({ timeline })} />;
    case "family":
      return (
        <PersonRows
          rows={profile.family}
          showRelation
          addLabel={ADD_LABELS.family}
          onChange={(family) => patch({ family })}
          onLinkRequest={onLinkRequest}
        />
      );
    case "friends":
      return (
        <PersonRows
          rows={profile.friends}
          addLabel={ADD_LABELS.friends}
          onChange={(friends) => patch({ friends })}
          onLinkRequest={onLinkRequest}
        />
      );
    case "colleagues":
      return (
        <PersonRows
          rows={profile.colleagues}
          addLabel={ADD_LABELS.colleagues}
          onChange={(colleagues) => patch({ colleagues })}
          onLinkRequest={onLinkRequest}
        />
      );
  }
}

function TextAreaField({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const over = value.length > MAX_PROFILE_TEXT_CHARS;
  return (
    <div className="grid gap-1.5">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className={`${fieldBase} h-auto min-h-[5.5rem] py-2.5 resize-y leading-relaxed`}
      />
      {value.length > MAX_PROFILE_TEXT_CHARS * 0.8 ? (
        <p className={`text-right text-[11px] ${over ? "text-danger" : "text-mute"}`}>
          {value.length.toLocaleString()} / {MAX_PROFILE_TEXT_CHARS.toLocaleString()}
        </p>
      ) : null}
    </div>
  );
}

/** A user-titled section: a free-text heading over a free-text body. */
function CustomSectionBody({
  section,
  onChange,
}: {
  section: ContactCustomSection;
  onChange: (partial: Partial<ContactCustomSection>) => void;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <input
        value={section.title}
        onChange={(e) => onChange({ title: e.target.value })}
        placeholder="Section title"
        aria-label="Section title"
        maxLength={MAX_PROFILE_TEXT_CHARS}
        className={fieldBase}
      />
      <TextAreaField
        value={section.text}
        placeholder="Anything you want to keep under this heading…"
        onChange={(text) => onChange({ text })}
      />
    </div>
  );
}

/**
 * The add button every row list ends with. Hidden at the entry cap rather than
 * left to fail on save.
 */
function rowOps<T extends { id: string }>(rows: T[], onChange: (rows: T[]) => void) {
  return {
    update: (id: string, partial: Partial<T>) =>
      onChange(rows.map((row) => (row.id === id ? { ...row, ...partial } : row))),
    remove: (id: string) => onChange(rows.filter((row) => row.id !== id)),
    add: (row: T) => onChange([...rows, row]),
  };
}

function TagRows({
  rows,
  placeholder,
  addLabel,
  onChange,
}: {
  rows: ContactTag[];
  placeholder: string;
  addLabel: string;
  onChange: (rows: ContactTag[]) => void;
}) {
  const list = rowOps(rows, onChange);
  return (
    <div className="grid min-w-0 gap-2">
      {rows.map((row) => (
        <div key={row.id} className="flex min-w-0 items-start gap-2">
          <input
            value={row.value}
            onChange={(e) => list.update(row.id, { value: e.target.value })}
            placeholder={placeholder}
            aria-label={addLabel}
            className={fieldBase}
          />
          <RemoveButton label={`Remove ${addLabel.toLowerCase()}`} onClick={() => list.remove(row.id)} />
        </div>
      ))}    </div>
  );
}

const FOOD_POLARITIES: { value: ContactFoodPolarity; label: string }[] = [
  { value: "like", label: "Likes" },
  { value: "dislike", label: "Dislikes" },
];

function FoodRows({
  rows,
  onChange,
}: {
  rows: ContactFood[];
  onChange: (rows: ContactFood[]) => void;
}) {
  const list = rowOps(rows, onChange);
  return (
    <div className="grid min-w-0 gap-2">
      {rows.map((row) => (
        <div
          key={row.id}
          className="grid min-w-0 grid-cols-[6rem_minmax(0,1fr)_2.5rem] items-start gap-2 sm:grid-cols-[6.5rem_minmax(0,1fr)_2.5rem]"
        >
          <select
            value={row.polarity}
            aria-label="Likes or dislikes"
            onChange={(e) =>
              list.update(row.id, { polarity: e.target.value as ContactFoodPolarity })
            }
            className={selectField}
          >
            {FOOD_POLARITIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="grid min-w-0 gap-2">
            <input
              value={row.value}
              onChange={(e) => list.update(row.id, { value: e.target.value })}
              placeholder="e.g. Coriander"
              aria-label="Food"
              className={fieldBase}
            />
            <input
              value={row.note ?? ""}
              onChange={(e) => list.update(row.id, { note: e.target.value })}
              placeholder="Note (optional)"
              aria-label="Food note"
              className={fieldBase}
            />
          </div>
          <RemoveButton label="Remove food" onClick={() => list.remove(row.id)} />
        </div>
      ))}    </div>
  );
}

function PetRows({
  rows,
  onChange,
}: {
  rows: ContactPet[];
  onChange: (rows: ContactPet[]) => void;
}) {
  const list = rowOps(rows, onChange);
  return (
    <div className="grid min-w-0 gap-2">
      {rows.map((row) => (
        <div key={row.id} className="flex min-w-0 items-start gap-2">
          <div className="grid min-w-0 flex-1 gap-2">
            <div className="grid min-w-0 gap-2 sm:grid-cols-2">
              <input
                value={row.name}
                onChange={(e) => list.update(row.id, { name: e.target.value })}
                placeholder="Name"
                aria-label="Pet name"
                className={fieldBase}
              />
              <input
                value={row.species ?? ""}
                onChange={(e) => list.update(row.id, { species: e.target.value })}
                placeholder="Dog, cat, tortoise…"
                aria-label="Pet species"
                className={fieldBase}
              />
            </div>
            <input
              value={row.note ?? ""}
              onChange={(e) => list.update(row.id, { note: e.target.value })}
              placeholder="Note (optional)"
              aria-label="Pet note"
              className={fieldBase}
            />
          </div>
          <RemoveButton label="Remove pet" onClick={() => list.remove(row.id)} />
        </div>
      ))}    </div>
  );
}

function CareerRows({
  rows,
  onChange,
}: {
  rows: ContactCareer[];
  onChange: (rows: ContactCareer[]) => void;
}) {
  const list = rowOps(rows, onChange);
  return (
    <div className="grid min-w-0 gap-2">
      {rows.map((row, index) => (
        <div
          key={row.id}
          className={`flex min-w-0 items-start gap-2 ${index > 0 ? entrySeparator : ""}`}
        >
          <div className="grid min-w-0 flex-1 gap-2">
            <div className="grid min-w-0 gap-2 sm:grid-cols-2">
              <input
                value={row.organization}
                onChange={(e) => list.update(row.id, { organization: e.target.value })}
                placeholder="Workplace"
                aria-label="Past workplace"
                className={fieldBase}
              />
              <input
                value={row.title ?? ""}
                onChange={(e) => list.update(row.id, { title: e.target.value })}
                placeholder="Role"
                aria-label="Past role"
                className={fieldBase}
              />
            </div>
            <div className="grid min-w-0 gap-2 sm:grid-cols-2">
              <PartialDateInput
                label="Started"
                value={row.start ?? ""}
                onChange={(start) => list.update(row.id, { start })}
              />
              <PartialDateInput
                label="Ended"
                value={row.end ?? ""}
                hint="blank if current"
                onChange={(end) => list.update(row.id, { end })}
              />
            </div>
            <input
              value={row.note ?? ""}
              onChange={(e) => list.update(row.id, { note: e.target.value })}
              placeholder="Note (optional)"
              aria-label="Role note"
              className={fieldBase}
            />
          </div>
          <RemoveButton label="Remove role" onClick={() => list.remove(row.id)} />
        </div>
      ))}    </div>
  );
}

/**
 * A text field with its label as a pill inside the field on the left, on a
 * different background, so the field reads without a separate caption above it.
 */
function PillInput({
  label,
  value,
  placeholder,
  ariaLabel,
  listId,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  ariaLabel?: string;
  listId?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex h-10 min-w-0 items-center rounded-lg border border-line bg-bg transition-colors focus-within:border-accent-dim focus-within:ring-1 focus-within:ring-accent-ring">
      <span className="ml-1.5 shrink-0 rounded-md bg-surface px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-mute/80">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? label}
        list={listId}
        className="min-w-0 flex-1 bg-transparent px-2.5 text-sm text-text outline-none placeholder:text-mute/70"
      />
    </div>
  );
}

function RelationshipRows({
  rows,
  onChange,
}: {
  rows: ContactRelationship[];
  onChange: (rows: ContactRelationship[]) => void;
}) {
  const list = rowOps(rows, onChange);
  return (
    <div className="grid min-w-0 gap-3">
      {rows.map((row) => (
        <div
          key={row.id}
          className="flex min-w-0 items-start gap-2 rounded-xl border border-line/60 bg-surface/40 p-3"
        >
          <div className="grid min-w-0 flex-1 gap-2">
            <div className="grid min-w-0 gap-2 sm:grid-cols-2">
              <PillInput
                label="Name"
                value={row.name}
                placeholder="Full name"
                ariaLabel="Partner name"
                onChange={(name) => list.update(row.id, { name })}
              />
              <PillInput
                label="Status"
                value={row.kind}
                placeholder="Partner, spouse, ex…"
                ariaLabel="Relationship kind"
                listId={`relationship-kinds-${row.id}`}
                onChange={(kind) => list.update(row.id, { kind })}
              />
              <datalist id={`relationship-kinds-${row.id}`}>
                {RELATIONSHIP_KINDS.map((kind) => (
                  <option key={kind} value={kind} />
                ))}
              </datalist>
            </div>
            <label className="flex h-10 w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border border-line bg-bg px-3 text-sm text-mute transition-colors hover:border-line-light">
              <input
                type="checkbox"
                checked={row.current ?? false}
                // Checking clears any end date and drops the field below: a
                // current relationship stores no end. See serializeProfile.
                onChange={(e) =>
                  list.update(row.id, {
                    current: e.target.checked || undefined,
                    end: e.target.checked ? undefined : row.end,
                  })
                }
                className="h-4 w-4 accent-[var(--color-accent)]"
              />
              Current partner
            </label>
            <div className={`grid min-w-0 gap-2 ${row.current ? "" : "sm:grid-cols-2"}`}>
              <PartialDateInput
                label="Started"
                value={row.start ?? ""}
                onChange={(start) => list.update(row.id, { start })}
              />
              {!row.current ? (
                <PartialDateInput
                  label="Ended"
                  value={row.end ?? ""}
                  onChange={(end) => list.update(row.id, { end })}
                />
              ) : null}
            </div>
            <PillInput
              label="Note"
              value={row.note ?? ""}
              placeholder="Optional"
              ariaLabel="Relationship note"
              onChange={(note) => list.update(row.id, { note })}
            />
          </div>
          <button
            type="button"
            aria-label="Remove relationship"
            onClick={() => list.remove(row.id)}
            className="-my-3 -mr-3 flex w-12 shrink-0 cursor-pointer items-center justify-center self-stretch rounded-r-xl bg-danger/10 text-danger transition-colors duration-150 hover:bg-danger/20"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>
      ))}    </div>
  );
}

function TimelineRows({
  rows,
  onChange,
}: {
  rows: ContactLifeEvent[];
  onChange: (rows: ContactLifeEvent[]) => void;
}) {
  const list = rowOps(rows, onChange);
  return (
    <div className="grid min-w-0 gap-2">
      {rows.map((row) => (
        <div key={row.id} className="flex min-w-0 items-start gap-2">
          <div className="grid min-w-0 flex-1 gap-2">
            <input
              value={row.title}
              onChange={(e) => list.update(row.id, { title: e.target.value })}
              placeholder="What happened"
              aria-label="Life event"
              className={fieldBase}
            />
            <PartialDateInput
              label="When"
              value={row.date ?? ""}
              defaultPrecision="day"
              onChange={(date) => list.update(row.id, { date })}
            />
            <textarea
              value={row.description ?? ""}
              onChange={(e) => list.update(row.id, { description: e.target.value })}
              placeholder="Description (optional)"
              aria-label="Life event description"
              rows={2}
              className={`${fieldBase} h-auto min-h-[4rem] py-2.5 resize-y leading-relaxed`}
            />
          </div>
          <RemoveButton label="Remove life event" onClick={() => list.remove(row.id)} />
        </div>
      ))}    </div>
  );
}

function PersonRows({
  rows,
  showRelation = false,
  addLabel,
  onChange,
  onLinkRequest,
}: {
  rows: ContactPerson[];
  showRelation?: boolean;
  addLabel: string;
  onChange: (rows: ContactPerson[]) => void;
  onLinkRequest?: () => void;
}) {
  const list = rowOps(rows, onChange);
  return (
    <div className="grid min-w-0 gap-2">
      {rows.map((row) => (
        <div key={row.id} className="flex min-w-0 items-start gap-2">
          <div className="grid min-w-0 flex-1 gap-2">
            <div className={`grid min-w-0 gap-2 ${showRelation ? "sm:grid-cols-2" : ""}`}>
              <input
                value={row.name}
                onChange={(e) => list.update(row.id, { name: e.target.value })}
                placeholder="Name"
                aria-label={`${addLabel} name`}
                className={fieldBase}
              />
              {showRelation ? (
                <input
                  value={row.relation ?? ""}
                  onChange={(e) => list.update(row.id, { relation: e.target.value })}
                  placeholder="Mother, brother, nephew…"
                  aria-label="Relation"
                  className={fieldBase}
                />
              ) : null}
            </div>
            <input
              value={row.note ?? ""}
              onChange={(e) => list.update(row.id, { note: e.target.value })}
              placeholder="Note (optional)"
              aria-label={`${addLabel} note`}
              className={fieldBase}
            />
          </div>
          <RemoveButton label={`Remove ${addLabel.toLowerCase()}`} onClick={() => list.remove(row.id)} />
        </div>
      ))}
      {onLinkRequest ? (
        <button
          type="button"
          className={`${addLink} inline-flex items-center gap-1.5`}
          onClick={onLinkRequest}
        >
          <PersonLinkIcon />
          Link a contact
        </button>
      ) : null}
    </div>
  );
}

function PersonLinkIcon() {
  return (
    <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

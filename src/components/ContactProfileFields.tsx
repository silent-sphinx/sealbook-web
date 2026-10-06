import { useEffect, useRef, useState } from "react";

import {
  MAX_PROFILE_ENTRIES,
  MAX_PROFILE_TEXT_CHARS,
  PROFILE_SECTIONS,
  PROFILE_SECTION_LABELS,
  RELATIONSHIP_KINDS,
  emptyCareer,
  emptyFood,
  emptyLifeEvent,
  emptyPerson,
  emptyPet,
  emptyRelationship,
  emptyTag,
  sectionIsEmpty,
  type ProfileSection,
} from "../lib/contactProfile";
import { addLink, fieldBase, focusRing, ghost, selectField } from "../lib/styles";
import { useMediaQuery } from "../lib/useMediaQuery";
import type {
  ContactCareer,
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
};

/** Long enough to notice, short enough not to linger over the next edit. */
const FLASH_MS = 1000;

type Props = {
  profile: ContactProfile;
  onChange: (profile: ContactProfile) => void;
};

/**
 * The relationship sections, shown only in detailed contact mode.
 *
 * Sections are added one at a time rather than all ten being rendered: the form
 * then shows what this contact actually has, and a further section later is a
 * row in `PROFILE_SECTIONS` rather than more height for everybody.
 */
export function ContactProfileFields({ profile, onChange }: Props) {
  const [shown, setShown] = useState<ProfileSection[]>(() =>
    PROFILE_SECTIONS.filter((section) => !sectionIsEmpty(profile, section)),
  );
  const [picking, setPicking] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  // An object rather than the section name: removing a section and adding it
  // again has to flash a second time, which an equal value would not re-trigger.
  const [flash, setFlash] = useState<{ section: ProfileSection } | null>(null);
  const sectionNodes = useRef(new Map<ProfileSection, HTMLElement | null>());
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  // The section is in the DOM by the time this runs, which is why the scroll
  // lives here rather than in the click handler.
  useEffect(() => {
    if (!flash) return;
    sectionNodes.current.get(flash.section)?.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "center",
    });
    const timer = window.setTimeout(() => setFlash(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flash, reducedMotion]);

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
    setFlash({ section });
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
    }
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
          className={flash?.section === section ? "animate-flash-block" : undefined}
          title={PROFILE_SECTION_LABELS[section]}
          action={
            <button type="button" className={ghost} onClick={() => removeSection(section)}>
              Remove
            </button>
          }
        >
          <SectionBody section={section} profile={profile} patch={patch} />
        </FormSection>
      ))}

      <div ref={pickerRef} className="relative mt-6 border-t border-line pt-5">
        <button
          type="button"
          className={`${addLink} inline-flex items-center gap-1.5`}
          disabled={available.length === 0}
          aria-expanded={picking}
          onClick={() => setPicking((open) => !open)}
        >
          <AddIcon />
          {available.length === 0 ? "All sections added" : "Add section"}
        </button>
        {picking && available.length > 0 ? (
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
}: {
  section: ProfileSection;
  profile: ContactProfile;
  patch: (partial: Partial<ContactProfile>) => void;
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
        />
      );
    case "friends":
      return (
        <PersonRows
          rows={profile.friends}
          addLabel={ADD_LABELS.friends}
          onChange={(friends) => patch({ friends })}
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

/**
 * The add button every row list ends with. Hidden at the entry cap rather than
 * left to fail on save.
 */
function AddRowButton({
  label,
  count,
  onClick,
}: {
  label: string;
  count: number;
  onClick: () => void;
}) {
  if (count >= MAX_PROFILE_ENTRIES) {
    return <p className="text-[11px] text-mute">Up to {MAX_PROFILE_ENTRIES} entries.</p>;
  }
  return (
    <button
      type="button"
      className={`${addLink} inline-flex items-center gap-1.5`}
      onClick={onClick}
    >
      <AddIcon />
      {label}
    </button>
  );
}

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
      ))}
      <AddRowButton label={addLabel} count={rows.length} onClick={() => list.add(emptyTag())} />
    </div>
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
      ))}
      <AddRowButton label={ADD_LABELS.food} count={rows.length} onClick={() => list.add(emptyFood())} />
    </div>
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
      ))}
      <AddRowButton label={ADD_LABELS.pets} count={rows.length} onClick={() => list.add(emptyPet())} />
    </div>
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
      {rows.map((row) => (
        <div key={row.id} className="flex min-w-0 items-start gap-2">
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
      ))}
      <AddRowButton label={ADD_LABELS.career} count={rows.length} onClick={() => list.add(emptyCareer())} />
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
    <div className="grid min-w-0 gap-2">
      {rows.map((row) => (
        <div key={row.id} className="flex min-w-0 items-start gap-2">
          <div className="grid min-w-0 flex-1 gap-2">
            <div className="grid min-w-0 gap-2 sm:grid-cols-2">
              <input
                value={row.name}
                onChange={(e) => list.update(row.id, { name: e.target.value })}
                placeholder="Name"
                aria-label="Partner name"
                className={fieldBase}
              />
              <input
                value={row.kind}
                onChange={(e) => list.update(row.id, { kind: e.target.value })}
                placeholder="Partner, spouse, ex…"
                aria-label="Relationship kind"
                list={`relationship-kinds-${row.id}`}
                className={fieldBase}
              />
              <datalist id={`relationship-kinds-${row.id}`}>
                {RELATIONSHIP_KINDS.map((kind) => (
                  <option key={kind} value={kind} />
                ))}
              </datalist>
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
              aria-label="Relationship note"
              className={fieldBase}
            />
          </div>
          <RemoveButton label="Remove relationship" onClick={() => list.remove(row.id)} />
        </div>
      ))}
      <AddRowButton
        label={ADD_LABELS.relationships}
        count={rows.length}
        onClick={() => list.add(emptyRelationship())}
      />
    </div>
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
      ))}
      <AddRowButton
        label={ADD_LABELS.timeline}
        count={rows.length}
        onClick={() => list.add(emptyLifeEvent())}
      />
    </div>
  );
}

function PersonRows({
  rows,
  showRelation = false,
  addLabel,
  onChange,
}: {
  rows: ContactPerson[];
  showRelation?: boolean;
  addLabel: string;
  onChange: (rows: ContactPerson[]) => void;
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
      <AddRowButton label={addLabel} count={rows.length} onClick={() => list.add(emptyPerson())} />
    </div>
  );
}

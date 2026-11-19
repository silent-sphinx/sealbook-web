import { useEffect, useRef, useState } from "react";

import {
  MAX_PROFILE_ENTRIES,
  MAX_PROFILE_TEXT_CHARS,
  PROFILE_SECTIONS,
  PROFILE_SECTION_LABELS,
  RELATIONSHIP_KINDS,
  emptyCustomSection,
  emptyLifeEvent,
  emptyPerson,
  emptyPet,
  emptyRelationship,
  sectionIsEmpty,
  type LinkableSection,
  type ProfileSection,
} from "../lib/contactProfile";
import {
  addLink,
  eyebrow,
  fieldBase,
  focusRing,
  ghost,
  popover,
} from "../lib/styles";
import { useMediaQuery } from "../lib/useMediaQuery";
import type {
  Contact,
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
import {
  DateRange,
  EntryCard,
  EntryList,
  FieldPair,
  FormSection,
  PillInput,
  ProseField,
  TagsInput,
} from "./FieldControls";
import { PartialDateInput } from "./PartialDateInput";
import { Icon } from "./Icon";
import { Avatar } from "./ContactCard";
import { ContactLinkPicker } from "./ContactLinkPicker";

/** Sections that add entries through their own field rather than an add button. */
const TAG_SECTIONS: ProfileSection[] = ["howWeMet", "interests", "music", "food"];
type RowSection = Exclude<ProfileSection, "howWeMet" | "interests" | "music" | "food">;

/** What each section's add button says, singular. */
const ADD_LABELS: Record<Exclude<ProfileSection, "howWeMet">, string> = {
  interests: "Interest",
  food: "Food",
  music: "Artist or genre",
  pets: "Pet",
  relationships: "Relationship",
  timeline: "Life event",
  family: "Family member",
  friends: "Friend",
  colleagues: "Colleague",
};

function isLinkable(section: ProfileSection): section is LinkableSection {
  return section === "family" || section === "friends" || section === "colleagues";
}

/** Long enough to notice, short enough not to linger over the next edit. */
const FLASH_MS = 1000;

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
      // Interests, music and food add themselves via their tag input's own
      // text field, so there's nothing to seed here.
      case "interests":
      case "music":
      case "food":
        return;
      case "pets":
        return patch({ pets: [...profile.pets, emptyPet()] });
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
  // field, so it has nothing to add to; interests, music and food add
  // themselves through their own tag input instead of this pill.
  function addEntry(section: ProfileSection) {
    switch (section) {
      case "howWeMet":
      case "interests":
      case "music":
      case "food":
        return;
      case "pets":
        return patch({ pets: [...profile.pets, emptyPet()] });
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

  function hasRows(section: ProfileSection): section is RowSection {
    return !TAG_SECTIONS.includes(section);
  }

  function sectionCount(section: ProfileSection): number {
    return section === "howWeMet" ? 0 : profile[section].length;
  }

  // Rendered in PROFILE_SECTIONS order rather than the order they were added, so
  // the form reads the same as the detail pane.
  const ordered = PROFILE_SECTIONS.filter((section) => shown.includes(section));

  return (
    <>
      {ordered.map((section, index) => (
        <FormSection
          key={section}
          first={index === 0}
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
          onAdd={hasRows(section) ? () => addEntry(section) : undefined}
          addLabel={hasRows(section) ? ADD_LABELS[section] : undefined}
          addDisabled={sectionCount(section) >= MAX_PROFILE_ENTRIES}
          addDisabledReason={`Up to ${MAX_PROFILE_ENTRIES} entries`}
          actions={
            contacts && isLinkable(section) ? (
              <button
                type="button"
                onClick={() => setLinkingSection(section)}
                aria-label="Link a contact"
                disabled={sectionCount(section) >= MAX_PROFILE_ENTRIES}
                className={`${ghost} inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium hover:bg-surface disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-mute`}
              >
                <Icon name="link" className="h-3.5 w-3.5 shrink-0" />
                Link Contact
              </button>
            ) : undefined
          }
          onRemoveSection={() => removeSection(section)}
        >
          <SectionBody
            section={section}
            profile={profile}
            patch={patch}
            contacts={contacts}
          />
        </FormSection>
      ))}

      {profile.custom.map((section, index) => (
        <FormSection
          key={section.id}
          first={ordered.length === 0 && index === 0}
          ref={(node) => {
            sectionNodes.current.set(section.id, node);
          }}
          className={flash?.key === section.id ? "animate-flash-block" : undefined}
          title="Custom Section"
          onRemoveSection={() => removeCustomSection(section.id)}
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

      <div
        ref={pickerRef}
        className={`relative ${ordered.length + profile.custom.length > 0 ? "mt-5 border-t border-line pt-4" : ""}`}
      >
        <button
          type="button"
          className={`${addLink} inline-flex items-center gap-1.5`}
          aria-expanded={picking}
          onClick={() => setPicking((open) => !open)}
        >
          <Icon name="plus" />
          Add section
        </button>
        {picking ? (
          <div className={`absolute bottom-full left-0 z-(--z-popover) mb-2 w-60 animate-pop overflow-hidden ${popover}`}>
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
  contacts,
}: {
  section: ProfileSection;
  profile: ContactProfile;
  patch: (partial: Partial<ContactProfile>) => void;
  contacts?: Contact[];
}) {
  switch (section) {
    case "howWeMet":
      return (
        <ProseField
          value={profile.howWeMet ?? ""}
          placeholder="Where you met, who introduced you, what you talked about…"
          max={MAX_PROFILE_TEXT_CHARS}
          onChange={(howWeMet) => patch({ howWeMet })}
        />
      );
    case "interests":
      return (
        <ProfileTags
          rows={profile.interests}
          label={ADD_LABELS.interests}
          placeholder="e.g. Rock climbing"
          onChange={(interests) => patch({ interests })}
        />
      );
    case "music":
      return (
        <ProfileTags
          rows={profile.music}
          label={ADD_LABELS.music}
          placeholder="e.g. Talking Heads"
          onChange={(music) => patch({ music })}
        />
      );
    case "food":
      return <FoodTags rows={profile.food} onChange={(food) => patch({ food })} />;
    case "pets":
      return <PetRows rows={profile.pets} onChange={(pets) => patch({ pets })} />;
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
          contacts={contacts}
        />
      );
    case "friends":
      return (
        <PersonRows
          rows={profile.friends}
          addLabel={ADD_LABELS.friends}
          onChange={(friends) => patch({ friends })}
          contacts={contacts}
        />
      );
    case "colleagues":
      return (
        <PersonRows
          rows={profile.colleagues}
          addLabel={ADD_LABELS.colleagues}
          onChange={(colleagues) => patch({ colleagues })}
          contacts={contacts}
        />
      );
  }
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
      <PillInput
        label="Title"
        value={section.title}
        placeholder="Section title"
        ariaLabel="Section title"
        onChange={(title) => onChange({ title: title.slice(0, MAX_PROFILE_TEXT_CHARS) })}
      />
      <ProseField
        value={section.text}
        placeholder="Anything you want to keep under this heading…"
        max={MAX_PROFILE_TEXT_CHARS}
        onChange={(text) => onChange({ text })}
      />
    </div>
  );
}

function rowOps<T extends { id: string }>(rows: T[], onChange: (rows: T[]) => void) {
  return {
    update: (id: string, partial: Partial<T>) =>
      onChange(rows.map((row) => (row.id === id ? { ...row, ...partial } : row))),
    remove: (id: string) => onChange(rows.filter((row) => row.id !== id)),
  };
}

const capPlaceholder = `Up to ${MAX_PROFILE_ENTRIES} entries`;

function ProfileTags({
  rows,
  label,
  placeholder,
  onChange,
}: {
  rows: ContactTag[];
  label: string;
  placeholder: string;
  onChange: (rows: ContactTag[]) => void;
}) {
  return (
    <TagsInput
      values={rows}
      label={label}
      removeLabel={`Remove ${label.toLowerCase()}`}
      placeholder={placeholder}
      disabled={rows.length >= MAX_PROFILE_ENTRIES}
      disabledPlaceholder={capPlaceholder}
      onAdd={(value) => onChange([...rows, { id: crypto.randomUUID(), value }])}
      onRemove={(id) => onChange(rows.filter((row) => row.id !== id))}
    />
  );
}

/**
 * Likes and dislikes as two toned tag fields. An existing per-entry note rides
 * along unedited until that entry is removed; new entries carry none.
 */
function FoodTags({
  rows,
  onChange,
}: {
  rows: ContactFood[];
  onChange: (rows: ContactFood[]) => void;
}) {
  const atCap = rows.length >= MAX_PROFILE_ENTRIES;
  const groups: { polarity: ContactFoodPolarity; label: string; placeholder: string }[] = [
    { polarity: "like", label: "Likes", placeholder: "e.g. Coriander" },
    { polarity: "dislike", label: "Dislikes", placeholder: "e.g. Oysters" },
  ];
  return (
    <div className="grid min-w-0 gap-2">
      {groups.map(({ polarity, label, placeholder }) => (
        <div key={polarity} className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
          <span className={eyebrow}>{label}</span>
          <TagsInput
            values={rows.filter((row) => row.polarity === polarity)}
            tone={polarity}
            label={label}
            removeLabel={`Remove ${label.toLowerCase()}`}
            placeholder={placeholder}
            disabled={atCap}
            disabledPlaceholder={capPlaceholder}
            onAdd={(value) => onChange([...rows, { id: crypto.randomUUID(), polarity, value }])}
            onRemove={(id) => onChange(rows.filter((row) => row.id !== id))}
          />
        </div>
      ))}
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
    <EntryList>
      {rows.map((row) => (
        <EntryCard key={row.id} removeLabel="Remove pet" onRemove={() => list.remove(row.id)}>
          <FieldPair>
            <PillInput
              label="Name"
              value={row.name}
              ariaLabel="Pet name"
              onChange={(name) => list.update(row.id, { name })}
            />
            <PillInput
              label="Kind"
              value={row.species ?? ""}
              placeholder="Dog, cat, tortoise…"
              ariaLabel="Pet species"
              onChange={(species) => list.update(row.id, { species })}
            />
          </FieldPair>
          <PillInput
            label="Note"
            value={row.note ?? ""}
            placeholder="Optional"
            ariaLabel="Pet note"
            onChange={(note) => list.update(row.id, { note })}
          />
        </EntryCard>
      ))}
    </EntryList>
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
    <EntryList>
      <datalist id="relationship-kinds">
        {RELATIONSHIP_KINDS.map((kind) => (
          <option key={kind} value={kind} />
        ))}
      </datalist>
      {rows.map((row) => (
        <EntryCard key={row.id} removeLabel="Remove relationship" onRemove={() => list.remove(row.id)}>
          <FieldPair>
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
              listId="relationship-kinds"
              onChange={(kind) => list.update(row.id, { kind })}
            />
          </FieldPair>
          <DateRange
            start={row.start}
            end={row.end}
            current={row.current}
            currentLabel="Current partner"
            onChange={(range) => list.update(row.id, range)}
          />
          <PillInput
            label="Note"
            value={row.note ?? ""}
            placeholder="Optional"
            ariaLabel="Relationship note"
            onChange={(note) => list.update(row.id, { note })}
          />
        </EntryCard>
      ))}
    </EntryList>
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
    <EntryList>
      {rows.map((row) => (
        <EntryCard key={row.id} removeLabel="Remove life event" onRemove={() => list.remove(row.id)}>
          <PillInput
            label="Event"
            value={row.title}
            placeholder="What happened"
            ariaLabel="Life event"
            onChange={(title) => list.update(row.id, { title })}
          />
          <PartialDateInput
            label="When"
            value={row.date ?? ""}
            onChange={(date) => list.update(row.id, { date })}
          />
          <textarea
            value={row.description ?? ""}
            onChange={(e) => list.update(row.id, { description: e.target.value })}
            placeholder="Description (optional)"
            aria-label="Life event description"
            rows={2}
            className={`${fieldBase} h-auto min-h-[4rem] resize-y py-2.5 leading-relaxed`}
          />
        </EntryCard>
      ))}
    </EntryList>
  );
}

function PersonRows({
  rows,
  showRelation = false,
  addLabel,
  onChange,
  contacts,
}: {
  rows: ContactPerson[];
  showRelation?: boolean;
  addLabel: string;
  onChange: (rows: ContactPerson[]) => void;
  contacts?: Contact[];
}) {
  const list = rowOps(rows, onChange);
  return (
    <EntryList>
      {rows.map((row) => {
        const linked = row.contactId ? contacts?.find((c) => c.id === row.contactId) : undefined;
        if (row.contactId) {
          return (
            <EntryCard
              key={row.id}
              label={`Linked ${addLabel.toLowerCase()}`}
              removeLabel={`Remove ${addLabel.toLowerCase()}`}
              onRemove={() => list.remove(row.id)}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar name={linked?.name ?? row.name} avatar={linked?.avatar} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">
                  {linked?.name ?? row.name}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-accent-dim/50 bg-accent/10 px-2 text-2xs font-medium leading-[18px] text-accent">
                  <Icon name="link" className="h-3.5 w-3.5 shrink-0" />
                  Linked
                </span>
              </div>
              {showRelation ? (
                <PillInput
                  label="Relation"
                  value={row.relation ?? ""}
                  placeholder="Mother, brother, nephew…"
                  ariaLabel="Relation"
                  onChange={(relation) => list.update(row.id, { relation })}
                />
              ) : null}
              <PillInput
                label="Note"
                value={row.note ?? ""}
                placeholder="Optional"
                ariaLabel={`${addLabel} note`}
                onChange={(note) => list.update(row.id, { note })}
              />
            </EntryCard>
          );
        }
        return (
        <EntryCard
          key={row.id}
          removeLabel={`Remove ${addLabel.toLowerCase()}`}
          onRemove={() => list.remove(row.id)}
        >
          <div className={showRelation ? "grid min-w-0 gap-2 sm:grid-cols-2" : "grid min-w-0"}>
            <PillInput
              label="Name"
              value={row.name}
              ariaLabel={`${addLabel} name`}
              onChange={(name) => list.update(row.id, { name })}
            />
            {showRelation ? (
              <PillInput
                label="Relation"
                value={row.relation ?? ""}
                placeholder="Mother, brother, nephew…"
                ariaLabel="Relation"
                onChange={(relation) => list.update(row.id, { relation })}
              />
            ) : null}
          </div>
          <PillInput
            label="Note"
            value={row.note ?? ""}
            placeholder="Optional"
            ariaLabel={`${addLabel} note`}
            onChange={(note) => list.update(row.id, { note })}
          />
        </EntryCard>
        );
      })}
    </EntryList>
  );
}

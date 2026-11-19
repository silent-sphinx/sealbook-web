import {
  PROFILE_SECTION_LABELS,
  customSectionIsEmpty,
  filledSections,
  formatDateRange,
  formatPartialDate,
  lifeEventOrder,
  profileOf,
  type LinkableSection,
  type ProfileSection,
} from "../lib/contactProfile";
import type { Contact, ContactPerson, ContactProfile } from "../lib/types";
import { Avatar } from "./ContactCard";
import { ChipList, EntryRow, PaneSection, ProseBlock, RowAction } from "./PaneControls";
import { Icon } from "./Icon";
import { focusRing } from "../lib/styles";

export type LinkProfileProps = {
  contacts?: Contact[];
  readOnly?: boolean;
  onNavigateToContact?: (contact: Contact) => void;
  onLinkInSection?: (section: LinkableSection) => void;
  onUnlinkFromSection?: (section: LinkableSection, contactId: string) => void;
};

const PEOPLE: LinkableSection[] = ["family", "friends", "colleagues"];

/** Whether `ContactProfileView` would render anything for this part. */
export function profileViewHasContent(
  part: "about" | "people",
  profile?: ContactProfile,
  linkProps?: LinkProfileProps,
): boolean {
  const full = profileOf(profile);
  if (part === "people") {
    const canLink = !linkProps?.readOnly && !!linkProps?.onLinkInSection;
    return canLink || PEOPLE.some((section) => full[section].length > 0);
  }
  return (
    filledSections(full).some((section) => !PEOPLE.includes(section as LinkableSection)) ||
    full.custom.some((section) => !customSectionIsEmpty(section))
  );
}

/**
 * The relationship sections, read-only. `about` is what the contact is like,
 * `people` is who they are connected to. Empty sections are not rendered, so a
 * contact with nothing extra looks as it did before detailed mode existed.
 */
export function ContactProfileView({
  part,
  profile,
  linkProps,
}: {
  part: "about" | "people";
  profile?: ContactProfile;
  linkProps?: LinkProfileProps;
}) {
  const full = profileOf(profile);

  if (part === "people") {
    const canLink = !linkProps?.readOnly && !!linkProps?.onLinkInSection;
    return (
      <>
        {PEOPLE.filter((section) => canLink || full[section].length > 0).map((section) => (
          <PaneSection key={section} title={PROFILE_SECTION_LABELS[section]}>
            <PersonList
              items={full[section]}
              section={section}
              showRelation={section === "family"}
              linkProps={linkProps}
            />
          </PaneSection>
        ))}
      </>
    );
  }

  const sections = filledSections(full).filter(
    (section) => !PEOPLE.includes(section as LinkableSection),
  );
  const custom = full.custom.filter((section) => !customSectionIsEmpty(section));
  return (
    <>
      {sections.map((section) => (
        <PaneSection key={section} title={PROFILE_SECTION_LABELS[section]}>
          <SectionBody section={section} profile={full} />
        </PaneSection>
      ))}
      {custom.map((section) => (
        <PaneSection key={section.id} title={section.title || "Custom section"}>
          <ProseBlock text={section.text} />
        </PaneSection>
      ))}
    </>
  );
}

function PersonList({
  items,
  section,
  showRelation,
  linkProps,
}: {
  items: ContactPerson[];
  section: LinkableSection;
  showRelation: boolean;
  linkProps?: LinkProfileProps;
}) {
  return (
    <div>
      {items.map((item) => {
        const linked = item.contactId
          ? linkProps?.contacts?.find((c) => c.id === item.contactId)
          : undefined;
        const name = linked?.name ?? item.name;
        const onNavigate = linkProps?.onNavigateToContact;
        const onUnlink =
          !linkProps?.readOnly && item.contactId && linkProps?.onUnlinkFromSection
            ? () => linkProps.onUnlinkFromSection!(section, item.contactId!)
            : undefined;
        return (
          <EntryRow
            key={item.id}
            leading={<Avatar name={name || "?"} avatar={linked?.avatar} size="sm" />}
            title={
              linked && onNavigate ? (
                <button
                  type="button"
                  className={`min-w-0 truncate text-left font-medium text-text transition-colors hover:text-accent ${focusRing}`}
                  onClick={() => onNavigate(linked)}
                >
                  {name}
                </button>
              ) : (
                name
              )
            }
            inlineMeta={showRelation ? item.relation : undefined}
            note={item.note}
            action={
              onUnlink ? (
                <button
                  type="button"
                  className={`rounded-md px-2 py-1 text-2xs font-medium text-mute transition-colors hover:bg-danger/10 hover:text-danger ${focusRing}`}
                  title="Remove link"
                  onClick={onUnlink}
                >
                  Unlink
                </button>
              ) : undefined
            }
          />
        );
      })}
      {!linkProps?.readOnly && linkProps?.onLinkInSection ? (
        <RowAction
          icon={<Icon name="link" className="h-3.5 w-3.5 shrink-0" />}
          label="Link a contact"
          onClick={() => linkProps.onLinkInSection!(section)}
        />
      ) : null}
    </div>
  );
}

function SectionBody({ section, profile }: { section: ProfileSection; profile: ContactProfile }) {
  switch (section) {
    case "howWeMet":
      return <ProseBlock text={profile.howWeMet ?? ""} />;
    case "interests":
      return <ChipList groups={[{ tone: "neutral", values: profile.interests.map((i) => i.value) }]} />;
    case "music":
      return <ChipList groups={[{ tone: "neutral", values: profile.music.map((i) => i.value) }]} />;
    case "food":
      return (
        <ChipList
          groups={[
            {
              tone: "like",
              values: profile.food.filter((i) => i.polarity !== "dislike").map((i) => i.value),
            },
            {
              tone: "dislike",
              values: profile.food.filter((i) => i.polarity === "dislike").map((i) => i.value),
            },
          ]}
        />
      );
    case "pets":
      return (
        <div>
          {profile.pets.map((item) => (
            <EntryRow key={item.id} title={item.name} inlineMeta={item.species} note={item.note} />
          ))}
        </div>
      );
    case "relationships":
      return (
        <div>
          {profile.relationships.map((item) => (
            <EntryRow
              key={item.id}
              title={item.name}
              inlineMeta={item.kind || undefined}
              badge={item.current ? "Current" : undefined}
              trailingMeta={formatDateRange(item.start, item.end) || undefined}
              note={item.note}
            />
          ))}
        </div>
      );
    case "timeline":
      return <Timeline profile={profile} />;
    case "family":
    case "friends":
    case "colleagues":
      return null;
  }
}

/**
 * Oldest first so the column reads downwards in time. Ordering is by a parsed
 * chronological key rather than the raw string, so a month/year lands in its
 * month instead of below the full dates. Entries with no readable date keep
 * their entry order at the end; the sort is stable, so equal keys do too.
 */
function Timeline({ profile }: { profile: ContactProfile }) {
  const ordered = [...profile.timeline]
    .map((item) => ({ item, key: lifeEventOrder(item.date) }))
    .sort((a, b) => {
      if (a.key === null) return b.key === null ? 0 : 1;
      if (b.key === null) return -1;
      return a.key - b.key;
    })
    .map((entry) => entry.item);
  return (
    <ol className="relative mx-5 space-y-3 border-l border-line/70 py-3 pl-4">
      {ordered.map((item) => (
        <li key={item.id} className="relative">
          <span
            aria-hidden="true"
            className="absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full border border-accent-dim bg-accent/40"
          />
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 text-sm font-medium text-text">{item.title}</p>
            {item.date ? (
              <p className="shrink-0 text-2xs uppercase tracking-wider text-mute/80">
                {formatPartialDate(item.date)}
              </p>
            ) : null}
          </div>
          {item.description ? (
            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-mute">
              {item.description}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

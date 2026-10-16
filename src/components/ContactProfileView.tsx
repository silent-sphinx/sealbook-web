import type { ReactNode } from "react";

import {
  PROFILE_SECTION_LABELS,
  customSectionIsEmpty,
  filledSections,
  formatDateRange,
  formatPartialDate,
  lifeEventOrder,
  profileOf,
  type ProfileSection,
} from "../lib/contactProfile";
import type { Contact, ContactPerson, ContactProfile } from "../lib/types";
import { Avatar } from "./ContactCard";
import { focusRing } from "../lib/styles";

const row = "border-b border-line/60 px-5 py-3 text-sm";
const chip = "rounded-md border border-line bg-bg/50 px-2.5 py-1 text-xs text-text";
const badge =
  "ml-2 rounded-md border border-accent-dim/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent";

export type LinkProfileProps = {
  contacts?: Contact[];
  readOnly?: boolean;
  onNavigateToContact?: (contact: Contact) => void;
  onLinkInSection?: (section: "family" | "friends") => void;
  onUnlinkFromSection?: (section: "family" | "friends", contactId: string) => void;
};

/**
 * The relationship sections, read-only. Empty sections are not rendered at all,
 * so a contact with nothing extra looks exactly as it did before detailed mode
 * existed.
 */
export function ContactProfileView({
  profile,
  linkProps,
}: {
  profile?: ContactProfile;
  linkProps?: LinkProfileProps;
}) {
  const full = profileOf(profile);
  const sections = filledSections(full);
  const custom = full.custom.filter((section) => !customSectionIsEmpty(section));

  const hasFamily =
    full.family.length > 0 || (!linkProps?.readOnly && !!linkProps?.onLinkInSection);
  const hasFriends =
    full.friends.length > 0 || (!linkProps?.readOnly && !!linkProps?.onLinkInSection);

  const shownSections = sections.filter((s) => s !== "family" && s !== "friends");

  if (shownSections.length === 0 && custom.length === 0 && !hasFamily && !hasFriends) {
    return null;
  }

  return (
    <>
      {shownSections.map((section) => (
        <Section key={section} title={PROFILE_SECTION_LABELS[section]}>
          <SectionBody section={section} profile={full} />
        </Section>
      ))}

      {hasFamily ? (
        <Section title={PROFILE_SECTION_LABELS.family}>
          <PersonList
            items={full.family}
            section="family"
            showRelation
            linkProps={linkProps}
          />
        </Section>
      ) : null}

      {hasFriends ? (
        <Section title={PROFILE_SECTION_LABELS.friends}>
          <PersonList
            items={full.friends}
            section="friends"
            showRelation={false}
            linkProps={linkProps}
          />
        </Section>
      ) : null}

      {custom.map((section) => (
        <Section key={section.id} title={section.title || "Custom section"}>
          <div className={`${row} leading-relaxed whitespace-pre-wrap`}>{section.text}</div>
        </Section>
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
  section: "family" | "friends";
  showRelation: boolean;
  linkProps?: LinkProfileProps;
}) {
  return (
    <div>
      {items.map((item) => (
        <PersonRow
          key={item.id}
          item={item}
          showRelation={showRelation}
          contacts={linkProps?.contacts}
          onNavigate={linkProps?.onNavigateToContact}
          onUnlink={
            !linkProps?.readOnly && item.contactId && linkProps?.onUnlinkFromSection
              ? (cid) => linkProps.onUnlinkFromSection!(section, cid)
              : undefined
          }
        />
      ))}
      {!linkProps?.readOnly && linkProps?.onLinkInSection ? (
        <button
          type="button"
          className={`flex w-full items-center gap-2 border-b border-line/60 px-5 py-2.5 text-xs text-mute transition-colors hover:bg-surface/40 hover:text-accent ${focusRing}`}
          onClick={() => linkProps.onLinkInSection!(section)}
        >
          <LinkIcon />
          Link a contact
        </button>
      ) : null}
    </div>
  );
}

function PersonRow({
  item,
  showRelation,
  contacts,
  onNavigate,
  onUnlink,
}: {
  item: ContactPerson;
  showRelation: boolean;
  contacts?: Contact[];
  onNavigate?: (contact: Contact) => void;
  onUnlink?: (contactId: string) => void;
}) {
  const linked = item.contactId ? contacts?.find((c) => c.id === item.contactId) : undefined;
  const displayName = linked?.name ?? item.name;

  return (
    <div className={`${row} flex items-center gap-3`}>
      {item.contactId ? (
        <Avatar name={displayName} avatar={linked?.avatar} size="sm" />
      ) : null}
      <div className="min-w-0 flex-1">
        {linked && onNavigate ? (
          <button
            type="button"
            className={`min-w-0 truncate text-left font-medium text-text transition-colors hover:text-accent ${focusRing}`}
            onClick={() => onNavigate(linked)}
          >
            {displayName}
          </button>
        ) : (
          <p className="font-medium text-text">
            {displayName}
          </p>
        )}
        {showRelation && item.relation ? (
          <p className="mt-0.5 text-xs text-mute">{item.relation}</p>
        ) : null}
        {item.note ? (
          <p className="mt-1 text-xs leading-relaxed text-mute whitespace-pre-wrap">{item.note}</p>
        ) : null}
      </div>
      {onUnlink && item.contactId ? (
        <button
          type="button"
          className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-mute transition-colors hover:bg-danger/10 hover:text-danger ${focusRing}`}
          title="Remove link"
          onClick={() => onUnlink(item.contactId!)}
        >
          Unlink
        </button>
      ) : null}
    </div>
  );
}

function SectionBody({
  section,
  profile,
}: {
  section: ProfileSection;
  profile: ContactProfile;
}) {
  switch (section) {
    case "howWeMet":
      return (
        <div className={`${row} leading-relaxed whitespace-pre-wrap`}>{profile.howWeMet}</div>
      );
    case "interests":
      return <Chips values={profile.interests.map((item) => item.value)} />;
    case "music":
      return <Chips values={profile.music.map((item) => item.value)} />;
    case "food":
      return (
        <Rows>
          {profile.food.map((item) => (
            <div key={item.id} className={row}>
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 text-xs uppercase tracking-wider text-mute/80 font-medium">
                  {item.polarity === "dislike" ? "Dislikes" : "Likes"}
                </span>
                <span className="min-w-0 font-medium text-text">{item.value}</span>
              </div>
              <Note text={item.note} />
            </div>
          ))}
        </Rows>
      );
    case "pets":
      return (
        <Rows>
          {profile.pets.map((item) => (
            <div key={item.id} className={row}>
              <p className="font-medium text-text">
                {item.name}
                {item.species ? (
                  <span className="ml-2 text-xs font-normal text-mute">{item.species}</span>
                ) : null}
              </p>
              <Note text={item.note} />
            </div>
          ))}
        </Rows>
      );
    case "career":
      return (
        <Rows>
          {profile.career.map((item) => (
            <div key={item.id} className={row}>
              <p className="font-medium text-text">{item.organization || item.title}</p>
              {item.organization && item.title ? (
                <p className="mt-0.5 text-xs text-mute">{item.title}</p>
              ) : null}
              <Period label={formatDateRange(item.start, item.end)} />
              <Note text={item.note} />
            </div>
          ))}
        </Rows>
      );
    case "relationships":
      return (
        <Rows>
          {profile.relationships.map((item) => (
            <div key={item.id} className={row}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 font-medium text-text">
                  {item.name}
                  {item.kind ? (
                    <span className="ml-2 text-xs font-normal text-mute">{item.kind}</span>
                  ) : null}
                  {item.current ? <span className={badge}>Current</span> : null}
                </p>
                {formatDateRange(item.start, item.end) ? (
                  <p className="shrink-0 text-[11px] uppercase tracking-wider text-mute/80">
                    {formatDateRange(item.start, item.end)}
                  </p>
                ) : null}
              </div>
              <Note text={item.note} />
            </div>
          ))}
        </Rows>
      );
    case "timeline":
      return <Timeline profile={profile} />;
    case "family":
    case "friends":
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
          <p className="text-sm font-medium text-text">{item.title}</p>
          {item.date ? (
            <p className="mt-0.5 text-[11px] uppercase tracking-wider text-mute/80">
              {formatPartialDate(item.date)}
            </p>
          ) : null}
          {item.description ? (
            <p className="mt-1 text-xs leading-relaxed text-mute whitespace-pre-wrap">
              {item.description}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}

function Chips({ values }: { values: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 border-b border-line/60 px-5 py-3">
      {values.map((value, index) => (
        <span key={`${value}-${index}`} className={chip}>
          {value}
        </span>
      ))}
    </div>
  );
}

function Period({ label }: { label: string }) {
  if (!label) return null;
  return <p className="mt-0.5 text-[11px] uppercase tracking-wider text-mute/80">{label}</p>;
}

function Note({ text }: { text?: string }) {
  if (!text) return null;
  return <p className="mt-1 text-xs leading-relaxed text-mute whitespace-pre-wrap">{text}</p>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="break-inside-avoid">
      <h4 className="sticky top-0 z-10 border-b border-line/60 bg-surface/80 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-mute backdrop-blur-sm">
        {title}
      </h4>
      {children}
    </section>
  );
}

function LinkIcon() {
  return (
    <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

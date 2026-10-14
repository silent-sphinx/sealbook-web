import type { ReactNode } from "react";

import {
  PROFILE_SECTION_LABELS,
  filledSections,
  formatDateRange,
  formatPartialDate,
  profileOf,
  type ProfileSection,
} from "../lib/contactProfile";
import type { ContactProfile } from "../lib/types";

const row = "border-b border-line/60 px-5 py-3 text-sm";
const chip = "rounded-md border border-line bg-bg/50 px-2.5 py-1 text-xs text-text";

/**
 * The relationship sections, read-only. Empty sections are not rendered at all,
 * so a contact with nothing extra looks exactly as it did before detailed mode
 * existed.
 */
export function ContactProfileView({ profile }: { profile?: ContactProfile }) {
  const full = profileOf(profile);
  const sections = filledSections(full);
  if (sections.length === 0) {
    return null;
  }
  return (
    <>
      {sections.map((section) => (
        <Section key={section} title={PROFILE_SECTION_LABELS[section]}>
          <SectionBody section={section} profile={full} />
        </Section>
      ))}
    </>
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
              <p className="font-medium text-text">
                {item.name}
                {item.kind ? (
                  <span className="ml-2 text-xs font-normal text-mute">{item.kind}</span>
                ) : null}
              </p>
              <Period label={formatDateRange(item.start, item.end)} />
              <Note text={item.note} />
            </div>
          ))}
        </Rows>
      );
    case "timeline":
      return <Timeline profile={profile} />;
    case "family":
      return (
        <Rows>
          {profile.family.map((item) => (
            <div key={item.id} className={row}>
              <p className="font-medium text-text">
                {item.name}
                {item.relation ? (
                  <span className="ml-2 text-xs font-normal text-mute">{item.relation}</span>
                ) : null}
              </p>
              <Note text={item.note} />
            </div>
          ))}
        </Rows>
      );
    case "friends":
      return (
        <Rows>
          {profile.friends.map((item) => (
            <div key={item.id} className={row}>
              <p className="font-medium text-text">{item.name}</p>
              <Note text={item.note} />
            </div>
          ))}
        </Rows>
      );
  }
}

/**
 * Dated events first, newest last so the column reads downwards in time; undated
 * ones keep their entry order at the end rather than being dropped.
 */
function Timeline({ profile }: { profile: ContactProfile }) {
  const dated = profile.timeline.filter((item) => item.date);
  const undated = profile.timeline.filter((item) => !item.date);
  const ordered = [
    ...[...dated].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")),
    ...undated,
  ];
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

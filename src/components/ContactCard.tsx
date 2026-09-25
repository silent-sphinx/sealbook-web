import { useState } from "react";
import type { Contact } from "../lib/types";

export function ContactCard({
  contact,
  bookName,
  onSelect,
}: {
  contact: Contact;
  bookName?: string;
  onSelect?: (contact: Contact) => void;
}) {
  const subtitle =
    contact.work[0]?.organization ||
    contact.email ||
    contact.phones[0]?.value;

  return (
    <li
      className="group flex items-center gap-3 overflow-hidden border-b border-line/80 transition-colors duration-150 last:border-b-0 hover:bg-surface/60"
    >
      <button
        type="button"
        aria-label={`View ${contact.name}`}
        onClick={() => onSelect?.(contact)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-4 py-3 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent-ring"
      >
        <Avatar name={contact.name} avatar={contact.avatar} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium tracking-tight text-text">
            {contact.name}
            {contact.nickname ? (
              <span className="ml-1.5 font-normal text-xs text-mute">
                "{contact.nickname}"
              </span>
            ) : null}
          </p>
          {subtitle ? (
            <p className="mt-0.5 truncate text-xs text-mute">{subtitle}</p>
          ) : null}
        </div>

        {bookName ? (
          <span className="max-w-[35%] shrink-0 truncate rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-mute">
            {bookName}
          </span>
        ) : null}
      </button>

    </li>
  );
}

export function Avatar({
  name,
  avatar,
  size = "md",
}: {
  name: string;
  avatar?: string;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const [imgError, setImgError] = useState(false);

  const sizeClasses =
    size === "xl"
      ? "h-20 w-20 text-2xl font-bold"
      : size === "lg"
        ? "h-14 w-14 text-lg font-bold"
        : size === "sm"
          ? "h-7 w-7 text-xs font-semibold"
          : "h-9 w-9 text-xs font-semibold";

  if (avatar && !imgError) {
    return (
      <img
        src={avatar}
        alt={name}
        onError={() => setImgError(true)}
        className={`shrink-0 rounded-full object-cover border border-line/60 bg-surface/50 ${sizeClasses}`}
      />
    );
  }

  return <Initials name={name} size={size === "xl" ? "lg" : size} />;
}

export function Initials({
  name,
  size = "md",
}: {
  name: string;
  size?: "sm" | "md" | "lg";
}) {
  const parts = name.trim().split(/\s+/u);
  const text =
    parts.length >= 2
      ? (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
      : (name[0] ?? "?").toUpperCase();

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;

  const sizeClasses =
    size === "lg"
      ? "h-14 w-14 text-lg font-bold"
      : size === "sm"
        ? "h-7 w-7 text-xs font-semibold"
        : "h-9 w-9 text-xs font-semibold";

  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full ${sizeClasses}`}
      style={{
        background: `hsl(${hue} 30% 25%)`,
        color: `hsl(${hue} 40% 75%)`,
      }}
    >
      {text}
    </span>
  );
}

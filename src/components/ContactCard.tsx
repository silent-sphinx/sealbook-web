import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { safeImageSrc } from "../lib/image";
import { tonePill } from "../lib/styles";
import type { Contact } from "../lib/types";

export function ContactCard({
  contact,
  bookName,
  bookTone,
  selected = false,
  onSelect,
  onContextMenu,
}: {
  contact: Contact;
  bookName?: string;
  bookTone?: string;
  selected?: boolean;
  onSelect?: (contact: Contact) => void;
  onContextMenu?: (event: ReactMouseEvent, contact: Contact) => void;
}) {
  const subtitle =
    contact.work[0]?.organization ||
    contact.email ||
    contact.phones[0]?.value;

  return (
    <li
      className={`group flex items-center gap-3 border-b border-line/60 transition-colors duration-150 ${selected ? "bg-surface/70" : "hover:bg-surface/40"}`}
    >
      <button
        type="button"
        aria-label={`View ${contact.name}`}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect?.(contact)}
        onContextMenu={(event) => onContextMenu?.(event, contact)}
        className={`flex min-w-0 flex-1 items-center gap-3 border-l-2 px-4 py-2.5 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ring sm:px-5 lg:px-6 ${selected ? "border-accent" : "border-transparent"}`}
      >
        <Avatar name={contact.name} avatar={contact.avatar} />
        <div className="min-w-0 flex-1">
          <p className={`truncate font-medium tracking-tight ${selected ? "text-accent" : "text-text"}`}>
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
          <span
            className="max-w-[35%] shrink-0 truncate rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-mute"
            style={bookTone ? tonePill(bookTone) : undefined}
            title={bookName}
          >
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
  pixelSize,
}: {
  name: string;
  avatar?: string;
  size?: "sm" | "md" | "lg" | "xl";
  /** Continuous size in px, overriding `size`'s fixed steps. */
  pixelSize?: number;
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

  const pixelStyle = pixelSize
    ? { width: pixelSize, height: pixelSize, fontSize: pixelSize * 0.4 }
    : undefined;

  const avatarSrc = safeImageSrc(avatar);
  if (avatarSrc && !imgError) {
    return (
      <img
        src={avatarSrc}
        alt={name}
        draggable={false}
        onError={() => setImgError(true)}
        style={pixelStyle}
        className={`shrink-0 rounded-full object-cover border border-line/60 bg-surface/50 ${pixelSize ? "" : sizeClasses}`}
      />
    );
  }

  return <Initials name={name} size={size === "xl" ? "lg" : size} pixelSize={pixelSize} />;
}

export function Initials({
  name,
  size = "md",
  pixelSize,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  /** Continuous size in px, overriding `size`'s fixed steps. */
  pixelSize?: number;
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

  const pixelStyle = pixelSize
    ? { width: pixelSize, height: pixelSize, fontSize: pixelSize * 0.4 }
    : undefined;

  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full ${pixelSize ? "" : sizeClasses}`}
      style={{
        background: `hsl(${hue} 30% 25%)`,
        color: `hsl(${hue} 40% 75%)`,
        ...pixelStyle,
      }}
    >
      {text}
    </span>
  );
}

/**
 * Placeholder rows shown while the vault is still being fetched and decrypted.
 * Argon2 makes that wait long enough that an empty list would otherwise read as
 * "you have no contacts".
 */
export function ContactListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <ul className="min-w-0" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <li
          key={index}
          className="flex items-center gap-3 border-b border-line/60 px-4 py-2.5 sm:px-5 lg:px-6"
        >
          <span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-surface" />
          <div className="min-w-0 flex-1 space-y-2">
            <span
              className="block h-3.5 animate-pulse rounded bg-surface"
              style={{ width: `${38 + ((index * 17) % 30)}%` }}
            />
            <span
              className="block h-2.5 animate-pulse rounded bg-surface/70"
              style={{ width: `${26 + ((index * 23) % 26)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

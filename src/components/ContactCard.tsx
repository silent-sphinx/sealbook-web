import { useState } from "react";
import type { Contact } from "../lib/types";

export function ContactCard({
  contact,
  bookName,
  onSelect,
  onEdit,
  onDelete,
}: {
  contact: Contact;
  bookName?: string;
  onSelect?: (contact: Contact) => void;
  onEdit?: (contact: Contact) => void;
  onDelete?: (contact: Contact) => void;
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

      {onEdit || onDelete ? (
        <div className="pointer-events-none flex max-w-0 shrink-0 self-stretch items-stretch justify-end overflow-hidden opacity-0 transition-[max-width,opacity] duration-200 group-hover:pointer-events-auto group-hover:max-w-[5.5rem] group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:max-w-[5.5rem] group-focus-within:opacity-100">
          {onEdit ? (
            <button
              type="button"
              aria-label={`Edit ${contact.name}`}
              title="Edit contact"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(contact);
              }}
              className="flex h-full w-14 items-center justify-center bg-yellow-400/15 text-yellow-300 transition-colors duration-150 hover:bg-yellow-400/25 active:brightness-125 cursor-pointer"
            >
              <EditIcon className="h-4 w-4" />
            </button>
          ) : null}

          {onDelete ? (
            <button
              type="button"
              aria-label={`Delete ${contact.name}`}
              title="Delete contact"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(contact);
              }}
              className="flex h-full w-14 items-center justify-center bg-danger/15 text-danger transition-colors duration-150 hover:bg-danger/25 active:brightness-125 cursor-pointer"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      ) : null}
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

function EditIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" />
      <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0 0 10 3H4.75A2.75 2.75 0 0 0 2 5.75v9.5A2.75 2.75 0 0 0 4.75 18h9.5A2.75 2.75 0 0 0 17 15.25V10a.75.75 0 0 0-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5Z" />
    </svg>
  );
}

function TrashIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

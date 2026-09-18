import type { Contact } from "../lib/types";

export function ContactCard({
  contact,
  bookName,
}: {
  contact: Contact;
  bookName?: string;
}) {
  return (
    <li className="flex items-center gap-3 py-3">
      <Initials name={contact.name} />
      <p className="min-w-0 flex-1 truncate font-medium tracking-tight">{contact.name}</p>
      {bookName ? (
        <p className="max-w-[40%] shrink-0 truncate text-xs text-mute">{bookName}</p>
      ) : null}
    </li>
  );
}

function Initials({ name }: { name: string }) {
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

  return (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
      style={{
        background: `hsl(${hue} 30% 25%)`,
        color: `hsl(${hue} 40% 75%)`,
      }}
    >
      {text}
    </span>
  );
}

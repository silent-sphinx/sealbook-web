import type { ReactNode } from "react";
import { addressLines, channelKindLabel } from "../lib/contact";
import { btnPrimary, btnSecondary, sectionBar } from "../lib/styles";
import type { Contact } from "../lib/types";
import { Initials } from "./ContactCard";
import { Modal } from "./Modal";

type Props = {
  contact: Contact;
  bookName?: string;
  onEdit: () => void;
  onDelete?: () => void;
  onClose: () => void;
};

export function ContactDetailModal({
  contact,
  bookName,
  onEdit,
  onDelete,
  onClose,
}: Props) {
  const addresses = addressLines(contact.address);

  return (
    <Modal title={contact.name} onClose={onClose}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 space-y-5">
          {/* Header identity card */}
          <div className="flex items-center gap-4 rounded-xl border border-line bg-surface/40 p-4">
            <Initials name={contact.name} size="lg" />
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-lg font-semibold tracking-tight text-text">
                {contact.name}
              </h3>
              {contact.nickname ? (
                <p className="text-sm text-mute">"{contact.nickname}"</p>
              ) : null}
              {bookName ? (
                <span className="mt-1.5 inline-block rounded-full bg-surface border border-line px-2.5 py-0.5 text-xs text-mute font-medium">
                  {bookName}
                </span>
              ) : null}
            </div>
          </div>

          {/* Emails */}
          {contact.emails.length > 0 ? (
            <Section title="Emails">
              <div className="space-y-2">
                {contact.emails.map((e) => (
                  <a
                    key={e.id}
                    href={`mailto:${e.value}`}
                    className="group flex items-center justify-between gap-3 rounded-lg border border-line/70 bg-bg/50 px-3.5 py-2.5 text-sm transition-colors hover:border-accent-dim hover:bg-surface/50"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="text-xs uppercase tracking-wider text-mute/80 font-medium mr-2">
                        {channelKindLabel(e.kind, e.label)}
                      </span>
                      <span className="font-medium text-text group-hover:text-accent transition-colors">
                        {e.value}
                      </span>
                    </div>
                    <svg
                      className="h-4 w-4 shrink-0 text-mute group-hover:text-accent transition-colors"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path d="M3 4a2 2 0 0 0-2 2v1.161l8.441 4.221a1.25 1.25 0 0 0 1.118 0L19 7.162V6a2 2 0 0 0-2-2H3Z" />
                      <path d="m19 8.839-7.77 3.885a2.75 2.75 0 0 1-2.46 0L1 8.839V14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.839Z" />
                    </svg>
                  </a>
                ))}
              </div>
            </Section>
          ) : null}

          {/* Phones */}
          {contact.phones.length > 0 ? (
            <Section title="Phones">
              <div className="space-y-2">
                {contact.phones.map((p) => (
                  <a
                    key={p.id}
                    href={`tel:${p.value}`}
                    className="group flex items-center justify-between gap-3 rounded-lg border border-line/70 bg-bg/50 px-3.5 py-2.5 text-sm transition-colors hover:border-accent-dim hover:bg-surface/50"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="text-xs uppercase tracking-wider text-mute/80 font-medium mr-2">
                        {channelKindLabel(p.kind, p.label)}
                      </span>
                      <span className="font-medium text-text group-hover:text-accent transition-colors">
                        {p.value}
                      </span>
                    </div>
                    <svg
                      className="h-4 w-4 shrink-0 text-mute group-hover:text-accent transition-colors"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M2 3.5A1.5 1.5 0 0 1 3.5 2h1.148a1.5 1.5 0 0 1 1.465 1.175l.716 3.223a1.5 1.5 0 0 1-1.052 1.767l-.933.267c-.41.117-.643.555-.48.95a11.542 11.542 0 0 0 6.254 6.254c.395.163.833-.07.95-.48l.267-.933a1.5 1.5 0 0 1 1.767-1.052l3.223.716A1.5 1.5 0 0 1 18 15.352V16.5a1.5 1.5 0 0 1-1.5 1.5H15c-1.149 0-2.263-.15-3.326-.43A13.022 13.022 0 0 1 2.43 8.326 13.019 13.019 0 0 1 2 5V3.5Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </a>
                ))}
              </div>
            </Section>
          ) : null}

          {/* Work */}
          {contact.work.length > 0 ? (
            <Section title="Work">
              <div className="space-y-2">
                {contact.work.map((w) => (
                  <div
                    key={w.id}
                    className="rounded-lg border border-line/70 bg-bg/50 px-3.5 py-2.5 text-sm"
                  >
                    <p className="font-medium text-text">{w.organization}</p>
                    {w.title ? (
                      <p className="text-xs text-mute mt-0.5">{w.title}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          {/* Address */}
          {addresses.length > 0 ? (
            <Section title="Address">
              <div className="rounded-lg border border-line/70 bg-bg/50 px-3.5 py-2.5 text-sm leading-relaxed text-text">
                {addresses.map((line, idx) => (
                  <p key={idx}>{line}</p>
                ))}
              </div>
            </Section>
          ) : null}
        </div>

        {/* Footer actions */}
        <div className="shrink-0 border-t border-line bg-panel">
          <div className="flex items-center justify-between gap-3 px-5 py-4">
            {onDelete ? (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-danger/80 transition-colors hover:bg-danger/10 hover:text-danger active:scale-[0.98] cursor-pointer"
                onClick={onDelete}
              >
                <svg
                  className="h-4 w-4"
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
                Delete
              </button>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                className={btnSecondary}
                onClick={onClose}
              >
                Close
              </button>
              <button
                type="button"
                className={btnPrimary}
                onClick={onEdit}
              >
                <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" />
                  <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0 0 10 3H4.75A2.75 2.75 0 0 0 2 5.75v9.5A2.75 2.75 0 0 0 4.75 18h9.5A2.75 2.75 0 0 0 17 15.25V10a.75.75 0 0 0-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5Z" />
                </svg>
                <span>Edit contact</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h4
        className={`mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-mute ${sectionBar}`}
      >
        {title}
      </h4>
      {children}
    </section>
  );
}

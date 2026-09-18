import { useState, type FormEvent, type ReactNode } from "react";
import {
  CHANNEL_KINDS,
  addressLines,
  channelKindLabel,
  emptyChannel,
  emptyDraft,
  emptyWork,
} from "../lib/contact";
import {
  addLink,
  field,
  ghost,
  iconButton,
  primary,
  secondary,
  sectionBar,
  selectField,
} from "../lib/styles";
import type {
  AddressBook,
  ContactAddress,
  ContactChannel,
  ContactChannelKind,
  ContactDraft,
  ContactWork,
} from "../lib/types";

const labelClass = "block min-w-0 text-sm text-mute";

type Props = {
  busy: boolean;
  error?: string | null;
  addressBooks: AddressBook[];
  initialDraft?: ContactDraft;
  onSubmit: (draft: ContactDraft) => void;
  onCancel: () => void;
};

export function ContactForm({
  busy,
  error,
  addressBooks,
  initialDraft,
  onSubmit,
  onCancel,
}: Props) {
  const [draft, setDraft] = useState<ContactDraft>(initialDraft ?? emptyDraft());
  const [showAddress, setShowAddress] = useState(false);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim()) {
      return;
    }
    onSubmit(draft);
  }

  function patch(partial: Partial<ContactDraft>) {
    setDraft((current) => ({ ...current, ...partial }));
  }

  function patchAddress(partial: Partial<ContactAddress>) {
    setDraft((current) => ({
      ...current,
      address: { ...current.address, ...partial },
    }));
  }

  function clearAddress() {
    setDraft((current) => ({ ...current, address: {} }));
    setShowAddress(false);
  }

  const addressOpen = showAddress || addressLines(draft.address).length > 0;

  return (
    <form
      onSubmit={handleSubmit}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
        <Section title="Identity" first>
          {addressBooks.length > 0 ? (
            <label className={`${labelClass} mb-3`}>
              Address book
              <select
                value={draft.addressBookId}
                onChange={(e) => patch({ addressBookId: e.target.value })}
                className={`${selectField} mt-1.5`}
              >
                {addressBooks.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              Full name
              <input
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
                className={field}
                autoComplete="name"
                autoFocus
                required
              />
            </label>
            <label className={labelClass}>
              Nickname
              <input
                value={draft.nickname ?? ""}
                onChange={(e) => patch({ nickname: e.target.value })}
                className={field}
                autoComplete="nickname"
              />
            </label>
          </div>
        </Section>

        <Section title="Emails">
          <ChannelList
            channels={draft.emails}
            valuePlaceholder="Email"
            inputType="email"
            addLabel="+ Email"
            onChange={(emails) => patch({ emails })}
            newChannel={() => emptyChannel("home")}
          />
        </Section>

        <Section title="Phones">
          <ChannelList
            channels={draft.phones}
            valuePlaceholder="Phone"
            inputType="tel"
            addLabel="+ Phone"
            onChange={(phones) => patch({ phones })}
            newChannel={() => emptyChannel("mobile")}
          />
        </Section>

        <Section
          title="Address"
          action={
            addressOpen ? (
              <button type="button" className={ghost} onClick={clearAddress}>
                Clear
              </button>
            ) : null
          }
        >
          {addressOpen ? (
            <div className="grid gap-3">
              <label className={labelClass}>
                Street line 1
                <input
                  value={draft.address?.street1 ?? ""}
                  onChange={(e) =>
                    patchAddress({ street1: e.target.value })
                  }
                  className={field}
                  autoComplete="address-line1"
                />
              </label>
              <label className={labelClass}>
                Street line 2
                <input
                  value={draft.address?.street2 ?? ""}
                  onChange={(e) =>
                    patchAddress({ street2: e.target.value })
                  }
                  className={field}
                  autoComplete="address-line2"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={labelClass}>
                  City / town
                  <input
                    value={draft.address?.locality ?? ""}
                    onChange={(e) =>
                      patchAddress({ locality: e.target.value })
                    }
                    className={field}
                    autoComplete="address-level2"
                  />
                </label>
                <label className={labelClass}>
                  Region / state / province
                  <input
                    value={draft.address?.region ?? ""}
                    onChange={(e) =>
                      patchAddress({ region: e.target.value })
                    }
                    className={field}
                    autoComplete="address-level1"
                  />
                </label>
                <label className={labelClass}>
                  Postal code
                  <input
                    value={draft.address?.postcode ?? ""}
                    onChange={(e) =>
                      patchAddress({ postcode: e.target.value })
                    }
                    className={field}
                    autoComplete="postal-code"
                  />
                </label>
                <label className={labelClass}>
                  Country
                  <input
                    value={draft.address?.country ?? ""}
                    onChange={(e) =>
                      patchAddress({ country: e.target.value })
                    }
                    className={field}
                    autoComplete="country-name"
                  />
                </label>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={addLink}
              onClick={() => setShowAddress(true)}
            >
              + Address
            </button>
          )}
        </Section>

        <Section title="Work">
          <WorkList work={draft.work} onChange={(work) => patch({ work })} />
        </Section>
      </div>

      <div className="shrink-0 border-t border-line bg-panel">
        {error ? (
          <p className="px-5 pt-3 text-sm text-danger">{error}</p>
        ) : null}
        <div className="flex gap-3 px-5 py-4">
          <button
            type="button"
            className={`${secondary} flex-1`}
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button type="submit" disabled={busy} className={`${primary} flex-1`}>
            {busy ? "Please wait…" : "Add"}
          </button>
        </div>
      </div>
    </form>
  );
}

function Section({
  title,
  first,
  action,
  children,
}: {
  title: string;
  first?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={first ? undefined : "mt-6 border-t border-line pt-5"}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h3
          className={`text-[11px] font-semibold uppercase tracking-[0.14em] text-mute ${sectionBar}`}
        >
          {title}
        </h3>
        {action}
      </div>
      <div className="mt-3 min-w-0">{children}</div>
    </section>
  );
}

function RemoveButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={iconButton}
      aria-label={label}
      onClick={onClick}
    >
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
      </svg>
    </button>
  );
}

function ChannelList({
  channels,
  valuePlaceholder,
  inputType,
  addLabel,
  onChange,
  newChannel,
}: {
  channels: ContactChannel[];
  valuePlaceholder: string;
  inputType: "email" | "tel";
  addLabel: string;
  onChange: (channels: ContactChannel[]) => void;
  newChannel: () => ContactChannel;
}) {
  function update(id: string, patch: Partial<ContactChannel>) {
    onChange(
      channels.map((channel) =>
        channel.id === id ? { ...channel, ...patch } : channel,
      ),
    );
  }

  return (
    <div className="grid min-w-0 gap-2">
      {channels.map((channel) => (
        <div
          key={channel.id}
          className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)_2.25rem] items-start gap-2 sm:grid-cols-[6rem_minmax(0,1fr)_2.25rem]"
        >
          <select
            value={channel.kind}
            aria-label="Type"
            onChange={(e) => {
              const kind = e.target.value as ContactChannelKind;
              update(channel.id, {
                kind,
                label: kind === "custom" ? channel.label : undefined,
              });
            }}
            className={`${selectField} w-full`}
          >
            {CHANNEL_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {channelKindLabel(kind)}
              </option>
            ))}
          </select>
          <div className="grid min-w-0 gap-2">
            <input
              type={inputType}
              value={channel.value}
              onChange={(e) =>
                update(channel.id, { value: e.target.value })
              }
              placeholder={valuePlaceholder}
              className={`${field} mt-0`}
            />
            {channel.kind === "custom" ? (
              <input
                value={channel.label ?? ""}
                onChange={(e) =>
                  update(channel.id, { label: e.target.value })
                }
                placeholder="Label"
                aria-label="Custom label"
                className={`${field} mt-0`}
              />
            ) : null}
          </div>
          <RemoveButton
            label={`Remove ${valuePlaceholder.toLowerCase()}`}
            onClick={() =>
              onChange(channels.filter((row) => row.id !== channel.id))
            }
          />
        </div>
      ))}
      <button
        type="button"
        className={addLink}
        onClick={() => onChange([...channels, newChannel()])}
      >
        {addLabel}
      </button>
    </div>
  );
}

function WorkList({
  work,
  onChange,
}: {
  work: ContactWork[];
  onChange: (work: ContactWork[]) => void;
}) {
  function update(id: string, patch: Partial<ContactWork>) {
    onChange(
      work.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  }

  return (
    <div className="grid min-w-0 gap-2">
      {work.map((row) => (
        <div key={row.id} className="flex min-w-0 items-start gap-2">
          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
            <input
              value={row.organization}
              onChange={(e) =>
                update(row.id, { organization: e.target.value })
              }
              placeholder="Workplace"
              aria-label="Workplace"
              className={`${field} mt-0`}
              autoComplete="organization"
            />
            <input
              value={row.title ?? ""}
              onChange={(e) =>
                update(row.id, { title: e.target.value })
              }
              placeholder="Occupation"
              aria-label="Occupation"
              className={`${field} mt-0`}
              autoComplete="organization-title"
            />
          </div>
          <RemoveButton
            label="Remove workplace"
            onClick={() =>
              onChange(work.filter((item) => item.id !== row.id))
            }
          />
        </div>
      ))}
      <button
        type="button"
        className={addLink}
        onClick={() => onChange([...work, emptyWork()])}
      >
        + Workplace
      </button>
    </div>
  );
}

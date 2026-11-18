import { useState } from "react";
import { Modal } from "./Modal";
import { btnDanger, btnSecondary, selectField } from "../lib/styles";
import type { AddressBook } from "../lib/types";
import { ErrorMessage } from "./ErrorMessage";

type Props = {
  book: AddressBook;
  destinationBooks: AddressBook[];
  contactCount: number;
  busy: boolean;
  error: string | null;
  onConfirm: (destinationId: string | null) => void;
  onClose: () => void;
};

export function DeleteAddressBookModal({
  book,
  destinationBooks,
  contactCount,
  busy,
  error,
  onConfirm,
  onClose,
}: Props) {
  const [choice, setChoice] = useState<"move" | "delete">("move");
  const [destinationId, setDestinationId] = useState(destinationBooks[0]?.id ?? "");

  return (
    <Modal title={`Delete ${book.name}`} onClose={busy ? () => {} : onClose}>
      <div className="space-y-5 p-6">
        <p className="text-sm text-mute">
          {contactCount === 0
            ? "This address book has no contacts. Choose how to continue."
            : `${contactCount} ${contactCount === 1 ? "contact is" : "contacts are"} inside this address book.`}
        </p>

        <fieldset className="space-y-3">
          <legend className="sr-only">What should happen to the contacts?</legend>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface p-3">
            <input
              type="radio"
              name="address-book-delete-choice"
              checked={choice === "move"}
              onChange={() => setChoice("move")}
              className="mt-1 accent-accent"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-text">Move existing contacts to a book</span>
              <span className="mt-1 block text-xs text-mute">Keep the contacts and choose their new address book.</span>
              <select
                value={destinationId}
                onChange={(event) => setDestinationId(event.target.value)}
                disabled={choice !== "move" || busy || destinationBooks.length === 0}
                className={`${selectField} mt-3`}
                aria-label="Destination address book"
              >
                {destinationBooks.map((destination) => (
                  <option key={destination.id} value={destination.id}>
                    {destination.name}
                  </option>
                ))}
              </select>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface p-3">
            <input
              type="radio"
              name="address-book-delete-choice"
              checked={choice === "delete"}
              onChange={() => setChoice("delete")}
              className="mt-1 accent-danger"
            />
            <span>
              <span className="block text-sm font-medium text-danger">Move contained contacts to the trash</span>
              <span className="mt-1 block text-xs text-mute">They go with the address book, and come back with it if it is restored within 30 days.</span>
            </span>
          </label>
        </fieldset>

        {error ? <ErrorMessage>{error}</ErrorMessage> : null}

        <div className="flex justify-end gap-3">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={btnDanger}
            onClick={() => onConfirm(choice === "move" ? destinationId : null)}
            disabled={busy || (choice === "move" && !destinationId)}
          >
            {busy ? "Moving…" : "Move to trash"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

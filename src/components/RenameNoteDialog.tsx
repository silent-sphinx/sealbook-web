import { useState } from "react";
import { btnPrimary, btnSecondary, field, fieldLabel } from "../lib/styles";
import { Modal, ModalBody, ModalFooter } from "./Modal";

type Props = {
  title: string;
  /** What is being renamed; defaults to a note. */
  kind?: "note" | "notebook";
  onSave: (title: string) => void;
  onClose: () => void;
};

export function RenameNoteDialog({ title, kind = "note", onSave, onClose }: Props) {
  const [value, setValue] = useState(title);
  return (
    <Modal title={`Rename ${kind}`} size="sm" onClose={onClose}>
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(value.trim());
        }}
      >
        <ModalBody>
        <label className={fieldLabel}>
          {kind === "note" ? "Note name" : "Notebook name"}
          <input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            placeholder={kind === "note" ? "Untitled note" : "Notebook name"}
            className={field}
          />
        </label>
        </ModalBody>
        <ModalFooter>
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary}>
            Rename
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

import { useState } from "react";
import { btnPrimary, btnSecondary, field, fieldLabel } from "../lib/styles";
import { Modal } from "./Modal";

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
    <Modal title={`Rename ${kind}`} onClose={onClose}>
      <form
        className="p-6"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(value.trim());
        }}
      >
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
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onClose} className={`${btnSecondary} flex-1`}>
            Cancel
          </button>
          <button type="submit" className={`${btnPrimary} flex-1`}>
            Rename
          </button>
        </div>
      </form>
    </Modal>
  );
}

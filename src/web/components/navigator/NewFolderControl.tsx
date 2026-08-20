import { FolderSimplePlus } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";
import styles from "./NewFolderControl.module.css";

export interface NewFolderControlProps {
  onCreate: (name: string) => void;
}

export function NewFolderControl({ onCreate }: NewFolderControlProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return;
    }
    onCreate(trimmed);
    setName("");
    setEditing(false);
  };

  if (!editing) {
    return (
      <button type="button" className={styles.trigger} onClick={() => setEditing(true)}>
        <FolderSimplePlus size={16} weight="bold" aria-hidden="true" />
        New folder
      </button>
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <label className={styles.label} htmlFor="new-folder-name">
        Folder name
      </label>
      <input
        id="new-folder-name"
        className={styles.input}
        type="text"
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          if (name.trim().length === 0) {
            setEditing(false);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setName("");
            setEditing(false);
          }
        }}
      />
    </form>
  );
}

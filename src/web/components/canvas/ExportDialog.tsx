import { DownloadSimple, ShareNetwork, X } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { useBackdropDismiss } from "../../lib/useBackdropDismiss";
import { useFocusTrap } from "../../lib/useFocusTrap";
import { Button, IconButton } from "../primitives";
import styles from "./ExportDialog.module.css";

export interface ExportDialogProps {
  workflowName: string;
  onClose: () => void;
  onDownloadImage: () => Promise<void>;
  onDownloadHtml: (hideFilePaths: boolean) => Promise<void>;
  onShare: (hideFilePaths: boolean) => Promise<void>;
}

type ExportFormat = "image" | "html";
type ExportAction = "image" | "html" | "share";

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Collects the privacy choice immediately before creating a downloadable/shareable artifact. */
export function ExportDialog({ workflowName, onClose, onDownloadImage, onDownloadHtml, onShare }: ExportDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [format, setFormat] = useState<ExportFormat>("image");
  const [hideFilePaths, setHideFilePaths] = useState<boolean | null>(null);
  const [pendingAction, setPendingAction] = useState<ExportAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = (): void => {
    if (pendingAction === null) {
      onClose();
    }
  };
  useFocusTrap(dialogRef, true, close);
  const backdropDismiss = useBackdropDismiss(close);

  const submit = async (action: ExportAction): Promise<void> => {
    if (action !== "image" && hideFilePaths === null) {
      setError("Choose whether to hide file paths before exporting.");
      return;
    }
    setPendingAction(action);
    setError(null);
    try {
      if (action === "image") {
        await onDownloadImage();
      } else if (action === "html") {
        await onDownloadHtml(hideFilePaths as boolean);
      } else {
        await onShare(hideFilePaths as boolean);
      }
      onClose();
    } catch (actionError) {
      if (!isAbortError(actionError)) {
        setError(actionError instanceof Error ? actionError.message : "The export could not be created.");
      }
    } finally {
      setPendingAction(null);
    }
  };

  const busy = pendingAction !== null;
  return (
    <div
      className={styles.backdrop}
      {...backdropDismiss}
    >
      <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="export-dialog-title">
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Prepare export</p>
            <h2 id="export-dialog-title" className={styles.title}>Export {workflowName}</h2>
          </div>
          <IconButton label="Close export dialog" icon={<X size={18} />} onClick={close} disabled={busy} />
        </div>

        <div className={styles.body}>
          <p className={styles.intro}>
            Download a static image of the complete diagram, or an interactive HTML snapshot that works offline.
          </p>
          <fieldset className={styles.choiceGroup}>
            <legend>Format</legend>
            <label className={`${styles.choice} ${format === "image" ? styles.selected : ""}`}>
              <input
                type="radio"
                name="export-format"
                checked={format === "image"}
                onChange={() => {
                  setFormat("image");
                  setError(null);
                }}
              />
              <span>
                <strong>Image</strong>
                <small>PNG of the complete diagram, ready to add to documents or share.</small>
              </span>
            </label>
            <label className={`${styles.choice} ${format === "html" ? styles.selected : ""}`}>
              <input
                type="radio"
                name="export-format"
                checked={format === "html"}
                onChange={() => {
                  setFormat("html");
                  setError(null);
                }}
              />
              <span>
                <strong>HTML (interactive)</strong>
                <small>Self-contained snapshot with pan, zoom, step details, and theme controls.</small>
              </span>
            </label>
          </fieldset>
          {format === "html" ? (
            <fieldset className={styles.choiceGroup}>
              <legend>Hide file paths?</legend>
              <label className={`${styles.choice} ${hideFilePaths ? styles.selected : ""}`}>
                <input
                  type="radio"
                  name="hide-file-paths"
                  checked={hideFilePaths === true}
                  onChange={() => setHideFilePaths(true)}
                />
                <span>
                  <strong>Yes, hide them</strong>
                  <small>Redacts every structured file reference and source status key.</small>
                </span>
              </label>
              <label className={`${styles.choice} ${hideFilePaths === false ? styles.selected : ""}`}>
                <input
                  type="radio"
                  name="hide-file-paths"
                  checked={hideFilePaths === false}
                  onChange={() => setHideFilePaths(false)}
                />
                <span>
                  <strong>No, include them</strong>
                  <small>Includes the repository-relative paths from the workflow description.</small>
                </span>
              </label>
            </fieldset>
          ) : null}
          {error !== null ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className={styles.footer}>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <div className={styles.actions}>
            {format === "html" ? (
              <Button
                variant="secondary"
                icon={<ShareNetwork size={16} />}
                onClick={() => void submit("share")}
                disabled={busy || hideFilePaths === null}
              >
                {pendingAction === "share" ? "Preparing..." : "Share HTML"}
              </Button>
            ) : null}
            <Button
              icon={<DownloadSimple size={16} />}
              onClick={() => void submit(format)}
              disabled={busy || (format === "html" && hideFilePaths === null)}
            >
              {pendingAction === format ? "Preparing..." : format === "image" ? "Download image" : "Download HTML"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

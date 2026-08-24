import { useState } from "react";
import { ArrowSquareOut, WarningCircle } from "@phosphor-icons/react";
import type { SourceReference } from "@schema/workflow";
import { ApiError, getSource } from "../../api/client";
import type { SourceStatus } from "../../api/types";
import { sourceStatusTone } from "../../design/semantics";
import { useExportMode } from "../../export-viewer/ExportModeContext";
import { Badge, Button, CopyButton, MonoPath } from "../primitives";
import { formatLineRange, sourceCheckKey } from "./sourceKey";
import styles from "./SourceReferenceRow.module.css";

const STATUS_TEXT: Record<SourceStatus, string> = {
  found: "File found",
  missing: "File not found",
};

export interface SourceReferenceRowProps {
  source: SourceReference;
  sourceChecks: Record<string, SourceStatus>;
}

/**
 * The highest-value part of the drawer: an honest, actionable rendering of one `SourceReference`
 * — never file contents (contract §8, "there is no endpoint that returns source text").
 */
export function SourceReferenceRow({ source, sourceChecks }: SourceReferenceRowProps) {
  const [openError, setOpenError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const exportMode = useExportMode();

  const status = sourceChecks[sourceCheckKey(source)];
  const tone = status !== undefined ? sourceStatusTone(status) : null;
  const lineRange = formatLineRange(source);
  const isMissing = status === "missing";

  const handleOpen = async (): Promise<void> => {
    setOpening(true);
    setOpenError(null);
    try {
      const lookup = await getSource(source.file, source.line);
      if (!lookup.exists) {
        setOpenError(`${lookup.file} was not found in this repository.`);
        return;
      }
      if (lookup.editorUrl === undefined) {
        setOpenError("The server did not return an editor link for this file.");
        return;
      }
      window.location.href = lookup.editorUrl;
    } catch (error) {
      setOpenError(error instanceof ApiError ? error.message : "Could not reach the HQFlow server.");
    } finally {
      setOpening(false);
    }
  };

  return (
    <li className={`${styles.row} ${isMissing ? styles.missing : ""}`}>
      <div className={styles.pathLine}>
        {exportMode?.hideFilePaths !== true ? <MonoPath path={source.file} /> : null}
        {source.symbol !== undefined ? <span className={styles.symbol}>{source.symbol}</span> : null}
        {lineRange !== null ? <span className={styles.lines}>{lineRange}</span> : null}
      </div>
      <div className={styles.statusLine}>
        {isMissing ? <WarningCircle size={13} aria-hidden="true" className={styles.warningIcon} /> : null}
        <Badge {...(tone !== null ? { tone: tone.tone } : {})}>
          {status !== undefined ? STATUS_TEXT[status] : "Not yet checked"}
        </Badge>
      </div>
      {source.description !== undefined ? <p className={styles.description}>{source.description}</p> : null}
      {exportMode === null ? (
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" icon={<ArrowSquareOut size={14} />} onClick={() => void handleOpen()} disabled={opening}>
            Open in editor
          </Button>
          <CopyButton value={source.file} label="Copy path" />
        </div>
      ) : exportMode.hideFilePaths !== true ? (
        <div className={styles.actions}>
          <CopyButton value={source.file} label="Copy path" />
        </div>
      ) : null}
      {openError !== null ? (
        <p className={styles.error} role="alert">
          {openError}
        </p>
      ) : null}
    </li>
  );
}

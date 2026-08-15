import type { WorkflowStep } from "@schema/workflow";
import { useExportMode } from "../../../export-viewer/ExportModeContext";
import { MAX_SYMBOL_ROWS, splitPath, stepSymbolRows, type Depth } from "../nodeContent";
import styles from "./StepNode.module.css";

export interface StepNodeDetailProps {
  step: WorkflowStep;
  /** Collapsed cards stay on the story. Expanded cards show symbols. */
  depth: Depth;
}

/**
 * Extra card rows that appear only when a step is expanded. The collapsed card
 * stays a product story (contract §11: same node, it grows).
 */
export function StepNodeDetail({ step, depth }: StepNodeDetailProps) {
  const exportMode = useExportMode();
  const hideFilePaths = exportMode?.hideFilePaths === true;

  if (depth !== "symbols") {
    return null;
  }
  if (hideFilePaths) {
    return null;
  }
  const rows = stepSymbolRows(step);
  if (rows.length === 0) {
    return null;
  }
  const shown = rows.slice(0, MAX_SYMBOL_ROWS);
  const more = rows.length - shown.length;
  return (
    <div className={styles.detail}>
      <span className={styles.sectionLabel}>Symbols</span>
      {shown.map((row) => {
        const { dir, base } = splitPath(row.file);
        return (
          <div key={`${row.file}#${row.symbol ?? ""}`} className={styles.symbolRow} title={row.file}>
            <span className={styles.dir}>{dir}</span>
            <span className={styles.base}>{base}</span>
            {row.symbol !== undefined ? <span className={styles.symbol}>{` → ${row.symbol}()`}</span> : null}
          </div>
        );
      })}
      {more > 0 ? <div className={styles.more}>+{more} more</div> : null}
    </div>
  );
}

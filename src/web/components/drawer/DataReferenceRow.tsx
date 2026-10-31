import type { DataReference } from "@schema/workflow";
import { Badge } from "../primitives";
import styles from "./DataReferenceRow.module.css";

export interface DataReferenceRowProps {
  item: DataReference;
}

/** One row of an Inputs/Outputs list (contract §11 point 4/5). */
export function DataReferenceRow({ item }: DataReferenceRowProps) {
  return (
    <li className={styles.row}>
      <div className={styles.headerLine}>
        <span className={styles.name}>{item.name}</span>
        {item.type !== undefined ? <Badge className={styles.type}>{item.type}</Badge> : null}
      </div>
      {item.description !== undefined ? <p className={styles.description}>{item.description}</p> : null}
    </li>
  );
}

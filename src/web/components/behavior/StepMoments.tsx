import type { BehaviorRecord } from "../../api/types";
import { useCodeHQStore } from "../../store/useCodeHQStore";
import { DrawerSection } from "../drawer/DrawerSection";
import styles from "./BehaviorLinks.module.css";

export interface StepMomentsProps {
  workflowId: string;
  stepId: string;
  behaviors: readonly BehaviorRecord[];
}

/** The link back up: every behavior moment that names this workflow step as its cause. */
export function StepMoments({ workflowId, stepId, behaviors }: StepMomentsProps) {
  const openBehaviorMoment = useCodeHQStore((state) => state.openBehaviorMoment);
  const moments = behaviors.flatMap((record) => record.behavior.moments
    .filter((moment) => (moment.causedBy ?? []).some((link) => link.workflow === workflowId && link.step === stepId))
    .map((moment) => ({ record, moment })));
  if (moments.length === 0) {
    return null;
  }
  return (
    <DrawerSection title="The user sees this as" count={moments.length}>
      <ul className={styles.list}>
        {moments.map(({ record, moment }) => (
          <li key={`${record.id}/${moment.id}`}>
            <button type="button" className={styles.link} onClick={() => openBehaviorMoment(record.id, moment.id)}>
              {record.behavior.name} › {moment.name}
            </button>
          </li>
        ))}
      </ul>
    </DrawerSection>
  );
}

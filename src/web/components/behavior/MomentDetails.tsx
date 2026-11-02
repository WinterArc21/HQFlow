import type { Behavior, BehaviorMoment, Verdict } from "@schema/behavior";
import type { WorkflowRecord } from "../../api/types";
import type { BadgeTone } from "../../design/semantics";
import { useCodeHQStore } from "../../store/useCodeHQStore";
import { DrawerSection } from "../drawer/DrawerSection";
import { Badge } from "../primitives";
import styles from "./BehaviorLinks.module.css";

const VERDICT_BADGES: Record<Verdict["status"], { tone: BadgeTone; label: string }> = {
  works: { tone: "neutral", label: "Works" },
  bug: { tone: "red", label: "Bug found" },
  fixed: { tone: "green", label: "Fixed" },
};

function VerdictLine({ verdict }: { verdict: Verdict }) {
  const visual = VERDICT_BADGES[verdict.status];
  return (
    <div className={styles.item}>
      <Badge tone={visual.tone} dot>{visual.label}</Badge>
      <p className={styles.evidence}>{verdict.evidence}</p>
    </div>
  );
}

export interface MomentDetailsProps {
  behavior: Behavior;
  moment: BehaviorMoment;
  workflows: readonly WorkflowRecord[];
}

/**
 * What a behavior moment adds to its step card: what was proved about it, where the user can go
 * next and whether that was proved, and the workflow steps that cause it, each opening that step.
 */
export function MomentDetails({ behavior, moment, workflows }: MomentDetailsProps) {
  const openWorkflowStep = useCodeHQStore((state) => state.openWorkflowStep);
  const outgoing = behavior.transitions.filter((transition) => transition.from === moment.id);
  const causedBy = moment.causedBy ?? [];
  const momentName = (id: string) => behavior.moments.find((candidate) => candidate.id === id)?.name ?? id;

  return (
    <>
      {moment.verdict !== undefined ? (
        <DrawerSection title="Verdict">
          <VerdictLine verdict={moment.verdict} />
        </DrawerSection>
      ) : null}
      {outgoing.length > 0 ? (
        <DrawerSection title="What can happen next" count={outgoing.length}>
          <ul className={styles.list}>
            {outgoing.map((transition, index) => (
              <li key={`${transition.to}-${index}`} className={styles.item}>
                <span>{transition.label} → {momentName(transition.to)}</span>
                {transition.verdict !== undefined ? <VerdictLine verdict={transition.verdict} /> : <span className={styles.missing}>Not checked</span>}
              </li>
            ))}
          </ul>
        </DrawerSection>
      ) : null}
      {causedBy.length > 0 ? (
        <DrawerSection title="Caused by" count={causedBy.length}>
          <ul className={styles.list}>
            {causedBy.map((link) => {
              const record = workflows.find((candidate) => candidate.id === link.workflow);
              const step = record?.workflow.steps.find((candidate) => candidate.id === link.step);
              return (
                <li key={`${link.workflow}/${link.step}`}>
                  {record !== undefined && step !== undefined ? (
                    <button type="button" className={styles.link} onClick={() => openWorkflowStep(record.id, step.id)}>
                      {record.workflow.name} › {step.name}
                    </button>
                  ) : (
                    <span className={styles.missing}>{link.workflow} › {link.step} (not mapped)</span>
                  )}
                </li>
              );
            })}
          </ul>
        </DrawerSection>
      ) : null}
    </>
  );
}

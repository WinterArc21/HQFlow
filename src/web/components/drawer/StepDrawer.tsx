import { useId, useRef } from "react";
import type { Workflow } from "@schema/workflow";
import type { SourceStatus } from "../../api/types";
import { DataReferenceRow } from "./DataReferenceRow";
import { DrawerSection } from "./DrawerSection";
import { EdgeCaseItem } from "./EdgeCaseItem";
import { ExternalServiceItem } from "./ExternalServiceItem";
import { SourceReferenceRow } from "./SourceReferenceRow";
import { StepDrawerConnections } from "./StepDrawerConnections";
import { StepDrawerHeader } from "./StepDrawerHeader";
import { StepDrawerNotes } from "./StepDrawerNotes";
import { TestItem } from "./TestItem";
import { useFocusTrap } from "../../lib/useFocusTrap";
import styles from "./StepDrawer.module.css";

export interface StepDrawerProps {
  workflow: Workflow;
  stepId: string;
  sourceChecks: Record<string, SourceStatus>;
  onClose: () => void;
  onSelectStep: (stepId: string) => void;
}

/**
 * The step detail drawer (contract §11). Renders only the sections that have data — a sparse
 * step produces a short, clean drawer instead of a wall of empty headings.
 */
export function StepDrawer({ workflow, stepId, sourceChecks, onClose, onSelectStep }: StepDrawerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(containerRef, true, onClose);

  const stepIndex = workflow.steps.findIndex((candidate) => candidate.id === stepId);
  const step = workflow.steps[stepIndex];
  if (step === undefined) {
    return null;
  }

  const inputs = step.inputs ?? [];
  const outputs = step.outputs ?? [];
  const sources = step.sources ?? [];
  const edgeCases = step.edgeCases ?? [];
  const tests = step.tests ?? [];
  const externalServices = step.externalServices ?? [];
  const incoming = workflow.connections.filter((connection) => connection.to === step.id);
  const outgoing = workflow.connections.filter((connection) => connection.from === step.id);

  return (
    <div className={styles.backdrop}>
      <div
        ref={containerRef}
        className={styles.drawer}
        data-step-drawer
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-label={`${step.name} details`}
      >
        <StepDrawerHeader
          step={step}
          stepIndex={stepIndex}
          stepCount={workflow.steps.length}
          workflowName={workflow.name}
          titleId={titleId}
          onClose={onClose}
        />
        <div className={styles.body}>
          {inputs.length > 0 ? (
            <DrawerSection title="Inputs" count={inputs.length}>
              <ul className={styles.list}>
                {inputs.map((item, index) => (
                  <DataReferenceRow key={`${item.name}-${index}`} item={item} />
                ))}
              </ul>
            </DrawerSection>
          ) : null}

          {outputs.length > 0 ? (
            <DrawerSection title="Outputs" count={outputs.length}>
              <ul className={styles.list}>
                {outputs.map((item, index) => (
                  <DataReferenceRow key={`${item.name}-${index}`} item={item} />
                ))}
              </ul>
            </DrawerSection>
          ) : null}

          {sources.length > 0 ? (
            <DrawerSection title="Source references" count={sources.length}>
              <ul className={styles.list}>
                {sources.map((source, index) => (
                  <SourceReferenceRow key={`${source.file}-${index}`} source={source} sourceChecks={sourceChecks} />
                ))}
              </ul>
            </DrawerSection>
          ) : null}

          {edgeCases.length > 0 ? (
            <DrawerSection title="Edge cases" count={edgeCases.length}>
              <ul className={styles.list}>
                {edgeCases.map((edgeCase, index) => (
                  <EdgeCaseItem key={`${edgeCase.name}-${index}`} edgeCase={edgeCase} sourceChecks={sourceChecks} />
                ))}
              </ul>
            </DrawerSection>
          ) : null}

          {tests.length > 0 ? (
            <DrawerSection title="Tests" count={tests.length}>
              <ul className={styles.list}>
                {tests.map((test, index) => (
                  <TestItem key={`${test.file}-${index}`} test={test} />
                ))}
              </ul>
            </DrawerSection>
          ) : null}

          {externalServices.length > 0 ? (
            <DrawerSection title="External services" count={externalServices.length}>
              <ul className={styles.list}>
                {externalServices.map((service, index) => (
                  <ExternalServiceItem key={`${service.name}-${index}`} service={service} />
                ))}
              </ul>
            </DrawerSection>
          ) : null}

          <StepDrawerNotes
            {...(step.details?.implementation !== undefined ? { implementation: step.details.implementation } : {})}
            decisions={step.details?.importantDecisions ?? []}
            assumptions={step.details?.assumptions ?? []}
          />

          <StepDrawerConnections workflow={workflow} incoming={incoming} outgoing={outgoing} onSelectStep={onSelectStep} />
        </div>
      </div>
    </div>
  );
}

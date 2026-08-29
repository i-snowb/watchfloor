"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { CaseToolName } from "@/domain/operations";
import type { CaseFixture, CaseState } from "@/domain/types";

interface AnalystActionDockProps {
  fixture: CaseFixture;
  state: CaseState;
  busy: boolean;
  streamPlaying: boolean;
  onExecute: (
    toolName: CaseToolName,
    input: Record<string, unknown>,
  ) => Promise<void>;
  onReleaseSignal: () => void;
}

export function AnalystActionDock({
  fixture,
  state,
  busy,
  streamPlaying,
  onExecute,
  onReleaseSignal,
}: AnalystActionDockProps) {
  const decisionReady = fixture.decision.requiresEnrichmentIds.every((id) =>
    state.attachedEnrichmentIds.includes(id),
  );
  const observation = state.observationRequest;
  const pendingStage =
    observation?.status === "pending"
      ? fixture.stream.stages.find((stage) => stage.id === observation.stageId)
      : null;

  if (state.lifecycle === "closed_in_demo") {
    return (
      <aside
        className="analyst-action-dock analyst-action-dock-complete"
        aria-label="Case closed"
      >
        <p>Case closed</p>
        <Link href="/alerts">Return to case queue</Link>
      </aside>
    );
  }

  if (state.report.status === "drafted" && state.report.report) {
    return (
      <DockFrame eyebrow="Analyst review" title="Evidence report ready">
        <p>
          Review evidence coverage, recorded response, and known limits in the
          case report before approval.
        </p>
      </DockFrame>
    );
  }

  if (state.responseBundle) {
    const bundleTitle =
      state.responseBundle.bundleId === "containment"
        ? "Authorize containment"
        : "Authorize recovery";
    return (
      <DockFrame eyebrow="Analyst approval" title={bundleTitle}>
        <p>{state.responseBundle.reasoning}</p>
        <button
          disabled={busy}
          onClick={() =>
            void onExecute("authorize_response_bundle", {
              expectedRevision: state.revision,
              bundleId: state.responseBundle?.bundleId,
              proposalId: state.responseBundle?.id,
              acknowledgement: "AUTHORIZE_SYNTHETIC_BUNDLE",
            })
          }
          type="button"
        >
          Authorize package
        </button>
        <small>
          Recorded against synthetic case data. No external control is executed.
        </small>
      </DockFrame>
    );
  }

  if (pendingStage) {
    return (
      <DockFrame
        eyebrow="Analyst replay control"
        title="Release requested telemetry"
      >
        <p>{pendingStage.summary}</p>
        <button
          disabled={busy || streamPlaying}
          onClick={onReleaseSignal}
          type="button"
        >
          {streamPlaying
            ? "Receiving telemetry…"
            : `Release ${pendingStage.title}`}
        </button>
      </DockFrame>
    );
  }

  if (state.decision.status === "pending" && decisionReady) {
    return (
      <DockFrame
        eyebrow="Analyst disposition"
        title={fixture.decision.question}
      >
        <div className="analyst-action-dock-options">
          {fixture.decision.options.map((option) => (
            <button
              disabled={busy}
              key={option.id}
              onClick={() =>
                void onExecute("record_evidence_decision", {
                  expectedRevision: state.revision,
                  decision: option.id,
                  rationale: option.rationale,
                })
              }
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </DockFrame>
    );
  }

  return null;
}

function DockFrame({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <aside
      className="analyst-action-dock"
      aria-live="polite"
      aria-label={eyebrow}
    >
      <span>{eyebrow}</span>
      <strong>{title}</strong>
      <div>{children}</div>
    </aside>
  );
}

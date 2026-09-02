import {
  getAnalystGate,
  getCollaborationHandoff,
  type CollaborationHandoff,
} from "@/domain/operations";
import type { CaseFixture, CaseState } from "@/domain/types";
import type { AgentStatus } from "./platform-shell";

interface CaseAuthorityHandoffProps {
  fixture: CaseFixture;
  state: CaseState;
  agentStatus: AgentStatus;
}

const withheldPowers = [
  "record evidence disposition",
  "release telemetry",
  "authorize response action",
  "authorize response package",
  "approve case report",
] as const;

export function CaseAuthorityHandoff({
  fixture,
  state,
  agentStatus,
}: CaseAuthorityHandoffProps) {
  const handoff = getCollaborationHandoff(fixture, state);
  const turn = turnLabel(fixture, state, handoff, agentStatus);

  return (
    <aside
      aria-label="TRACE authority and current handoff"
      className="case-authority-handoff"
    >
      <div className="case-authority-summary">
        <span className="case-authority-label">Authority</span>
        <strong>TRACE investigates and models</strong>
        <span className="case-authority-separator" aria-hidden="true">
          ·
        </span>
        <span>You approve case decisions</span>
        <details className="case-authority-details">
          <summary>Authority scope</summary>
          <div>
            <strong>Analyst decision controls</strong>
            <ul>
              {withheldPowers.map((power) => (
                <li key={power}>{power}</li>
              ))}
            </ul>
          </div>
        </details>
      </div>
      <div
        aria-live="polite"
        className={`case-handoff-line case-handoff-line-${handoff.nextOwner}`}
      >
        <span>{handoffOwnerLabel(handoff, agentStatus)}</span>
        <strong>{turn}</strong>
      </div>
    </aside>
  );
}

function handoffOwnerLabel(
  handoff: CollaborationHandoff,
  agentStatus: AgentStatus,
): string {
  if (agentStatus.state !== "available") return "Analyst review mode";
  if (handoff.nextOwner === "agent") return "Next · agent handoff";
  if (handoff.nextOwner === "analyst") return "Next · analyst decision";
  return "Case state";
}

function turnLabel(
  fixture: CaseFixture,
  state: CaseState,
  handoff: CollaborationHandoff,
  agentStatus: AgentStatus,
): string {
  if (agentStatus.state !== "available") return "Next · analyst investigation";
  if (handoff.nextOwner === "complete") {
    return "Case closed; report and operation receipts remain available.";
  }
  if (handoff.nextOwner === "analyst") {
    return getAnalystGate(fixture, state)?.title ?? handoff.whyNow;
  }
  return handoff.objective;
}

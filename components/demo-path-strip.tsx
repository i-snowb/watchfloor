import type { CaseFixture, CaseState } from "@/domain/types";

type MilestoneState = "complete" | "current" | "upcoming";

interface DemoMilestone {
  detail: string;
  label: string;
  state: MilestoneState;
  status: string;
}

export function DemoPathStrip({
  fixture,
  state,
}: {
  fixture: CaseFixture;
  state: CaseState;
}) {
  if (fixture.id !== "case-endpoint-0448") return null;

  const queryEvidenceAttached = fixture.investigationQueries.some((query) =>
    state.attachedEnrichmentIds.includes(query.resultArtifactId),
  );
  const decisionReady = fixture.decision.requiresEnrichmentIds.every((id) =>
    state.attachedEnrichmentIds.includes(id),
  );
  const decisionRecorded = state.decision.status !== "pending";
  const controlAuthorized = state.responseActions.some(
    (action) => action.status === "authorized_in_demo",
  );
  const reportSigned = state.report.status === "approved_in_demo";

  const milestones: DemoMilestone[] = [
    {
      label: "Bounded query",
      detail: "Visible KQL → raw case records",
      state: queryEvidenceAttached ? "complete" : "current",
      status: queryEvidenceAttached ? "Evidence attached" : "Start here",
    },
    {
      label: "Human gate",
      detail: "Graph expands → copilot stops",
      state: decisionRecorded
        ? "complete"
        : queryEvidenceAttached
          ? "current"
          : "upcoming",
      status: decisionRecorded
        ? "Analyst decided"
        : decisionReady
          ? "Waiting on analyst"
          : "Evidence required",
    },
    {
      label: "Controlled closure",
      detail: "Sever modeled reach → sign report",
      state: reportSigned
        ? "complete"
        : decisionRecorded
          ? "current"
          : "upcoming",
      status: reportSigned
        ? "Signed and closed"
        : controlAuthorized
          ? "Control approved"
          : "Approval required",
    },
  ];

  return (
    <nav className="demo-path-strip" aria-label="Three-minute demo path">
      <div className="demo-path-intro">
        <span>Competition path</span>
        <strong>Three WebMCP proof moments</strong>
      </div>
      <ol>
        {milestones.map((milestone, index) => (
          <li
            aria-current={milestone.state === "current" ? "step" : undefined}
            className={`demo-path-${milestone.state}`}
            key={milestone.label}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong>{milestone.label}</strong>
              <small>{milestone.detail}</small>
            </div>
            <em>{milestone.status}</em>
          </li>
        ))}
      </ol>
      <p>Synthetic case corpus · no external execution</p>
    </nav>
  );
}

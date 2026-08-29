import type {
  CaseState,
  Entity,
  Tier1Escalation,
  Tier1RecommendedStep,
} from "@/domain/types";
import type { InvestigationActivity } from "./investigation-activity";

export function Tier1LeadDock({
  escalation,
  entities,
  state,
  activity,
  busy,
  selectedEntityId,
  onEvidenceSelect,
  onRecommendationSelect,
}: {
  escalation: Tier1Escalation;
  entities: readonly Entity[];
  state: CaseState;
  activity: InvestigationActivity;
  busy: boolean;
  selectedEntityId: string | null;
  onEvidenceSelect?: (eventId: string) => void;
  onRecommendationSelect?: (step: Tier1RecommendedStep) => void;
}) {
  const entityLabels = new Map(
    entities.map((entity) => [entity.id, entity.label]),
  );
  const nextStep = escalation.recommendedSteps.find(
    (step) =>
      step.completionArtifactId === null ||
      !state.attachedEnrichmentIds.includes(step.completionArtifactId),
  );

  return (
    <details className="tier1-lead-dock">
      <summary aria-label="Open Tier 1 handoff">
        <span>Tier 1 handoff</span>
        <strong>{escalation.escalationReason}</strong>
        <output>{escalation.actionsWithheld.length} controls withheld</output>
      </summary>

      <div className="lead-dock-panel">
        <header>
          <div>
            <span>Initial observations</span>
            <strong>Escalated for investigation</strong>
          </div>
          <small>{escalation.confidence} confidence</small>
        </header>
        <p className="lead-dock-reason">{escalation.escalationReason}</p>

        <ol className="lead-dock-options" aria-label="Suggested investigations">
          {escalation.recommendedSteps.map((step, index) => {
            const attached =
              step.completionArtifactId !== null &&
              state.attachedEnrichmentIds.includes(step.completionArtifactId);
            const running =
              activity.status === "running" &&
              activity.queryId === step.investigationQueryId;
            const selected = step.entityId === selectedEntityId;
            return (
              <li
                className={`${attached ? "lead-dock-attached" : ""} ${running ? "lead-dock-running" : ""} ${selected ? "lead-dock-selected" : ""}`}
                key={step.id}
              >
                <button
                  aria-current={selected ? "step" : undefined}
                  disabled={busy || !onRecommendationSelect}
                  onClick={(event) => {
                    onRecommendationSelect?.(step);
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                  }}
                  type="button"
                >
                  <span className="lead-dock-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="lead-dock-copy">
                    <small>
                      {running
                        ? "Query running"
                        : attached
                          ? "Finding attached"
                          : step.id === nextStep?.id
                            ? "Suggested investigation"
                            : "Available"}
                    </small>
                    <strong>{step.label}</strong>
                    <em>{entityLabels.get(step.entityId) ?? step.entityId}</em>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <details className="lead-dock-context">
          <summary>
            Observed evidence · {escalation.observations.length} signals
          </summary>
          <ol aria-label="Tier 1 observations">
            {escalation.observations.map((observation, index) => (
              <li key={observation.id}>
                <button
                  disabled={!onEvidenceSelect}
                  onClick={() => {
                    const eventId = observation.evidenceIds[0];
                    if (eventId) onEvidenceSelect?.(eventId);
                  }}
                  type="button"
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{observation.title}</strong>
                </button>
              </li>
            ))}
          </ol>
        </details>

        <footer>
          <span>Initial investigation scope</span>
          <small>{escalation.actionsWithheld.length} controls withheld</small>
        </footer>
      </div>
    </details>
  );
}

import type { CaseFixture } from "@/domain/types";

export function EscalationBrief({ fixture }: { fixture: CaseFixture }) {
  return (
    <details className="escalation-brief">
      <summary>
        <span>Escalation brief</span>
        <strong>{fixture.tier1Escalation.escalationReason}</strong>
        <small>
          {fixture.tier1Escalation.observations.length} observed relationships ·
          response withheld at Tier 1
        </small>
      </summary>
      <div>
        <p>
          {fixture.tier1Escalation.evidenceIds.length} evidence records
          correlated at {fixture.tier1Escalation.confidence} confidence.
        </p>
        <ul>
          {fixture.tier1Escalation.observations.map((observation) => (
            <li key={observation.id}>{observation.title}</li>
          ))}
        </ul>
        <small>
          Select an entity for evidence. Select a connection for relationship
          evidence. Review actions in the activity timeline.
        </small>
      </div>
    </details>
  );
}

import { getDerivedNextStep } from "@/domain/operations";
import type {
  CaseFixture,
  CaseState,
  Entity,
  OperationReceipt,
} from "@/domain/types";
import {
  getAllEntities,
  getVisibleEnrichments,
  getVisibleEntities,
  getVisibleEvents,
  getVisibleJoins,
} from "@/domain/incident-stream";
import {
  enrichmentFields,
  entityFields,
  eventFields,
  formatUtcTime,
  humanizeEntityKind,
} from "@/lib/format";
import { EntityGlyph } from "./entity-glyph";
import type { InvestigationActivity } from "./investigation-activity";
import type { TraceSelection } from "./trace-interaction";

interface CaseInspectorProps {
  fixture: CaseFixture;
  state: CaseState;
  selection: TraceSelection;
  agentAvailable: boolean;
  error: string | null;
  latestReceipt: OperationReceipt | null;
  investigationActivity: InvestigationActivity;
  onSelect: (selection: TraceSelection) => void;
}

export function CaseInspector({
  fixture,
  state,
  selection,
  agentAvailable,
  error,
  latestReceipt,
  investigationActivity,
  onSelect,
}: CaseInspectorProps) {
  const content = getSelectionContent(fixture, state, selection);
  const enrichment =
    content.entity &&
    getVisibleEnrichments(fixture, state).find(
      (artifact) => artifact.entityId === content.entity?.id,
    );
  const enrichmentAttached = enrichment
    ? state.attachedEnrichmentIds.includes(enrichment.id)
    : false;
  const investigationQuery = enrichment
    ? (fixture.investigationQueries.find(
        (query) => query.resultArtifactId === enrichment.id,
      ) ?? null)
    : null;
  const nextStep = getDerivedNextStep(fixture, state);
  const agentReceipt =
    latestReceipt?.reportedSurface === "webmcp_callback" ? latestReceipt : null;
  const agentTargetId =
    (investigationActivity.status !== "idle"
      ? investigationActivity.targetEntityId
      : null) ??
    state.proposal?.targetEntityId ??
    nextStep.targetEntityId;
  const agentTarget = agentTargetId
    ? getAllEntities(fixture).find((entity) => entity.id === agentTargetId)
    : null;
  const agentTool =
    state.proposal?.recommendedTool ?? nextStep.recommendedTool ?? null;
  const agentObjective = state.proposal?.objective ?? nextStep.objective;

  return (
    <section
      aria-label="Selected item and copilot activity"
      className="trace-evidence-shelf"
    >
      <p aria-live="polite" className="sr-only">
        Selected {content.title}. {content.summary}
      </p>

      <section className="evidence-shelf-identity">
        <div className="inspector-heading">
          {content.entity ? (
            <span className="inspector-glyph">
              <EntityGlyph kind={content.entity.kind} />
            </span>
          ) : (
            <span className="join-symbol">↔</span>
          )}
          <div>
            <p className="eyebrow">Inspecting · {content.eyebrow}</p>
            <h2>{content.title}</h2>
          </div>
          {content.status ? (
            <span className={`truth-badge truth-${content.status}`}>
              {content.status}
            </span>
          ) : (
            <span className="record-kind-badge">Entity</span>
          )}
        </div>
        <p className="inspector-summary">{content.summary}</p>

        {content.relatedEntities.length > 0 ? (
          <div className="related-entities">
            <p className="field-label">Connected evidence</p>
            <div>
              {content.relatedEntities.map((entity) => (
                <button
                  key={entity.id}
                  onClick={() => onSelect({ kind: "entity", id: entity.id })}
                  type="button"
                >
                  {humanizeEntityKind(entity.kind)} · {entity.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="evidence-shelf-record">
        <div className="evidence-shelf-section-label">
          <span>Evidence record</span>
          <small>{content.fields.length} technical fields</small>
        </div>
        {content.limitation ? (
          <div className="limitation-note">
            <span>Boundary</span>
            <p>{content.limitation}</p>
          </div>
        ) : (
          <p className="evidence-shelf-boundary">
            Selection changes the shared focus only. It does not alter observed
            telemetry.
          </p>
        )}
        {content.fields.length > 0 ? (
          <details className="inspector-technical-fields">
            <summary>Open technical record</summary>
            <dl className="field-grid">
              {content.fields.map((field) => (
                <div key={`${field.label}-${field.value}`}>
                  <dt>{field.label}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
          </details>
        ) : null}
      </section>

      <section
        className={`evidence-shelf-agent agent-activity-${investigationActivity.status}`}
      >
        <div className="agent-workline-heading">
          <span className="agent-presence-mark" />
          <span>
            {investigationActivity.status === "running"
              ? investigationActivity.actor === "agent"
                ? "Copilot investigating this evidence"
                : "Analyst-requested query running"
              : investigationActivity.status === "completed"
                ? investigationActivity.actor === "agent"
                  ? "Copilot result added"
                  : "Analyst result added"
                : investigationActivity.status === "rejected"
                  ? "Investigation request rejected"
                  : agentReceipt
                    ? "Copilot result added"
                    : state.proposal
                      ? "Copilot recommendation"
                      : agentAvailable
                        ? "Copilot ready on selected item"
                        : "Copilot unavailable · analyst controls remain"}
          </span>
        </div>
        {investigationActivity.status === "running" ? (
          <div className="agent-intent-line agent-intent-running">
            <code>{investigationActivity.toolName}</code>
            <strong>Searching case data</strong>
            <span>
              r{investigationActivity.baseRevision} · result pending · no
              evidence attached yet
            </span>
          </div>
        ) : investigationActivity.status === "completed" ||
          investigationActivity.status === "rejected" ? (
          <div className="agent-result-line">
            <code>{investigationActivity.toolName}</code>
            <small>
              r{investigationActivity.baseRevision}→r
              {investigationActivity.resultRevision}
            </small>
            <strong>{investigationActivity.summary}</strong>
            {investigationActivity.status === "rejected" ? (
              <span>No state change</span>
            ) : null}
          </div>
        ) : agentReceipt ? (
          <div className="agent-result-line">
            <code>{agentReceipt.toolName}</code>
            <small>
              r{agentReceipt.baseRevision}→r{agentReceipt.resultRevision}
            </small>
            <strong>{agentReceipt.resultSummary}</strong>
          </div>
        ) : (
          <div className="agent-intent-line">
            {agentTool ? <code>{agentTool}</code> : <code>observe</code>}
            <strong>{agentObjective}</strong>
            <span>
              {state.proposal
                ? "Recommendation only. No action has run."
                : agentTarget
                  ? `Target · ${humanizeEntityKind(agentTarget.kind)} · ${agentTarget.label}`
                  : "The copilot and analyst share this selected item."}
            </span>
          </div>
        )}

        {enrichment ? (
          <div
            className={`shelf-enrichment ${enrichmentAttached ? "shelf-enrichment-attached" : ""}`}
          >
            <div className="enrichment-heading">
              <div>
                <p className="eyebrow">Context layer</p>
                <h3>{enrichment.title}</h3>
              </div>
              <span className={`truth-badge truth-${enrichment.status}`}>
                {enrichmentAttached ? "attached" : enrichment.status}
              </span>
            </div>
            {enrichmentAttached ? (
              <>
                <p>{enrichment.summary}</p>
                <details className="inspector-technical-fields">
                  <summary>
                    Open context · {enrichmentFields(enrichment).length} fields
                  </summary>
                  <dl className="field-grid field-grid-compact">
                    {enrichmentFields(enrichment).map((field) => (
                      <div key={field.label}>
                        <dt>{field.label}</dt>
                        <dd>{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </>
            ) : (
              <div className="shelf-query-status">
                <p>Available from Active question.</p>
                <code>
                  {agentAvailable ? "Copilot + analyst" : "Analyst"} ·{" "}
                  {investigationQuery?.id ?? enrichment.toolName}
                </code>
              </div>
            )}
          </div>
        ) : null}
      </section>

      {error ? (
        <p className="operation-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function getSelectionContent(
  fixture: CaseFixture,
  state: CaseState,
  selection: TraceSelection,
) {
  const visibleEntities = getVisibleEntities(fixture, state);
  const visibleEvents = getVisibleEvents(fixture, state);
  const visibleJoins = getVisibleJoins(fixture, state);
  if (selection.kind === "model") {
    const allEntities = getAllEntities(fixture);
    const entity = allEntities.find((item) => item.id === selection.id);
    if (entity) {
      const pathIds = fixture.reachability.paths
        .filter((path) => path.entityIds.includes(entity.id))
        .map((path) => path.id);
      return {
        eyebrow: `${humanizeEntityKind(entity.kind)} · Modeled possibility`,
        title: entity.label,
        summary: entity.summary,
        status: "modeled",
        entity,
        fields: [
          { label: "Model", value: fixture.reachability.model },
          { label: "Risk segments", value: pathIds.join(" · ") },
          { label: "Basis", value: fixture.reachability.assumption },
        ],
        relatedEntities: [],
        limitation: fixture.reachability.caveat,
      } as const;
    }

    const path = fixture.reachability.paths.find(
      (candidate) => candidate.id === selection.id,
    );
    if (!path) throw new Error(`Model record ${selection.id} is unavailable.`);
    const relatedEntities = path.entityIds.flatMap((entityId) => {
      const related = allEntities.find((item) => item.id === entityId);
      return related ? [related] : [];
    });
    return {
      eyebrow: `${path.id} · Modeled risk segment`,
      title: relatedEntities.map((item) => item.label).join(" → "),
      summary: fixture.reachability.assumption,
      status: "modeled",
      entity: null,
      fields: [
        { label: "Model", value: fixture.reachability.model },
        {
          label: "Control state",
          value: state.counterfactualAttached
            ? fixture.counterfactual.severedPathIds.includes(path.id)
              ? "Predicted severance · simulation only"
              : "Remains after simulated control"
            : "No control simulation attached",
        },
        {
          label: "Authorization",
          value: state.responseActions.some((actionState) => {
            if (actionState.status !== "authorized_in_demo") return false;
            return fixture.responseActions
              .find((action) => action.id === actionState.actionId)
              ?.seversPathIds.includes(path.id);
          })
            ? "Recorded approval"
            : "Not authorized",
        },
      ],
      relatedEntities,
      limitation: `${fixture.reachability.caveat} ${fixture.counterfactual.caveat}`,
    } as const;
  }
  if (selection.kind === "join") {
    const join = visibleJoins.find((item) => item.id === selection.id);
    if (!join) throw new Error(`Join ${selection.id} is unavailable.`);
    const from = visibleEntities.find(
      (entity) => entity.id === join.fromEntityId,
    );
    const to = visibleEntities.find((entity) => entity.id === join.toEntityId);
    return {
      eyebrow: `${join.id} · Evidence join`,
      title: join.label,
      summary: `${from?.label ?? join.fromEntityId} → ${to?.label ?? join.toEntityId}`,
      status: "correlated",
      entity: null,
      fields: [
        { label: "Match field", value: join.matchField },
        { label: "Match value", value: join.matchValue },
        { label: "Evidence", value: join.evidenceIds.join(" · ") },
        { label: "Relation", value: join.relation },
      ],
      relatedEntities: [from, to].filter((entity): entity is Entity =>
        Boolean(entity),
      ),
      limitation: join.limitation,
    } as const;
  }

  if (selection.kind === "entity") {
    const entity = visibleEntities.find((item) => item.id === selection.id);
    if (!entity) throw new Error(`Entity ${selection.id} is unavailable.`);
    return {
      eyebrow: `${humanizeEntityKind(entity.kind)} · ${entity.provider}`,
      title: entity.label,
      summary: entity.summary,
      status: null,
      entity,
      fields: entityFields(entity),
      relatedEntities: [],
      limitation: null,
    } as const;
  }

  const event = visibleEvents.find((item) => item.id === selection.id);
  if (!event) throw new Error(`Event ${selection.id} is unavailable.`);
  const primaryEntityId = event.entityIds.at(-1) ?? event.entityIds[0];
  const entity = visibleEntities.find((item) => item.id === primaryEntityId);
  const relatedEntities = visibleEntities.filter(
    (item) => event.entityIds.includes(item.id) && item.id !== entity?.id,
  );
  return {
    eyebrow: `${event.id} · ${event.sourceLabel}`,
    title: entity?.label ?? event.action,
    summary: event.summary,
    status: "observed",
    entity: entity ?? null,
    fields: [
      { label: "Event", value: event.action },
      { label: "Time", value: formatUtcTime(event.timestamp) },
      ...eventFields(event),
    ],
    relatedEntities,
    limitation: null,
  } as const;
}

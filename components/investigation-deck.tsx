import type { CaseToolName } from "@/domain/operations";
import { getQueryConsoleContract } from "@/domain/query-console";
import type { CSSProperties } from "react";
import type {
  CaseFixture,
  CaseState,
  Entity,
  InvestigationQueryDefinition,
  OperationReceipt,
} from "@/domain/types";
import {
  getAllEntities,
  getVisibleEnrichments,
  getVisibleEvents,
  getVisibleJoins,
} from "@/domain/incident-stream";
import { enrichmentFields, humanizeEntityKind } from "@/lib/format";
import type {
  InvestigationActivity,
  InvestigationResultView,
} from "./investigation-activity";
import type { TraceSelection } from "./trace-interaction";
import { EntityGlyph } from "./entity-glyph";

interface InvestigationDeckProps {
  fixture: CaseFixture;
  state: CaseState;
  selection: TraceSelection;
  activity: InvestigationActivity;
  result: InvestigationResultView | null;
  receipts: readonly OperationReceipt[];
  busy: boolean;
  onExecute: (
    toolName: CaseToolName,
    input: Record<string, unknown>,
  ) => Promise<void>;
  onSelect: (selection: TraceSelection) => void;
}

export function InvestigationDeck({
  fixture,
  state,
  selection,
  activity,
  result,
  receipts,
  busy,
  onExecute,
  onSelect,
}: InvestigationDeckProps) {
  const entity = resolveSelectedEntity(fixture, state, selection);
  const availableQueries = entity
    ? fixture.investigationQueries.filter(
        (query) =>
          query.targetEntityId === entity.id &&
          (query.requiresStageId === null ||
            state.releasedStreamStageIds.includes(query.requiresStageId)),
      )
    : [];
  const selectedQuery = selectCurrentQuery(
    availableQueries,
    state.attachedEnrichmentIds,
    activity,
    result,
  );
  const selectedResult = result?.queryId === selectedQuery?.id ? result : null;
  const selectedReceipt = selectedQuery
    ? ([...receipts]
        .reverse()
        .find(
          (receipt) =>
            receipt.status === "completed" &&
            receipt.toolName === "run_investigation_query" &&
            receipt.title === selectedQuery.title,
        ) ?? null)
    : null;
  const resultActor = selectedResult
    ? selectedResult.actor
    : selectedReceipt?.reportedSurface === "webmcp_callback"
      ? "agent"
      : selectedReceipt
        ? "analyst"
        : null;
  const resultRevision =
    selectedResult?.resultRevision ??
    selectedReceipt?.resultRevision ??
    state.revision;
  const artifact = selectedQuery
    ? (getVisibleEnrichments(fixture, state).find(
        (candidate) => candidate.id === selectedQuery.resultArtifactId,
      ) ?? null)
    : null;
  const attached = selectedQuery
    ? state.attachedEnrichmentIds.includes(selectedQuery.resultArtifactId)
    : false;
  const running =
    activity.status === "running" &&
    activity.queryId !== null &&
    activity.queryId === selectedQuery?.id;
  const scanned = selectedQuery ? syntheticRecordCount(selectedQuery) : 0;
  const decisionEvidenceCount = fixture.decision.requiresEnrichmentIds.filter(
    (artifactId) => state.attachedEnrichmentIds.includes(artifactId),
  ).length;
  const decisionReadiness =
    fixture.decision.requiresEnrichmentIds.length === 0
      ? 1
      : decisionEvidenceCount / fixture.decision.requiresEnrichmentIds.length;
  return (
    <section
      className="investigation-deck"
      aria-label="Analyst evidence queries"
    >
      <div className="investigation-pivot">
        <span className="pivot-glyph">
          {entity ? <EntityGlyph kind={entity.kind} /> : <span>?</span>}
        </span>
        <div>
          <p>Selected item</p>
          <strong>{entity?.label ?? "Select an item"}</strong>
          <small>
            {entity
              ? `${humanizeEntityKind(entity.kind)} · ${attached ? "finding attached" : "query available"}`
              : "Select a node or path to investigate"}
          </small>
        </div>
      </div>

      <div className="investigation-probes" aria-label="Available queries">
        {selectedQuery ? (
          <button
            className="probe-primary"
            disabled={busy || attached}
            onClick={() =>
              void onExecute("run_investigation_query", {
                expectedRevision: state.revision,
                queryId: selectedQuery.id,
                queryText:
                  getQueryConsoleContract(selectedQuery.id)?.text ?? "",
              })
            }
            type="button"
          >
            <span>{attached ? "Finding attached" : "Run query"}</span>
            <strong>{selectedQuery.title}</strong>
            <small>
              {selectedQuery.sourceScopes.length} sources · results appear here
              when complete
            </small>
            <em className="probe-action" aria-hidden="true">
              {attached ? "Attached" : "Run →"}
            </em>
          </button>
        ) : (
          <div className="probe-empty">
            <span>No additional query is available for this item</span>
            <small>Review nearby activity or find its first occurrence.</small>
          </div>
        )}
        <button
          disabled={busy || !entity}
          onClick={() =>
            entity &&
            void onExecute("query_related_activity", {
              entityId: entity.id,
              beforeMinutes: 15,
              afterMinutes: 15,
            })
          }
          type="button"
        >
          <span>Activity around this item</span>
          <strong>±15 min</strong>
        </button>
        <button
          disabled={busy || !entity}
          onClick={() =>
            entity &&
            void onExecute("find_first_occurrence", {
              entityId: entity.id,
            })
          }
          type="button"
        >
          <span>Find first activity</span>
          <strong>First seen</strong>
        </button>
      </div>

      <div className="decision-spectrum" aria-label="Decision status">
        <div className="decision-gate-copy">
          <span>Decision status</span>
          <strong>
            {decisionEvidenceCount} of{" "}
            {fixture.decision.requiresEnrichmentIds.length} required evidence
            records attached
          </strong>
          <small>{fixture.decision.question}</small>
        </div>
        <div className="decision-gate-state">
          <i
            aria-hidden="true"
            style={
              { "--decision-readiness": decisionReadiness } as CSSProperties
            }
          />
          <small>
            When evidence supports it:{" "}
            {fixture.decision.options[0]?.label ?? "path A"} or{" "}
            {fixture.decision.options[1]?.label ?? "path B"}
          </small>
        </div>
      </div>

      {running && selectedQuery ? (
        <div className="query-live-run" role="status">
          <div className="query-live-heading">
            <span>
              {activity.actor === "agent"
                ? "Agent · Running"
                : "Analyst · Query requested"}
            </span>
            <code>{selectedQuery.id}</code>
            <strong>
              {selectedQuery.sourceScopes.length} sources selected
            </strong>
          </div>
          <div className="query-scan-track" aria-hidden="true">
            <i />
          </div>
          <ol>
            <li className="query-stage-complete">Sources validated</li>
            <li className="query-stage-active">Querying records</li>
            <li>Correlating matches</li>
            <li>Attaching evidence</li>
          </ol>
        </div>
      ) : null}

      {selectedQuery && attached && artifact ? (
        <details
          className="query-result-drawer"
          key={`${selectedQuery.id}-${resultRevision}`}
        >
          <summary>
            <span className={`truth-badge truth-${artifact.status}`}>
              {artifact.status}
            </span>
            <span>
              <small>
                {resultActor === "agent"
                  ? "Agent result"
                  : resultActor === "analyst"
                    ? "Analyst result"
                    : "Query result"}{" "}
                · r{resultRevision}
              </small>
              <strong>{selectedQuery.resultChange}</strong>
            </span>
            <em>View result</em>
          </summary>
          <div className="query-result-body">
            <div className="query-result-flag">
              <span>
                {resultActor === "agent"
                  ? "Agent result"
                  : resultActor === "analyst"
                    ? "Analyst result"
                    : "Query result"}
              </span>
              <strong>{artifact.summary}</strong>
              <small>{artifact.caveat}</small>
            </div>
            <dl className="query-result-facts">
              {enrichmentFields(artifact).map((field) => (
                <div key={field.label}>
                  <dt>{field.label}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
            <dl className="query-result-metrics">
              <div>
                <dt>Scanned</dt>
                <dd>{formatCount(scanned)}</dd>
              </div>
              <div>
                <dt>Matched</dt>
                <dd>{selectedQuery.matchedRecordCount}</dd>
              </div>
              <div>
                <dt>Returned</dt>
                <dd>{selectedQuery.returnedRecordCount}</dd>
              </div>
              <div>
                <dt>Case revision</dt>
                <dd>r{resultRevision}</dd>
              </div>
            </dl>
            <div className="query-source-ledger">
              <p>Sources searched</p>
              {selectedQuery.sourceScopes.map((scope) => (
                <button
                  key={`${selectedQuery.id}-${scope.sourceLabel}`}
                  onClick={() =>
                    entity && onSelect({ kind: "entity", id: entity.id })
                  }
                  type="button"
                >
                  <span>{scope.sourceLabel}</span>
                  <strong>{formatCount(scope.syntheticRecordCount)}</strong>
                  <small>
                    {scope.timeRange.start.slice(0, 10)} →{" "}
                    {scope.timeRange.end.slice(0, 10)}
                  </small>
                </button>
              ))}
            </div>
            <div className="query-result-protocol">
              <code>run_investigation_query</code>
              <span>{selectedQuery.id}</span>
              <small>{selectedQuery.caveat}</small>
            </div>
          </div>
        </details>
      ) : result &&
        isBoundedReadResult(result.toolName) &&
        result.queryId === null &&
        entity &&
        result.targetEntityId === entity.id ? (
        <details className="query-result-drawer query-result-read">
          <summary>
            <span className="truth-badge truth-observed">read</span>
            <span>
              <small>
                {result.actor === "agent"
                  ? "Agent result"
                  : "Analyst-requested result"}{" "}
                · r{result.resultRevision}
              </small>
              <strong>{result.summary}</strong>
            </span>
            <em>Details</em>
          </summary>
          <div className="query-result-body">
            <div className="query-result-flag">
              <span>Case data read</span>
              <strong>{result.summary}</strong>
              <small>
                This read searched available case events only. It did not add or
                change evidence.
              </small>
            </div>
          </div>
        </details>
      ) : null}
    </section>
  );
}

function selectCurrentQuery(
  availableQueries: readonly InvestigationQueryDefinition[],
  attachedEnrichmentIds: readonly string[],
  activity: InvestigationActivity,
  result: InvestigationResultView | null,
): InvestigationQueryDefinition | null {
  const activeQueryId =
    activity.status !== "idle" ? activity.queryId : result?.queryId;
  return (
    availableQueries.find((query) => query.id === activeQueryId) ??
    availableQueries.find(
      (query) => !attachedEnrichmentIds.includes(query.resultArtifactId),
    ) ??
    availableQueries[0] ??
    null
  );
}

function resolveSelectedEntity(
  fixture: CaseFixture,
  state: CaseState,
  selection: TraceSelection,
): Entity | null {
  const entities = getAllEntities(fixture);
  if (selection.kind === "entity") {
    return entities.find((entity) => entity.id === selection.id) ?? null;
  }
  if (selection.kind === "event") {
    const event = getVisibleEvents(fixture, state).find(
      (candidate) => candidate.id === selection.id,
    );
    return (
      entities.find((entity) => entity.id === event?.entityIds.at(-1)) ?? null
    );
  }
  if (selection.kind === "join") {
    const join = getVisibleJoins(fixture, state).find(
      (candidate) => candidate.id === selection.id,
    );
    return entities.find((entity) => entity.id === join?.toEntityId) ?? null;
  }
  const direct = entities.find((entity) => entity.id === selection.id);
  if (direct) return direct;
  const path = fixture.reachability.paths.find(
    (candidate) => candidate.id === selection.id,
  );
  return (
    entities.find((entity) => entity.id === path?.entityIds.at(-1)) ?? null
  );
}

function syntheticRecordCount(query: InvestigationQueryDefinition): number {
  return query.sourceScopes.reduce(
    (total, scope) => total + scope.syntheticRecordCount,
    0,
  );
}

function isBoundedReadResult(toolName: CaseToolName): boolean {
  return [
    "inspect_event",
    "inspect_entity",
    "inspect_relationship",
    "search_events",
    "find_first_occurrence",
    "compare_timepoints",
    "query_related_activity",
  ].includes(toolName);
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: value >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

"use client";

import Link from "next/link";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  ReferenceCase,
  ReferenceEntity,
  ReferenceJoin,
  ReferenceQueryInsight,
} from "@/domain/reference-cases";
import { getReferenceQueryExecution } from "@/domain/reference-evidence";
import { formatUtcTime } from "@/lib/format";
import {
  registerCaseTools,
  type ToolRegistrationOutcome,
} from "@/webmcp/tools";
import { PlatformShell, type AgentStatus } from "./platform-shell";
import {
  createReferenceToolDefinitions,
  type ReferenceToolFailure,
  type ReferenceToolName,
  type ReferenceToolResult,
  type ReferenceToolSuccess,
} from "./reference-webmcp";
import { useModalDialog } from "./use-modal-dialog";

interface ReferenceReceipt {
  id: string;
  actor: "agent" | "analyst";
  toolName: ReferenceToolName;
  summary: string;
}

interface ReferenceActivity {
  status: "idle" | "running" | "completed";
  actor: "agent" | "analyst";
  headline: string;
  detail: string;
}

export function ReferenceCaseWorkbench({
  dossier,
}: {
  dossier: ReferenceCase;
}) {
  const [selectedEntityId, setSelectedEntityId] = useState(
    dossier.entities[0]?.id ?? "",
  );
  const [selectedJoinId, setSelectedJoinId] = useState<string | null>(null);
  const [attachedQueryIds, setAttachedQueryIds] = useState<string[]>([]);
  const [activity, setActivity] = useState<ReferenceActivity>({
    status: "idle",
    actor: "agent",
    headline: "Evidence plan ready",
    detail: `${dossier.queries.length} available queries`,
  });
  const [receipts, setReceipts] = useState<ReferenceReceipt[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({
    state: "checking",
    count: 0,
  });
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);
  const [assessmentOpen, setAssessmentOpen] = useState(false);
  const [registrationOutcomes, setRegistrationOutcomes] = useState<
    ToolRegistrationOutcome[]
  >([]);
  const closeCapabilities = useCallback(() => setCapabilitiesOpen(false), []);
  const closeAssessment = useCallback(() => setAssessmentOpen(false), []);
  const capabilitiesDialogRef = useModalDialog(
    capabilitiesOpen,
    closeCapabilities,
  );
  const assessmentDialogRef = useModalDialog(assessmentOpen, closeAssessment);

  const recordReceipt = useCallback(
    (
      actor: ReferenceReceipt["actor"],
      toolName: ReferenceToolName,
      summary: string,
    ) => {
      setReceipts((current) => [
        ...current,
        {
          id: `REF-${String(current.length + 1).padStart(3, "0")}`,
          actor,
          toolName,
          summary,
        },
      ]);
    },
    [],
  );

  const executeReferenceTool = useCallback(
    async (
      toolName: ReferenceToolName,
      input: Record<string, unknown>,
      actor: ReferenceReceipt["actor"],
      signal?: AbortSignal,
    ): Promise<ReferenceToolResult> => {
      if (signal?.aborted) throw abortError();
      const validation = validateReferenceToolInput(toolName, input);
      if (validation) return validation;
      if (toolName === "get_reference_case") {
        recordReceipt(actor, toolName, `Read ${dossier.id}`);
        return referenceSuccess({
          caseId: dossier.id,
          title: dossier.title,
          observedImpact: dossier.observedImpact,
          tier1: dossier.tier1,
          availableQueryIds: dossier.queries.map((query) => query.id),
          synthetic: true,
          persistence: "session_local",
        });
      }
      if (
        toolName === "inspect_reference_entity" ||
        toolName === "focus_reference_entity"
      ) {
        const entity = dossier.entities.find(
          (candidate) => candidate.id === input.entityId,
        );
        if (!entity) {
          return referenceFailure(
            "INVALID_ENTITY_ID",
            "entityId is not part of this evidence brief.",
          );
        }
        setSelectedEntityId(entity.id);
        setSelectedJoinId(null);
        recordReceipt(actor, toolName, `Focused ${entity.label}`);
        return referenceSuccess({
          entity,
          eventIds: dossier.events
            .filter((event) => event.entityIds.includes(entity.id))
            .map((event) => event.id),
          relationshipIds: dossier.joins
            .filter(
              (join) =>
                join.fromEntityId === entity.id ||
                join.toEntityId === entity.id,
            )
            .map((join) => join.id),
        });
      }
      if (toolName === "inspect_reference_event") {
        const event = dossier.events.find(
          (candidate) => candidate.id === input.eventId,
        );
        if (!event) {
          return referenceFailure(
            "INVALID_EVENT_ID",
            "eventId is not part of this evidence brief.",
          );
        }
        const focus = event.entityIds.at(-1);
        if (focus) setSelectedEntityId(focus);
        setSelectedJoinId(null);
        recordReceipt(actor, toolName, `Inspected ${event.id}`);
        return referenceSuccess({ event });
      }
      if (toolName === "inspect_reference_relationship") {
        const relationship = dossier.joins.find(
          (candidate) => candidate.id === input.relationshipId,
        );
        if (!relationship) {
          return referenceFailure(
            "INVALID_RELATIONSHIP_ID",
            "relationshipId is not part of this evidence brief.",
          );
        }
        setSelectedJoinId(relationship.id);
        setSelectedEntityId(relationship.toEntityId);
        recordReceipt(actor, toolName, `Inspected ${relationship.label}`);
        return referenceSuccess({ relationship });
      }
      if (toolName === "run_reference_query") {
        const query = dossier.queries.find(
          (candidate) => candidate.id === input.queryId,
        );
        if (!query) {
          return referenceFailure(
            "INVALID_QUERY_ID",
            "queryId is not part of this evidence brief.",
          );
        }
        const execution = getReferenceQueryExecution(query.id);
        if (!execution) {
          return referenceFailure(
            "EVIDENCE_UNAVAILABLE",
            "The bounded query evidence is unavailable.",
            true,
          );
        }
        setActivity({
          status: "running",
          actor,
          headline: query.title,
          detail: `${formatCount(recordsInScope(query))} records`,
        });
        await boundedDelay(referenceQueryDelay(query), signal);
        setAttachedQueryIds((current) =>
          current.includes(query.id) ? current : [...current, query.id],
        );
        setSelectedEntityId(query.targetEntityId);
        setSelectedJoinId(null);
        setActivity({
          status: "completed",
          actor,
          headline: query.dominantMetric,
          detail: query.result,
        });
        recordReceipt(
          actor,
          toolName,
          `${query.title} · ${query.dominantMetric}`,
        );
        return referenceSuccess({
          queryId: query.id,
          language: execution.language,
          queryText: execution.text,
          matchedRecords: query.matchedRecords,
          returnedRecords: execution.records,
          result: query.result,
          synthetic: true,
          persistence: "session_local",
        });
      }
      if (toolName === "run_reference_investigation_plan") {
        setActivity({
          status: "running",
          actor,
          headline: "Running TRACE evidence plan",
          detail: `${formatCount(dossier.queries.reduce((sum, query) => sum + recordsInScope(query), 0))} records`,
        });
        for (const query of dossier.queries) {
          await boundedDelay(720, signal);
          setAttachedQueryIds((current) =>
            current.includes(query.id) ? current : [...current, query.id],
          );
          setSelectedEntityId(query.targetEntityId);
        }
        setActivity({
          status: "completed",
          actor,
          headline: `${dossier.queries.length} results added`,
          detail: dossier.assessment.disposition,
        });
        recordReceipt(
          actor,
          toolName,
          `${dossier.queries.length} results added from ${dossier.sources.length} evidence systems`,
        );
        return referenceSuccess({
          queryResults: dossier.queries,
          aggregate: {
            evidenceAttached: dossier.queries.length,
            syntheticRecordCount: dossier.queries.reduce(
              (sum, query) => sum + recordsInScope(query),
              0,
            ),
          },
          synthetic: true,
          persistence: "session_local",
        });
      }
      return referenceFailure(
        "TOOL_NOT_IMPLEMENTED",
        "This reference operation is not implemented.",
      );
    },
    [dossier, recordReceipt],
  );

  const definitions = useMemo(
    () => createReferenceToolDefinitions(dossier, executeReferenceTool),
    [dossier, executeReferenceTool],
  );

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function register() {
      const result = await registerCaseTools(
        definitions,
        controller,
        document.modelContext,
      );
      if (!active) return;
      if (!result.supported) {
        setAgentStatus({ state: "unavailable", count: 0 });
      } else {
        setAgentStatus({
          state:
            result.readiness.ready && result.registered === definitions.length
              ? "available"
              : "partial",
          count: result.registered,
          total: definitions.length,
        });
      }
      setRegistrationOutcomes(result.outcomes);
    }
    void register();
    return () => {
      active = false;
      controller.abort();
    };
  }, [definitions]);

  const selectedEntity =
    dossier.entities.find((entity) => entity.id === selectedEntityId) ?? null;
  const selectedJoin =
    dossier.joins.find((join) => join.id === selectedJoinId) ?? null;
  const planComplete = attachedQueryIds.length === dossier.queries.length;

  return (
    <PlatformShell
      activeView="case"
      agentStatus={agentStatus}
      fixture={{ id: dossier.id, alerts: dossier.events }}
      onOpenAgent={() => setCapabilitiesOpen(true)}
      onReset={() => {
        setAttachedQueryIds([]);
        setReceipts([]);
        setAssessmentOpen(false);
        setSelectedEntityId(dossier.entities[0]?.id ?? "");
        setSelectedJoinId(null);
        setActivity({
          status: "idle",
          actor: "agent",
          headline: "Evidence plan ready",
          detail: `${dossier.queries.length} available queries`,
        });
      }}
    >
      <div className="reference-case-view">
        <header className="reference-case-rail">
          <div>
            <span className="severity severity-high">High</span>
            <span>Tier 1 evidence brief</span>
            <strong>{dossier.title}</strong>
            <h1 className="visually-hidden">{dossier.title}</h1>
          </div>
          <p>{dossier.observedImpact}</p>
          <small>
            {dossier.events.length} observed · {dossier.timeRange}
          </small>
        </header>

        <section
          aria-labelledby="reference-evidence-path-title"
          className="reference-workbench"
        >
          <header className="reference-map-toolbar">
            <div>
              <span>Evidence path</span>
              <strong id="reference-evidence-path-title">
                {dossier.primaryQuestion}
              </strong>
            </div>
            <div
              aria-atomic="true"
              aria-live="polite"
              role="status"
              className={`reference-agent-now reference-agent-${activity.status}`}
            >
              <span>
                {activity.actor === "agent" ? "TRACE now" : "Analyst directed"}
              </span>
              <strong>{activity.headline}</strong>
              <small>{activity.detail}</small>
            </div>
            <button
              disabled={activity.status === "running" || planComplete}
              onClick={() =>
                void executeReferenceTool(
                  "run_reference_investigation_plan",
                  {},
                  "analyst",
                )
              }
              type="button"
            >
              {planComplete ? "Evidence plan complete" : "Run evidence plan"}
            </button>
          </header>

          <div className="reference-map-layout">
            <ReferenceGraph
              attachedQueryIds={attachedQueryIds}
              dossier={dossier}
              onSelectEntity={(entityId) => {
                setSelectedEntityId(entityId);
                setSelectedJoinId(null);
              }}
              onSelectJoin={(joinId) => {
                const join = dossier.joins.find((item) => item.id === joinId);
                setSelectedJoinId(joinId);
                if (join) setSelectedEntityId(join.toEntityId);
              }}
              selectedEntityId={selectedEntityId}
              selectedJoinId={selectedJoinId}
            />
            <ReferenceInspector
              dossier={dossier}
              entity={selectedEntity}
              join={selectedJoin}
              onRunQuery={(query) =>
                void executeReferenceTool(
                  "run_reference_query",
                  { queryId: query.id },
                  "analyst",
                )
              }
              running={activity.status === "running"}
              attachedQueryIds={attachedQueryIds}
            />
          </div>

          <section
            className="reference-query-field"
            aria-labelledby="reference-query-insights-title"
          >
            <header>
              <span id="reference-query-insights-title">Query insights</span>
              <strong>
                {attachedQueryIds.length} finding
                {attachedQueryIds.length === 1 ? "" : "s"} attached
              </strong>
              <small>Bounded source snapshots</small>
            </header>
            <div>
              {dossier.queries.map((query) => {
                const attached = attachedQueryIds.includes(query.id);
                return (
                  <details
                    className={attached ? "query-attached" : ""}
                    key={query.id}
                  >
                    <summary>
                      <span>{query.capability}</span>
                      <strong>{query.title}</strong>
                      <em>{attached ? query.dominantMetric : "Available"}</em>
                    </summary>
                    <div>
                      <p>{attached ? query.result : query.question}</p>
                      <dl>
                        <div>
                          <dt>Scope</dt>
                          <dd>{formatCount(recordsInScope(query))}</dd>
                        </div>
                        <div>
                          <dt>Matched</dt>
                          <dd>{query.matchedRecords}</dd>
                        </div>
                        <div>
                          <dt>Returned</dt>
                          <dd>{query.returnedRecords}</dd>
                        </div>
                      </dl>
                      <small>
                        {query.workspace === "fixture_artifact"
                          ? "Archived malware analysis · no binary executed"
                          : query.caveat}
                      </small>
                      <ReferenceQueryEvidence
                        attached={attached}
                        query={query}
                      />
                    </div>
                  </details>
                );
              })}
            </div>
          </section>

          <div className="reference-lower-field">
            <details className="reference-timeline">
              <summary>
                Evidence timeline <span>{dossier.events.length}</span>
              </summary>
              <ol>
                {dossier.events.map((event) => (
                  <li key={event.id}>
                    <button
                      onClick={() => {
                        const focus = event.entityIds.at(-1);
                        if (focus) setSelectedEntityId(focus);
                        setSelectedJoinId(null);
                      }}
                      type="button"
                    >
                      <time>{formatUtcTime(event.timestamp)}</time>
                      <span>{event.source}</span>
                      <strong>{event.summary}</strong>
                    </button>
                  </li>
                ))}
              </ol>
            </details>
            <section className="reference-decision">
              <span>Analyst decision</span>
              <strong>{dossier.primaryQuestion}</strong>
              {planComplete ? (
                <button onClick={() => setAssessmentOpen(true)} type="button">
                  Review evidence assessment
                </button>
              ) : (
                <small>
                  Review the attached evidence before recording a disposition.
                </small>
              )}
            </section>
          </div>
        </section>

        <footer className="reference-boundary">
          Session-local evidence brief · bounded case snapshot · results reset
          when this page is reopened · no shared response workflow or external
          control
        </footer>
      </div>

      {capabilitiesOpen ? (
        <ReferenceCapabilityDrawer
          dialogRef={capabilitiesDialogRef}
          definitions={definitions}
          dossier={dossier}
          onClose={closeCapabilities}
          outcomes={registrationOutcomes}
          receipts={receipts}
        />
      ) : null}
      {assessmentOpen ? (
        <ReferenceAssessment
          dialogRef={assessmentDialogRef}
          dossier={dossier}
          onClose={closeAssessment}
        />
      ) : null}
    </PlatformShell>
  );
}

function ReferenceGraph({
  dossier,
  selectedEntityId,
  selectedJoinId,
  attachedQueryIds,
  onSelectEntity,
  onSelectJoin,
}: {
  dossier: ReferenceCase;
  selectedEntityId: string;
  selectedJoinId: string | null;
  attachedQueryIds: readonly string[];
  onSelectEntity: (entityId: string) => void;
  onSelectJoin: (joinId: string) => void;
}) {
  const flaggedEntityIds = new Set(
    dossier.queries
      .filter((query) => attachedQueryIds.includes(query.id))
      .map((query) => query.targetEntityId),
  );
  return (
    <div className="reference-graph" aria-label="Interactive evidence path">
      <div className="reference-grid" aria-hidden="true" />
      <svg viewBox="0 0 1240 590" aria-label="Reference relationships">
        <defs>
          <marker
            id="reference-arrow"
            markerHeight="7"
            markerWidth="9"
            orient="auto"
            refX="8"
            refY="3.5"
          >
            <path d="M0 0L9 3.5L0 7Z" />
          </marker>
        </defs>
        {dossier.joins.map((join) => {
          const from = dossier.entities.find(
            (entity) => entity.id === join.fromEntityId,
          );
          const to = dossier.entities.find(
            (entity) => entity.id === join.toEntityId,
          );
          if (!from || !to) return null;
          const selected = selectedJoinId === join.id;
          return (
            <path
              aria-label={`${join.label}: ${from.label} to ${to.label}`}
              className={`${join.status} ${selected ? "selected" : ""}`}
              d={referencePath(from, to)}
              key={join.id}
              markerEnd="url(#reference-arrow)"
              onClick={() => onSelectJoin(join.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectJoin(join.id);
                }
              }}
              role="button"
              tabIndex={0}
            />
          );
        })}
      </svg>
      {dossier.entities.map((entity) => {
        const flagged = flaggedEntityIds.has(entity.id);
        return (
          <button
            aria-pressed={selectedEntityId === entity.id}
            className={`reference-node reference-node-${entity.kind} ${flagged ? "reference-node-flagged" : ""}`}
            key={entity.id}
            onClick={() => onSelectEntity(entity.id)}
            style={{ left: entity.x, top: entity.y }}
            type="button"
          >
            <span>{entityKindLabel(entity.kind)}</span>
            <strong>{entity.label}</strong>
            <small>{entity.summary}</small>
            {flagged ? <em>TRACE result</em> : null}
          </button>
        );
      })}
      {dossier.joins.map((join) => {
        const from = dossier.entities.find(
          (entity) => entity.id === join.fromEntityId,
        );
        const to = dossier.entities.find(
          (entity) => entity.id === join.toEntityId,
        );
        if (!from || !to) return null;
        return (
          <button
            className="reference-edge-label"
            key={`label-${join.id}`}
            onClick={() => onSelectJoin(join.id)}
            style={{
              left: (from.x + to.x) / 2 + 80,
              top: (from.y + to.y) / 2 + 18,
            }}
            type="button"
          >
            {join.label}
          </button>
        );
      })}
    </div>
  );
}

function ReferenceInspector({
  dossier,
  entity,
  join,
  attachedQueryIds,
  running,
  onRunQuery,
}: {
  dossier: ReferenceCase;
  entity: ReferenceEntity | null;
  join: ReferenceJoin | null;
  attachedQueryIds: readonly string[];
  running: boolean;
  onRunQuery: (query: ReferenceQueryInsight) => void;
}) {
  if (!entity) return <aside className="reference-inspector" />;
  const query = dossier.queries.find(
    (item) => item.targetEntityId === entity.id,
  );
  const attached = query ? attachedQueryIds.includes(query.id) : false;
  return (
    <aside className="reference-inspector">
      <header>
        <span>{entityKindLabel(entity.kind)}</span>
        <strong>{entity.label}</strong>
        <small>{entity.summary}</small>
      </header>
      <dl>
        {entity.attributes.map((attribute) => (
          <div key={attribute.label}>
            <dt>{attribute.label}</dt>
            <dd>{attribute.value}</dd>
          </div>
        ))}
      </dl>
      {join ? (
        <section className="reference-join-insight">
          <span>{join.status} relationship</span>
          <strong>{join.label}</strong>
          <p>{join.limitation}</p>
          <small>{join.evidenceIds.join(" · ")}</small>
        </section>
      ) : null}
      {query ? (
        <section className="reference-inspector-action">
          <span>TRACE capability</span>
          <code>{query.capability}</code>
          <strong>{attached ? query.dominantMetric : query.question}</strong>
          <ReferenceQuerySource query={query} />
          <button
            disabled={running || attached}
            onClick={() => onRunQuery(query)}
            type="button"
          >
            {attached ? "Result added" : "Run investigation"}
          </button>
        </section>
      ) : (
        <small className="reference-inspector-note">
          Read-only evidence entity
        </small>
      )}
    </aside>
  );
}

function ReferenceQuerySource({ query }: { query: ReferenceQueryInsight }) {
  const execution = getReferenceQueryExecution(query.id);
  if (!execution) return null;
  return (
    <details className="reference-query-source">
      <summary>View query</summary>
      <div>
        <span>{execution.language}</span>
        <code>{query.id}</code>
      </div>
      <pre>{execution.text}</pre>
    </details>
  );
}

function ReferenceQueryEvidence({
  attached,
  query,
}: {
  attached: boolean;
  query: ReferenceQueryInsight;
}) {
  const execution = getReferenceQueryExecution(query.id);
  if (!execution) return null;
  return (
    <div className="reference-query-evidence">
      <ReferenceQuerySource query={query} />
      {attached ? (
        <details className="reference-returned-records">
          <summary>
            Source records <strong>{execution.records.length}</strong>
          </summary>
          <div>
            {execution.records.map((record) => (
              <details key={record.id}>
                <summary>
                  <time dateTime={record.timestamp}>
                    {formatUtcTime(record.timestamp)}
                  </time>
                  <span>{record.source}</span>
                  <strong>{record.recordType}</strong>
                </summary>
                <dl>
                  {record.fields.map((field) => (
                    <div key={field.label}>
                      <dt>{field.label}</dt>
                      <dd>{field.value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            ))}
          </div>
        </details>
      ) : (
        <small>Run the query to attach exact returned records.</small>
      )}
    </div>
  );
}

function ReferenceCapabilityDrawer({
  dossier,
  definitions,
  dialogRef,
  outcomes,
  receipts,
  onClose,
}: {
  dossier: ReferenceCase;
  definitions: WebMcpToolDefinition[];
  dialogRef: RefObject<HTMLElement | null>;
  outcomes: readonly ToolRegistrationOutcome[];
  receipts: readonly ReferenceReceipt[];
  onClose: () => void;
}) {
  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside
        aria-labelledby="reference-capability-title"
        aria-modal="true"
        className="agent-drawer reference-capability-drawer"
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
      >
        <header className="drawer-header">
          <div>
            <p className="eyebrow">Evidence brief tools</p>
            <h2 id="reference-capability-title">TRACE tool surface</h2>
          </div>
          <button
            aria-label="Close capabilities"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>
        <div className="capability-matrix">
          <article>
            <span>Can read</span>
            <strong>Entities, events, relationships</strong>
            <small>Released dossier evidence only</small>
          </article>
          <article>
            <span>Can query</span>
            <strong>{dossier.queries.length} bounded investigations</strong>
            <small>Canonical KQL and returned source records</small>
          </article>
          <article>
            <span>Can sequence</span>
            <strong>Evidence-driven pivots</strong>
            <small>Ordered findings from released case evidence</small>
          </article>
          <article className="capability-matrix-analyst">
            <span>Analyst only</span>
            <strong>Disposition and response</strong>
            <small>No containment tools in this brief</small>
          </article>
        </div>
        <div className="reference-tool-list">
          {definitions.map((definition) => {
            const outcome = outcomes.find(
              (candidate) => candidate.name === definition.name,
            );
            return (
              <article key={definition.name}>
                <span>{outcome?.status ?? "checking"}</span>
                <strong>{definition.title}</strong>
                <code>{definition.name}</code>
                <small>{definition.description}</small>
                {outcome?.error ? (
                  <small className="capability-error">{outcome.error}</small>
                ) : null}
              </article>
            );
          })}
        </div>
        <footer>
          {receipts.length} session-local operations · 0 external controls
        </footer>
      </aside>
    </div>
  );
}

function ReferenceAssessment({
  dossier,
  dialogRef,
  onClose,
}: {
  dossier: ReferenceCase;
  dialogRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside
        aria-labelledby="reference-assessment-title"
        aria-modal="true"
        className="reference-assessment"
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <span>Evidence assessment</span>
          <button aria-label="Close assessment" onClick={onClose} type="button">
            ×
          </button>
        </header>
        <h2 id="reference-assessment-title">
          {dossier.assessment.disposition}
        </h2>
        <p>{dossier.assessment.conclusion}</p>
        <section>
          <span>Confirmed</span>
          <ul>
            {dossier.assessment.confirmed.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
        <section>
          <span>Limits</span>
          <ul>
            {dossier.assessment.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
        <details>
          <summary>Technique context</summary>
          {dossier.techniques.map((technique) => (
            <p key={technique.id}>
              <code>{technique.id}</code>
              <strong>{technique.label}</strong>
              <small>{technique.qualification}</small>
            </p>
          ))}
        </details>
        <footer>
          <Link href="/alerts">Return to incident ledger</Link>
        </footer>
      </aside>
    </div>
  );
}

export function legacyCreateReferenceToolDefinitions(
  dossier: ReferenceCase,
  execute: (
    toolName: ReferenceToolName,
    input: Record<string, unknown>,
    actor: "agent",
    signal?: AbortSignal,
  ) => Promise<ReferenceToolResult>,
): WebMcpToolDefinition[] {
  const create = (
    name: ReferenceToolName,
    title: string,
    description: string,
    properties: Record<string, unknown>,
    required: string[],
    readOnly: boolean,
  ): WebMcpToolDefinition => ({
    name,
    title,
    description,
    inputSchema: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
    annotations: { readOnlyHint: readOnly, untrustedContentHint: true },
    execute: async (input, context) => {
      const validation = validateReferenceToolInput(name, input);
      if (validation) return validation;
      return execute(name, input, "agent", context?.signal);
    },
  });
  return [
    create(
      "get_reference_case",
      "Read reference case",
      "Return Tier 1 observations, the evidence scope, available queries, and current shared results.",
      {},
      [],
      true,
    ),
    create(
      "inspect_reference_entity",
      "Inspect reference entity",
      "Return one typed entity and its evidence relationships.",
      {
        entityId: {
          type: "string",
          enum: dossier.entities.map((entity) => entity.id),
        },
      },
      ["entityId"],
      true,
    ),
    create(
      "inspect_reference_event",
      "Inspect reference event",
      "Return one observed event from the dossier.",
      {
        eventId: {
          type: "string",
          enum: dossier.events.map((event) => event.id),
        },
      },
      ["eventId"],
      true,
    ),
    create(
      "inspect_reference_relationship",
      "Inspect reference relationship",
      "Return one correlation with evidence IDs and its explicit limitation.",
      {
        relationshipId: {
          type: "string",
          enum: dossier.joins.map((join) => join.id),
        },
      },
      ["relationshipId"],
      true,
    ),
    create(
      "focus_reference_entity",
      "Focus shared evidence entity",
      "Move the shared reference view to one dossier entity without changing evidence.",
      {
        entityId: {
          type: "string",
          enum: dossier.entities.map((entity) => entity.id),
        },
      },
      ["entityId"],
      true,
    ),
    create(
      "run_reference_query",
      "Run reference query",
      "Run one bounded canonical query, return its exact source records, and add the result to the shared brief.",
      {
        queryId: {
          type: "string",
          enum: dossier.queries.map((query) => query.id),
        },
      },
      ["queryId"],
      false,
    ),
    create(
      "run_reference_investigation_plan",
      "Run reference investigation plan",
      "Execute all currently defined dossier queries in stable order and attach the evidence insights as one TRACE-led phase.",
      {},
      [],
      false,
    ),
  ];
}

function referenceSuccess(data: Record<string, unknown>): ReferenceToolSuccess {
  return { ok: true, data };
}

function referenceFailure(
  code: string,
  message: string,
  retryable = false,
): ReferenceToolFailure {
  return { ok: false, error: { code, message, retryable } };
}

function validateReferenceToolInput(
  toolName: ReferenceToolName,
  input: Record<string, unknown>,
): ReferenceToolFailure | null {
  const expectedField =
    toolName === "inspect_reference_entity" ||
    toolName === "focus_reference_entity"
      ? "entityId"
      : toolName === "inspect_reference_event"
        ? "eventId"
        : toolName === "inspect_reference_relationship"
          ? "relationshipId"
          : toolName === "run_reference_query"
            ? "queryId"
            : null;
  const fields = Object.keys(input);
  if (
    (expectedField === null && fields.length > 0) ||
    (expectedField !== null &&
      (fields.length !== 1 || typeof input[expectedField] !== "string"))
  ) {
    return referenceFailure(
      "INVALID_INPUT",
      expectedField
        ? `${toolName} requires exactly one string field: ${expectedField}.`
        : `${toolName} does not accept input fields.`,
    );
  }
  return null;
}

function referencePath(from: ReferenceEntity, to: ReferenceEntity): string {
  const x1 = from.x + 182;
  const y1 = from.y + 56;
  const x2 = to.x;
  const y2 = to.y + 56;
  const bend = Math.max(45, Math.abs(x2 - x1) * 0.42);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

function entityKindLabel(kind: ReferenceEntity["kind"]): string {
  return kind.replaceAll("_", " ");
}

function recordsInScope(query: ReferenceQueryInsight): number {
  return query.sources.reduce((sum, source) => sum + source.records, 0);
}

function referenceQueryDelay(query: ReferenceQueryInsight): number {
  return 1_200 + Math.min(900, query.returnedRecords * 180);
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: value >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function boundedDelay(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}

function abortError(): Error {
  const error = new Error("Tool invocation aborted.");
  error.name = "AbortError";
  return error;
}

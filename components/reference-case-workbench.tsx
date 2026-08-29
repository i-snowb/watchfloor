"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ReferenceCase,
  ReferenceEntity,
  ReferenceJoin,
  ReferenceQueryInsight,
} from "@/domain/reference-cases";
import { formatUtcTime } from "@/lib/format";
import { PlatformShell, type AgentStatus } from "./platform-shell";

type ReferenceToolName =
  | "get_reference_case"
  | "inspect_reference_entity"
  | "inspect_reference_event"
  | "inspect_reference_relationship"
  | "focus_reference_entity"
  | "run_reference_query"
  | "run_reference_investigation_plan";

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
    ): Promise<unknown> => {
      if (signal?.aborted) throw abortError();
      if (toolName === "get_reference_case") {
        recordReceipt(actor, toolName, `Read ${dossier.id}`);
        return {
          caseId: dossier.id,
          title: dossier.title,
          observedImpact: dossier.observedImpact,
          tier1: dossier.tier1,
          availableQueryIds: dossier.queries.map((query) => query.id),
          synthetic: true,
        };
      }
      if (
        toolName === "inspect_reference_entity" ||
        toolName === "focus_reference_entity"
      ) {
        const entity = dossier.entities.find(
          (candidate) => candidate.id === input.entityId,
        );
        if (!entity) throw new Error("entityId is not part of this dossier.");
        setSelectedEntityId(entity.id);
        setSelectedJoinId(null);
        recordReceipt(actor, toolName, `Focused ${entity.label}`);
        return {
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
        };
      }
      if (toolName === "inspect_reference_event") {
        const event = dossier.events.find(
          (candidate) => candidate.id === input.eventId,
        );
        if (!event) throw new Error("eventId is not part of this dossier.");
        const focus = event.entityIds.at(-1);
        if (focus) setSelectedEntityId(focus);
        setSelectedJoinId(null);
        recordReceipt(actor, toolName, `Inspected ${event.id}`);
        return { event };
      }
      if (toolName === "inspect_reference_relationship") {
        const relationship = dossier.joins.find(
          (candidate) => candidate.id === input.relationshipId,
        );
        if (!relationship) {
          throw new Error("relationshipId is not part of this dossier.");
        }
        setSelectedJoinId(relationship.id);
        setSelectedEntityId(relationship.toEntityId);
        recordReceipt(actor, toolName, `Inspected ${relationship.label}`);
        return { relationship };
      }
      if (toolName === "run_reference_query") {
        const query = dossier.queries.find(
          (candidate) => candidate.id === input.queryId,
        );
        if (!query) throw new Error("queryId is not part of this dossier.");
        setActivity({
          status: "running",
          actor,
          headline: query.title,
          detail: `${formatCount(recordsInScope(query))} records`,
        });
        await boundedDelay(360, signal);
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
        return { query, result: query.result, synthetic: true };
      }
      if (toolName === "run_reference_investigation_plan") {
        setActivity({
          status: "running",
          actor,
          headline: "Running Tier 1 evidence plan",
          detail: `${formatCount(dossier.queries.reduce((sum, query) => sum + recordsInScope(query), 0))} records`,
        });
        for (const query of dossier.queries) {
          await boundedDelay(180, signal);
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
        return {
          queryResults: dossier.queries,
          aggregate: {
            evidenceAttached: dossier.queries.length,
            syntheticRecordCount: dossier.queries.reduce(
              (sum, query) => sum + recordsInScope(query),
              0,
            ),
          },
          synthetic: true,
        };
      }
      throw new Error("Reference tool is not implemented.");
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
      if (!document.modelContext?.registerTool) {
        if (active) setAgentStatus({ state: "unavailable", count: 0 });
        return;
      }
      let registered = 0;
      for (const definition of definitions) {
        try {
          await document.modelContext.registerTool(definition, {
            signal: controller.signal,
          });
          registered += 1;
        } catch {
          if (controller.signal.aborted) break;
        }
      }
      if (!active) return;
      setAgentStatus({
        state: registered === definitions.length ? "available" : "partial",
        count: registered,
      });
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
            <span>Tier 1 reference brief</span>
            <strong>{dossier.title}</strong>
          </div>
          <p>{dossier.observedImpact}</p>
          <small>
            {dossier.events.length} observed · {dossier.timeRange}
          </small>
        </header>

        <section className="reference-workbench">
          <header className="reference-map-toolbar">
            <div>
              <span>Evidence path</span>
              <strong>{dossier.primaryQuestion}</strong>
            </div>
            <div
              className={`reference-agent-now reference-agent-${activity.status}`}
            >
              <span>
                {activity.actor === "agent"
                  ? "Copilot now"
                  : "Analyst directed"}
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
              {planComplete ? "Plan complete" : "Run evidence plan"}
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
            aria-label="Query insights"
          >
            <header>
              <span>Query insights</span>
              <strong>
                {attachedQueryIds.length}/{dossier.queries.length} attached
              </strong>
              <small>Demo analysis sources</small>
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
                      <em>{attached ? query.dominantMetric : "Ready"}</em>
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
                          ? "Malware analysis workspace · demo file · no binary executed"
                          : query.caveat}
                      </small>
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
                <small>Complete the evidence plan before disposition.</small>
              )}
            </section>
          </div>
        </section>

        <footer className="reference-boundary">
          Explorable client-local evidence brief · deterministic synthetic data
          · no shared response lifecycle or external control
        </footer>
      </div>

      {capabilitiesOpen ? (
        <ReferenceCapabilityDrawer
          definitions={definitions}
          dossier={dossier}
          onClose={() => setCapabilitiesOpen(false)}
          receipts={receipts}
        />
      ) : null}
      {assessmentOpen ? (
        <ReferenceAssessment
          dossier={dossier}
          onClose={() => setAssessmentOpen(false)}
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
            {flagged ? <em>Copilot result</em> : null}
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
          <span>Copilot capability</span>
          <code>{query.capability}</code>
          <strong>{attached ? query.dominantMetric : query.question}</strong>
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

function ReferenceCapabilityDrawer({
  dossier,
  definitions,
  receipts,
  onClose,
}: {
  dossier: ReferenceCase;
  definitions: WebMcpToolDefinition[];
  receipts: readonly ReferenceReceipt[];
  onClose: () => void;
}) {
  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside
        className="agent-drawer reference-capability-drawer"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="drawer-header">
          <div>
            <p className="eyebrow">Reference tool surface</p>
            <h2>Copilot capabilities</h2>
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
            <strong>{dossier.queries.length} evidence insights</strong>
            <small>Demo data sources</small>
          </article>
          <article>
            <span>Can lead</span>
            <strong>Atomic investigation plan</strong>
            <small>Ordered results in this local brief</small>
          </article>
          <article className="capability-matrix-analyst">
            <span>Analyst only</span>
            <strong>Disposition and response</strong>
            <small>No containment tools in this brief</small>
          </article>
        </div>
        <div className="reference-tool-list">
          {definitions.map((definition) => (
            <article key={definition.name}>
              <span>Registered</span>
              <strong>{definition.title}</strong>
              <code>{definition.name}</code>
              <small>{definition.description}</small>
            </article>
          ))}
        </div>
        <footer>
          {receipts.length} shared operations · 0 external controls
        </footer>
      </aside>
    </div>
  );
}

function ReferenceAssessment({
  dossier,
  onClose,
}: {
  dossier: ReferenceCase;
  onClose: () => void;
}) {
  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside
        className="reference-assessment"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <span>Evidence assessment</span>
          <button aria-label="Close assessment" onClick={onClose} type="button">
            ×
          </button>
        </header>
        <h2>{dossier.assessment.disposition}</h2>
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

function createReferenceToolDefinitions(
  dossier: ReferenceCase,
  execute: (
    toolName: ReferenceToolName,
    input: Record<string, unknown>,
    actor: "agent",
    signal?: AbortSignal,
  ) => Promise<unknown>,
): WebMcpToolDefinition[] {
  const requestId = { type: "string", minLength: 8, maxLength: 80 };
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
      properties: { requestId, ...properties },
      required: ["requestId", ...required],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: readOnly, untrustedContentHint: false },
    execute: async (input, context) =>
      execute(name, input, "agent", context?.signal),
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
      "Return one observed synthetic event from the dossier.",
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
      "Run one demo query and add its deterministic result to the shared brief.",
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
      "Execute all currently defined dossier queries in stable order and attach the evidence insights as one agent-led phase.",
      {},
      [],
      false,
    ),
  ];
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

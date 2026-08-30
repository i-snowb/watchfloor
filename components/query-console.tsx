"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getQueryConsoleContract,
  matchesQueryConsoleContract,
  normalizeQueryConsoleText,
} from "@/domain/query-console";
import type {
  CaseFixture,
  CaseState,
  InvestigationQueryDefinition,
} from "@/domain/types";
import { formatUtcTime } from "@/lib/format";
import type { InvestigationActivity } from "./investigation-activity";
import type { TraceSelection } from "./trace-interaction";

interface QueryConsoleProps {
  activity: InvestigationActivity;
  busy: boolean;
  candidates: readonly InvestigationQueryDefinition[];
  fixture: CaseFixture;
  onChooseQuery: (queryId: string) => void;
  onPrepare: (input: Record<string, unknown>) => Promise<void>;
  onExecute: (input: Record<string, unknown>) => Promise<void>;
  onSelect: (selection: TraceSelection) => void;
  query: InvestigationQueryDefinition;
  state: CaseState;
}

export function QueryConsole({
  activity,
  busy,
  candidates,
  fixture,
  onChooseQuery,
  onPrepare,
  onExecute,
  onSelect,
  query,
  state,
}: QueryConsoleProps) {
  const contract = getQueryConsoleContract(query.id);
  const canonicalText = contract?.text ?? "";
  const attached = state.attachedEnrichmentIds.includes(query.resultArtifactId);
  const prepared =
    state.preparedQuery?.queryId === query.id &&
    state.preparedQuery.preparedAtRevision === state.revision;
  const [open, setOpen] = useState(false);
  const [draftInput, setDraftInput] = useState<string | null>(null);
  const [showAttachedQuery, setShowAttachedQuery] = useState(false);
  const animationKey = useRef<string | null>(null);
  const activityTargetsQuery =
    activity.status !== "idle" && activity.queryId === query.id;
  const agentPreparing =
    activityTargetsQuery &&
    activity.status === "running" &&
    activity.actor === "agent" &&
    activity.toolName === "prepare_investigation_query";
  const agentPrepareKey = agentPreparing
    ? `${query.id}:${activity.baseRevision}`
    : null;

  useEffect(() => {
    if (!agentPrepareKey || animationKey.current === agentPrepareKey) return;
    animationKey.current = agentPrepareKey;
    setDraftInput("");
    let cursor = 0;
    const timer = window.setInterval(() => {
      cursor = Math.min(canonicalText.length, cursor + 20);
      setDraftInput(canonicalText.slice(0, cursor));
      if (cursor >= canonicalText.length) window.clearInterval(timer);
    }, 18);
    return () => window.clearInterval(timer);
  }, [agentPrepareKey, canonicalText]);

  const running =
    activityTargetsQuery &&
    activity.status === "running" &&
    activity.toolName === "run_investigation_query";
  const forceOpen = running || agentPreparing;
  const draft = draftInput ?? (prepared || attached ? canonicalText : "");
  const showQueryText = !attached || showAttachedQuery;
  const rejected =
    activityTargetsQuery &&
    activity.status === "rejected" &&
    (activity.toolName === "prepare_investigation_query" ||
      activity.toolName === "run_investigation_query");
  const valid =
    prepared &&
    contract !== null &&
    matchesQueryConsoleContract(query.id, draft);
  const canonicalLoaded =
    normalizeQueryConsoleText(draft) ===
    normalizeQueryConsoleText(canonicalText);
  const searched = query.sourceScopes.reduce(
    (total, source) => total + source.syntheticRecordCount,
    0,
  );
  const timeRange = useMemo(() => queryTimeRange(query), [query]);
  const target = fixture.entities
    .concat(fixture.stream.stages.flatMap((stage) => [...stage.entities]))
    .find((entity) => entity.id === query.targetEntityId);

  return (
    <details
      className={`query-console ${!prepared && !attached && !agentPreparing ? "query-console-unprepared" : ""} ${attached ? "query-console-attached" : ""}`}
      onToggle={(event) => {
        if (!forceOpen) setOpen(event.currentTarget.open);
      }}
      open={open || forceOpen}
    >
      <summary>
        <span>Investigation skill</span>
        <strong>
          {queryStatusLabel(
            activity,
            query.id,
            attached,
            state.preparedQuery,
            state.revision,
          )}
        </strong>
        <small>{target?.label ?? query.targetEntityId}</small>
      </summary>

      <div className="query-console-body">
        <header className="query-console-toolbar">
          <label>
            <span>Approved skill</span>
            <select
              aria-label="Available investigation skills"
              disabled={running || agentPreparing}
              onChange={(event) => onChooseQuery(event.target.value)}
              value={query.id}
            >
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.title}
                  {state.attachedEnrichmentIds.includes(
                    candidate.resultArtifactId,
                  )
                    ? " · attached"
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <dl>
            <div>
              <dt>Language</dt>
              <dd>{contract?.language ?? "KQL"}</dd>
            </div>
            <div>
              <dt>Time range</dt>
              <dd>{timeRange}</dd>
            </div>
          </dl>
        </header>

        {attached ? (
          <div className="query-console-execution-summary">
            <div>
              <span>Evidence attached from query</span>
              <strong>{query.title}</strong>
              <small>
                {query.matchedRecordCount} matched · {query.returnedRecordCount}{" "}
                returned · {searched.toLocaleString("en-US")} records searched ·{" "}
                {query.sourceScopes
                  .map((source) => source.sourceLabel)
                  .join(" · ")}
              </small>
            </div>
            <button
              aria-expanded={showQueryText}
              onClick={() => setShowAttachedQuery((current) => !current)}
              type="button"
            >
              {showQueryText ? "Hide query" : "View query"}
            </button>
          </div>
        ) : null}

        {!attached || showQueryText ? (
          <>
            <footer className="query-console-footer">
              <div>
                <strong id="query-console-boundary">
                  Approved sources and query contract
                </strong>
                <span>
                  {query.sourceScopes
                    .map((source) => source.sourceLabel)
                    .join(" · ")}
                </span>
                <span>
                  {searched.toLocaleString("en-US")} records in scope · maximum{" "}
                  {query.returnedRecordCount} returned
                </span>
              </div>
              <div className="query-console-actions">
                {prepared && !canonicalLoaded && !attached ? (
                  <button
                    className="query-console-restore"
                    onClick={() => setDraftInput(canonicalText)}
                    type="button"
                  >
                    Restore query
                  </button>
                ) : null}
                {!prepared && !attached ? (
                  <button
                    className="query-console-prepare"
                    disabled={busy || agentPreparing}
                    onClick={() =>
                      void onPrepare({
                        expectedRevision: state.revision,
                        queryId: query.id,
                      })
                    }
                    type="button"
                  >
                    {agentPreparing ? "Agent preparing" : "Load approved query"}
                  </button>
                ) : (
                  <button
                    className="query-console-run"
                    disabled={
                      busy || attached || running || agentPreparing || !valid
                    }
                    onClick={() =>
                      void onExecute({
                        expectedRevision: state.revision,
                        queryId: query.id,
                        queryText: draft,
                      })
                    }
                    type="button"
                  >
                    {attached
                      ? "Result attached"
                      : running
                        ? "Searching records"
                        : "Run approved query"}
                  </button>
                )}
              </div>
            </footer>

            <div className="query-console-editor">
              <div aria-hidden="true" className="query-console-gutter">
                {draft.split("\n").map((_, index) => (
                  <span key={index}>{index + 1}</span>
                ))}
              </div>
              <textarea
                aria-describedby="query-console-boundary"
                aria-label="KQL investigation query"
                disabled={attached || running || agentPreparing || !prepared}
                maxLength={1024}
                onChange={(event) => setDraftInput(event.target.value)}
                placeholder="Load this approved skill to review its exact KQL."
                spellCheck={false}
                value={draft}
              />
            </div>

            {prepared && !valid && !agentPreparing ? (
              <p className="query-console-error" role="status">
                This text does not match the selected investigation skill.
                Restore the approved KQL before execution.
              </p>
            ) : null}

            {(running || agentPreparing) && activity.status === "running" ? (
              <div className="query-console-progress" role="status">
                <span
                  style={{ width: `${Math.round(activity.progress * 100)}%` }}
                />
                <strong>
                  {activity.toolName === "prepare_investigation_query"
                    ? preparePhaseLabel(activity.phase)
                    : queryPhaseLabel(activity.phase)}
                </strong>
                <small>{phaseSequenceLabel(activity.phase)}</small>
              </div>
            ) : null}

            {rejected && activity.status === "rejected" ? (
              <p className="query-console-error" role="alert">
                {activity.summary}
              </p>
            ) : null}
          </>
        ) : null}

        {attached ? (
          <QueryConsoleResults onSelect={onSelect} query={query} />
        ) : null}
      </div>
    </details>
  );
}

function QueryConsoleResults({
  onSelect,
  query,
}: {
  onSelect: (selection: TraceSelection) => void;
  query: InvestigationQueryDefinition;
}) {
  return (
    <section className="query-console-results" aria-label="Returned records">
      <header>
        <div>
          <span>Returned records</span>
          <strong>{query.returnedRecordCount}</strong>
        </div>
        <p>{query.matchedRecordCount} matches in case-scoped data</p>
      </header>
      <details className="query-console-source-note">
        <summary>Evidence scope and limits</summary>
        <p>{query.caveat}</p>
      </details>
      <div className="query-console-table" role="table">
        <div className="query-console-table-head" role="row">
          <span role="columnheader">Time</span>
          <span role="columnheader">Source</span>
          <span role="columnheader">Record</span>
          <span role="columnheader">Key fields</span>
        </div>
        {query.returnedRecords.map((record) => {
          const entityId = record.entityIds[0] ?? null;
          return (
            <details key={record.id} role="row">
              <summary>
                <time dateTime={record.timestamp} role="cell">
                  {formatUtcTime(record.timestamp)}
                </time>
                <span role="cell">{record.sourceLabel}</span>
                <strong role="cell">{record.recordType}</strong>
                <span role="cell">
                  {record.fields
                    .slice(0, 2)
                    .map((field) => `${field.label}: ${field.value}`)
                    .join(" · ")}
                </span>
              </summary>
              <dl>
                {record.fields.map((field) => (
                  <div key={field.label}>
                    <dt>{field.label}</dt>
                    <dd>{field.value}</dd>
                  </div>
                ))}
              </dl>
              {entityId ? (
                <button
                  className="query-console-focus"
                  onClick={() => onSelect({ kind: "entity", id: entityId })}
                  type="button"
                >
                  Show related entity
                </button>
              ) : (
                <span className="query-console-source-only">
                  Source-only context
                </span>
              )}
            </details>
          );
        })}
      </div>
    </section>
  );
}

function queryStatusLabel(
  activity: InvestigationActivity,
  queryId: string,
  attached: boolean,
  preparedQuery: CaseState["preparedQuery"],
  currentRevision: number,
): string {
  if (attached) return "Result attached";
  if (preparedQuery?.queryId === queryId) {
    if (preparedQuery.preparedAtRevision !== currentRevision) {
      return "Reload required";
    }
    return preparedQuery.actor === "agent"
      ? "Prepared by agent"
      : "Prepared by analyst";
  }
  if (activity.status === "idle" || activity.queryId !== queryId)
    return "Ready";
  if (activity.toolName === "prepare_investigation_query") {
    if (activity.status === "running") return "Agent preparing";
    if (activity.status === "completed") {
      return activity.actor === "agent"
        ? "Prepared by agent"
        : "Prepared by analyst";
    }
  }
  if (activity.toolName === "run_investigation_query") {
    if (activity.status === "running") {
      return activity.actor === "agent" ? "Agent searching" : "Searching";
    }
    if (activity.status === "rejected") return "Query rejected";
  }
  return "Ready";
}

function queryPhaseLabel(phase: "scope" | "search" | "review"): string {
  if (phase === "scope") return "Selecting approved sources";
  if (phase === "search") return "Searching case records";
  return "Reviewing matches";
}

function preparePhaseLabel(phase: "scope" | "search" | "review"): string {
  if (phase === "scope") return "Selecting approved sources";
  if (phase === "search") return "Writing bounded KQL";
  return "Validating query contract";
}

function phaseSequenceLabel(phase: "scope" | "search" | "review"): string {
  if (phase === "scope") return "Stage 1 of 3";
  if (phase === "search") return "Stage 2 of 3";
  return "Stage 3 of 3";
}

function queryTimeRange(query: InvestigationQueryDefinition): string {
  const starts = query.sourceScopes.map((source) =>
    Date.parse(source.timeRange.start),
  );
  const ends = query.sourceScopes.map((source) =>
    Date.parse(source.timeRange.end),
  );
  const start = new Date(Math.min(...starts));
  const end = new Date(Math.max(...ends));
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const sameDay = startIso.slice(0, 10) === endIso.slice(0, 10);
  const sameYear = startIso.slice(0, 4) === endIso.slice(0, 4);
  return sameDay
    ? `${startIso.slice(0, 10)} ${startIso.slice(11, 16)}–${endIso.slice(11, 16)}Z`
    : sameYear
      ? `${startIso.slice(0, 10)} ${startIso.slice(11, 16)}–${endIso.slice(5, 10)} ${endIso.slice(11, 16)}Z`
      : `${formatQueryBoundary(start)}–${formatQueryBoundary(end)}`;
}

function formatQueryBoundary(value: Date): string {
  return `${value.toISOString().slice(0, 10)} ${value.toISOString().slice(11, 16)}Z`;
}

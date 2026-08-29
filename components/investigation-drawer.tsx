import type { ReactNode } from "react";
import {
  getAllEntities,
  getVisibleEnrichments,
} from "@/domain/incident-stream";
import { getCollaborationHandoff } from "@/domain/operations";
import type {
  CaseFixture,
  CaseState,
  EnrichmentArtifact,
  InvestigationQueryDefinition,
  OperationReceipt,
} from "@/domain/types";
import { formatUtcTime, humanizeEntityKind } from "@/lib/format";
import { CaseReportPanel } from "./case-report-panel";
import { QueryReturnedRecords } from "./query-returned-records";
import type { TraceSelection } from "./trace-interaction";

interface InvestigationDrawerProps {
  fixture: CaseFixture;
  findingsSectionId: string;
  onSelect: (selection: TraceSelection) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  receipts: readonly OperationReceipt[];
  selectionDetails?: ReactNode;
  state: CaseState;
}

export function InvestigationDrawer({
  fixture,
  findingsSectionId,
  onSelect,
  onOpenChange,
  open,
  receipts,
  selectionDetails,
  state,
}: InvestigationDrawerProps) {
  const entities = getAllEntities(fixture);
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const enrichments = getVisibleEnrichments(fixture, state);
  const availableQueries = fixture.investigationQueries.filter(
    (query) =>
      query.requiresStageId === null ||
      state.releasedStreamStageIds.includes(query.requiresStageId),
  );
  const attachedQueries = availableQueries.filter((query) =>
    state.attachedEnrichmentIds.includes(query.resultArtifactId),
  );
  const findings = attachedQueries
    .flatMap((query) => {
      const artifact = enrichments.find(
        (candidate) => candidate.id === query.resultArtifactId,
      );
      if (!artifact) return [];
      const receipt =
        [...receipts]
          .reverse()
          .find(
            (receipt) =>
              receipt.status === "completed" &&
              isQueryExecutionReceipt(receipt) &&
              receipt.title === query.title,
          ) ?? null;
      const target = entityById.get(query.targetEntityId);
      return [
        {
          actor:
            receipt?.reportedSurface === "webmcp_callback"
              ? "Copilot result"
              : receipt
                ? "Analyst result"
                : "Case evidence",
          artifact,
          query,
          receipt,
          targetLabel: target?.label ?? query.targetEntityId,
          targetType: target
            ? humanizeEntityKind(target.kind)
            : "Evidence target",
        },
      ];
    })
    .sort(
      (left, right) =>
        (right.receipt?.sequence ?? right.artifact.sequence) -
        (left.receipt?.sequence ?? left.artifact.sequence),
    );
  const handoff = getCollaborationHandoff(fixture, state);
  const requiredAttached = fixture.decision.requiresEnrichmentIds.filter((id) =>
    state.attachedEnrichmentIds.includes(id),
  ).length;
  const evidenceReady =
    requiredAttached === fixture.decision.requiresEnrichmentIds.length;
  const decisionRecorded = state.decision.status !== "pending";
  const showCaseGate =
    evidenceReady || decisionRecorded || state.lifecycle === "closed_in_demo";
  const caseGate =
    state.lifecycle === "closed_in_demo"
      ? { label: "Case status", value: "Closed" }
      : decisionRecorded && handoff.pendingGate
        ? {
            label: "Next approval",
            value: handoff.pendingGate.replaceAll("_", " "),
          }
        : decisionRecorded
          ? { label: "Decision", value: "Recorded" }
          : { label: "Evidence complete", value: "Analyst review required" };

  return (
    <details
      className="case-investigation-drawer"
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
      open={open}
    >
      <summary
        aria-label={`Evidence and case notes, ${findings.length} ${findings.length === 1 ? "result" : "results"}`}
      >
        <span className="drawer-summary-label">Results &amp; notes</span>
        <strong>
          {findings.length === 0
            ? "No results yet"
            : `${findings.length} ${findings.length === 1 ? "result" : "results"}`}
        </strong>
        <span className="drawer-summary-state" aria-live="polite">
          {decisionRecorded
            ? "Decision recorded"
            : evidenceReady
              ? "Decision ready"
              : "Investigation active"}
        </span>
        <em aria-hidden="true" />
      </summary>

      <div className="investigation-drawer-body findings-tray-body">
        {showCaseGate ? (
          <div
            className="findings-decision-ladder"
            aria-label="Current case gate"
          >
            <span className="is-current">
              <small>{caseGate.label}</small>
              <strong>{caseGate.value}</strong>
            </span>
          </div>
        ) : null}
        <section
          aria-labelledby="attached-findings-heading"
          className="drawer-section drawer-findings findings-tray-results"
          id={findingsSectionId}
        >
          <header className="drawer-section-heading">
            <div>
              <span>Investigation evidence</span>
              <h2 id="attached-findings-heading" tabIndex={-1}>
                Findings
              </h2>
            </div>
            <small>
              {findings.length === 0
                ? "Run a query to add evidence"
                : "Source records available"}
            </small>
          </header>
          {findings.length > 0 ? (
            <ol className="drawer-findings-list">
              {findings.map((finding) => (
                <FindingRow
                  actor={finding.actor}
                  artifact={finding.artifact}
                  key={finding.query.id}
                  onFocus={() =>
                    onSelect({
                      kind: "entity",
                      id: finding.query.targetEntityId,
                    })
                  }
                  query={finding.query}
                  receipt={finding.receipt}
                  onSelect={onSelect}
                  targetLabel={finding.targetLabel}
                  targetType={finding.targetType}
                />
              ))}
            </ol>
          ) : (
            <p className="drawer-empty-state drawer-findings-empty">
              No findings are attached. Select an entity and run a scoped query
              to add evidence and source records.
            </p>
          )}
        </section>

        {state.report.status !== "unavailable" ? (
          <section className="drawer-section findings-tray-report">
            <header className="drawer-section-heading">
              <div>
                <span>Case closure</span>
                <h2>Evidence report</h2>
              </div>
              <small>Review before approval</small>
            </header>
            <CaseReportPanel fixture={fixture} state={state} />
          </section>
        ) : null}

        <section className="drawer-section drawer-activity-notes">
          <header className="drawer-section-heading">
            <div>
              <span>Shared case history</span>
              <h2>Activity notes</h2>
            </div>
            <small>{receipts.length} recorded updates</small>
          </header>
          {receipts.length > 0 ? (
            <ol className="drawer-activity-list">
              {receipts.slice(-12).map((receipt) => (
                <li key={receipt.id}>
                  <span>
                    {receipt.reportedSurface === "webmcp_callback"
                      ? "Copilot"
                      : "Analyst"}
                  </span>
                  <div>
                    <strong>{receipt.title}</strong>
                    <p>{receipt.resultSummary}</p>
                  </div>
                  <time dateTime={receipt.occurredAt}>
                    {formatUtcTime(receipt.occurredAt)}
                  </time>
                  <details>
                    <summary>Technical details</summary>
                    <code>
                      {receipt.toolName} · r{receipt.baseRevision}→r
                      {receipt.resultRevision}
                    </code>
                  </details>
                </li>
              ))}
            </ol>
          ) : (
            <p className="drawer-empty-state">
              Copilot work and analyst actions will appear here.
            </p>
          )}
        </section>

        {selectionDetails ? (
          <details className="findings-context-disclosure">
            <summary>
              <span>Selected item details</span>
              <strong>Inspect technical record</strong>
              <em aria-hidden="true" />
            </summary>
            <div>{selectionDetails}</div>
          </details>
        ) : null}
      </div>
    </details>
  );
}

function isQueryExecutionReceipt(receipt: OperationReceipt): boolean {
  return (
    receipt.toolName === "run_investigation_query" ||
    receipt.toolName === "run_investigation_plan"
  );
}

function FindingRow({
  actor,
  artifact,
  onFocus,
  onSelect,
  query,
  receipt,
  targetLabel,
  targetType,
}: {
  actor: string;
  artifact: EnrichmentArtifact;
  onFocus: () => void;
  onSelect: (selection: TraceSelection) => void;
  query: InvestigationQueryDefinition;
  receipt: OperationReceipt | null;
  targetLabel: string;
  targetType: string;
}) {
  const scanned = query.sourceScopes.reduce(
    (total, scope) => total + scope.syntheticRecordCount,
    0,
  );
  return (
    <li>
      <article className={`drawer-finding drawer-finding-${artifact.status}`}>
        <span className={`truth-badge truth-${artifact.status}`}>
          {artifact.status}
        </span>
        <div className="drawer-finding-copy">
          <small>
            {actor} · {targetType} · {targetLabel}
          </small>
          <strong>{artifact.summary}</strong>
        </div>
        <button onClick={onFocus} type="button">
          Show in graph
        </button>
        <details className="drawer-finding-evidence">
          <summary>
            Query details · {formatCount(scanned)} searched ·{" "}
            {query.matchedRecordCount} matched
          </summary>
          <div>
            <p>{artifact.caveat}</p>
            <dl>
              <div>
                <dt>Query</dt>
                <dd>{query.title}</dd>
              </div>
              <div>
                <dt>Sources</dt>
                <dd>{query.sourceScopes.length}</dd>
              </div>
              <div>
                <dt>Attached</dt>
                <dd>
                  {formatUtcTime(receipt?.occurredAt ?? artifact.timestamp)} ·{" "}
                  {receipt ? `r${receipt.resultRevision}` : "case data"}
                </dd>
              </div>
            </dl>
          </div>
        </details>
        <QueryReturnedRecords onSelect={onSelect} query={query} />
      </article>
    </li>
  );
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

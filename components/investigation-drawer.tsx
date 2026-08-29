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
import type { TraceSelection } from "./trace-interaction";

interface InvestigationDrawerProps {
  commandBar?: ReactNode;
  fixture: CaseFixture;
  findingsSectionId: string;
  onSelect: (selection: TraceSelection) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  queryControls?: ReactNode;
  receipts: readonly OperationReceipt[];
  selectionDetails?: ReactNode;
  state: CaseState;
}

export function InvestigationDrawer({
  commandBar,
  fixture,
  findingsSectionId,
  onSelect,
  onOpenChange,
  open,
  queryControls,
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
              ? "Copilot · WebMCP"
              : receipt
                ? "Analyst requested"
                : "Attached evidence",
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

  return (
    <details
      className="case-investigation-drawer"
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
      open={open}
    >
      <summary>
        <span className="drawer-summary-label">Findings</span>
        <strong>
          {findings.length === 0
            ? "No findings attached"
            : `${findings.length} ${findings.length === 1 ? "finding" : "findings"}`}
        </strong>
        <span className="drawer-summary-state" aria-live="polite">
          Investigation controls · r{state.revision}
        </span>
        <em aria-hidden="true" />
      </summary>

      <div className="investigation-drawer-body findings-tray-body">
        <nav className="findings-decision-ladder" aria-label="Decision path">
          <span className={evidenceReady ? "is-complete" : "is-current"}>
            <small>Evidence</small>
            <strong>
              {requiredAttached}/{fixture.decision.requiresEnrichmentIds.length}{" "}
              required
            </strong>
          </span>
          <span
            className={
              decisionRecorded
                ? "is-complete"
                : evidenceReady
                  ? "is-current"
                  : ""
            }
          >
            <small>Decision</small>
            <strong>{decisionRecorded ? "Recorded" : "Analyst review"}</strong>
          </span>
          <span
            className={
              handoff.pendingGate !== null && decisionRecorded
                ? "is-current"
                : state.lifecycle === "closed_in_demo"
                  ? "is-complete"
                  : ""
            }
          >
            <small>Human gate</small>
            <strong>
              {handoff.pendingGate
                ? handoff.pendingGate.replaceAll("_", " ")
                : state.lifecycle === "closed_in_demo"
                  ? "Complete"
                  : "After evidence"}
            </strong>
          </span>
        </nav>
        <section
          aria-labelledby="attached-findings-heading"
          className="drawer-section drawer-findings findings-tray-results"
          id={findingsSectionId}
        >
          <header className="drawer-section-heading">
            <div>
              <span>Case evidence</span>
              <h2 id="attached-findings-heading" tabIndex={-1}>
                Attached findings
              </h2>
            </div>
            <small>
              {findings.length === 0
                ? "Awaiting investigation"
                : `Latest case revision r${state.revision}`}
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
                  targetLabel={finding.targetLabel}
                  targetType={finding.targetType}
                />
              ))}
            </ol>
          ) : (
            <p className="drawer-empty-state drawer-findings-empty">
              Select evidence on the map and run a bounded query. Returned
              evidence will attach here.
            </p>
          )}
        </section>

        {state.report.status !== "unavailable" ? (
          <section className="drawer-section findings-tray-report">
            <header className="drawer-section-heading">
              <div>
                <span>Closure artifact</span>
                <h2>Evidence report</h2>
              </div>
              <small>Review before approval</small>
            </header>
            <CaseReportPanel fixture={fixture} state={state} />
          </section>
        ) : null}

        <section
          aria-labelledby="investigation-controls-heading"
          className="drawer-section findings-tray-controls"
        >
          <header className="drawer-section-heading">
            <div>
              <span>Analyst and copilot</span>
              <h2 id="investigation-controls-heading">
                Investigation controls
              </h2>
            </div>
            <small>Selected evidence</small>
          </header>
          {commandBar ? (
            <div className="findings-tray-next">{commandBar}</div>
          ) : null}
          {queryControls ? (
            <div className="drawer-query-controls findings-tray-query">
              {queryControls}
            </div>
          ) : null}
        </section>

        {selectionDetails ? (
          <details className="findings-context-disclosure">
            <summary>
              <span>Selected evidence record</span>
              <strong>Open technical details</strong>
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
  query,
  receipt,
  targetLabel,
  targetType,
}: {
  actor: string;
  artifact: EnrichmentArtifact;
  onFocus: () => void;
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
          Focus on map
        </button>
        <details className="drawer-finding-evidence">
          <summary>
            {query.returnedRecordCount} evidence records ·{" "}
            {formatCount(scanned)} searched · {query.matchedRecordCount} matched
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
                  {receipt ? `r${receipt.resultRevision}` : "fixture evidence"}
                </dd>
              </div>
            </dl>
          </div>
        </details>
      </article>
    </li>
  );
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

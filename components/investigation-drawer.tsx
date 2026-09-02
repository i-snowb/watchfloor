import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  getAllEntities,
  getVisibleEnrichments,
} from "@/domain/incident-stream";
import { traceEvidenceLineage } from "@/domain/evidence-lineage";
import { getCollaborationHandoff } from "@/domain/operations";
import type {
  CaseFixture,
  CaseState,
  EnrichmentArtifact,
  EvidenceLineageTargetType,
  InvestigationQueryDefinition,
  OperationReceipt,
  AnalystReportSignoff,
} from "@/domain/types";
import { formatUtcTime, humanizeEntityKind } from "@/lib/format";
import { CaseReportPanel } from "./case-report-panel";
import { QueryReturnedRecords } from "./query-returned-records";
import type {
  EvidenceProvenanceRequest,
  EvidenceProvenanceTargetType,
  TraceSelection,
} from "./trace-interaction";

interface InvestigationDrawerProps {
  busy: boolean;
  fixture: CaseFixture;
  findingsSectionId: string;
  onApproveReport: (signoff: AnalystReportSignoff) => Promise<void>;
  onSelect: (selection: TraceSelection) => void;
  onOpenChange: (open: boolean) => void;
  onViewProvenance: (target: {
    targetId: string;
    targetType: EvidenceProvenanceTargetType;
  }) => void;
  open: boolean;
  provenanceRequest?: EvidenceProvenanceRequest | null;
  reportReviewId: string;
  receipts: readonly OperationReceipt[];
  selectionDetails?: ReactNode;
  state: CaseState;
}

export function InvestigationDrawer({
  busy,
  fixture,
  findingsSectionId,
  onApproveReport,
  onSelect,
  onOpenChange,
  onViewProvenance,
  open,
  provenanceRequest = null,
  reportReviewId,
  receipts,
  selectionDetails,
  state,
}: InvestigationDrawerProps) {
  const openerRef = useRef<HTMLElement | null>(null);
  const provenanceSummaryRef = useRef<HTMLElement | null>(null);
  const [provenanceOpen, setProvenanceOpen] = useState(false);
  const provenanceRequestId = provenanceRequest?.requestId ?? null;
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
              ? "TRACE result"
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
    state.report.status === "unavailable" &&
    (evidenceReady || decisionRecorded || state.lifecycle === "closed_in_demo");
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
  const reportReadiness = getReportReadiness(fixture, state);
  const reportApprovalReceipt =
    [...receipts]
      .reverse()
      .find(
        (receipt) =>
          receipt.status === "completed" &&
          receipt.toolName === "approve_case_report",
      ) ?? null;

  useEffect(() => {
    if (!open || provenanceRequestId === null) return;
    let innerFrame: number | null = null;
    const outerFrame = window.requestAnimationFrame(() => {
      setProvenanceOpen(true);
      innerFrame = window.requestAnimationFrame(() => {
        provenanceSummaryRef.current?.focus({ preventScroll: true });
        provenanceSummaryRef.current?.scrollIntoView({
          behavior: "auto",
          block: "nearest",
        });
      });
    });
    return () => {
      window.cancelAnimationFrame(outerFrame);
      if (innerFrame !== null) window.cancelAnimationFrame(innerFrame);
    };
  }, [open, provenanceRequestId]);

  return (
    <details
      className="case-investigation-drawer"
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        if (nextOpen) {
          const activeElement = document.activeElement;
          openerRef.current =
            activeElement instanceof HTMLElement ? activeElement : null;
        } else if (
          openerRef.current &&
          event.currentTarget.contains(document.activeElement)
        ) {
          window.requestAnimationFrame(() => {
            openerRef.current?.focus({ preventScroll: true });
          });
        }
        onOpenChange(nextOpen);
      }}
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

        {provenanceRequest ? (
          <details
            className="findings-context-disclosure provenance-disclosure"
            onToggle={(event) => setProvenanceOpen(event.currentTarget.open)}
            open={provenanceOpen}
          >
            <summary ref={provenanceSummaryRef}>
              <span>Evidence lineage</span>
              <strong>View provenance</strong>
              <em aria-hidden="true" />
            </summary>
            <div className="provenance-disclosure-body">
              <ProvenanceDetails
                fixture={fixture}
                receipts={receipts}
                request={provenanceRequest}
                state={state}
              />
            </div>
          </details>
        ) : null}

        <section className="drawer-section report-readiness-section">
          <header className="drawer-section-heading">
            <div>
              <span>Case closure</span>
              <h2>Report readiness</h2>
            </div>
            <small>{reportReadiness.status}</small>
          </header>
          <ol className="report-readiness-track">
            {reportReadiness.stages.map((stage) => (
              <li className={`is-${stage.state}`} key={stage.label}>
                <span>{stage.label}</span>
                <strong>{stage.detail}</strong>
              </li>
            ))}
          </ol>
          <p className="report-readiness-detail">{reportReadiness.detail}</p>
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
            <CaseReportPanel
              approvalReceipt={reportApprovalReceipt}
              busy={busy}
              fixture={fixture}
              findingsSectionId={findingsSectionId}
              key={state.report.report?.id ?? "case-report"}
              onApprove={onApproveReport}
              onViewProvenance={onViewProvenance}
              reportId={reportReviewId}
              state={state}
            />
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
                      ? "TRACE"
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
              TRACE work and analyst actions will appear here.
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

function getReportReadiness(fixture: CaseFixture, state: CaseState) {
  const evidenceRemaining = fixture.conclusion.requiredEnrichmentIds.filter(
    (id) => !state.attachedEnrichmentIds.includes(id),
  ).length;
  const streamRemaining =
    fixture.stream.stages.length - state.releasedStreamStageIds.length;
  const investigationComplete =
    evidenceRemaining === 0 && streamRemaining === 0;
  const decisionComplete =
    state.decision.status === fixture.conclusion.requiredDecision;
  const requiredActionRemaining = fixture.conclusion.requiredActionIds.filter(
    (actionId) =>
      state.responseActions.find((action) => action.actionId === actionId)
        ?.status !== "authorized_in_demo",
  ).length;
  const modelRequired =
    fixture.impact.atRiskEntityIds.length > 0 ||
    fixture.responseActions.length > 0;
  const modelComplete =
    !modelRequired ||
    (state.reachabilityAttached && state.counterfactualAttached);
  const responseComplete = requiredActionRemaining === 0 && modelComplete;
  const reportDrafted = state.report.status !== "unavailable";
  const reportApproved = state.report.status === "approved_in_demo";
  const eligible =
    investigationComplete && decisionComplete && responseComplete;
  const status = reportApproved
    ? "Approved and closed"
    : reportDrafted
      ? "Analyst approval required"
      : eligible
        ? "Ready for TRACE"
        : "Prerequisites incomplete";
  const detail = reportApproved
    ? "The approved evidence report and analyst closure note are retained with the case."
    : reportDrafted
      ? "Review the evidence basis, recorded response, limitations, and residual risk before approval."
      : eligible
        ? "TRACE can draft the evidence report from the current case revision."
        : `${evidenceRemaining + streamRemaining} evidence item${evidenceRemaining + streamRemaining === 1 ? "" : "s"}, ${decisionComplete ? 0 : 1} decision, and ${requiredActionRemaining + (modelComplete ? 0 : 1)} response item${requiredActionRemaining + (modelComplete ? 0 : 1) === 1 ? "" : "s"} remain.`;
  return {
    status,
    detail,
    stages: [
      {
        label: "Investigate",
        detail: investigationComplete
          ? "Complete"
          : `${evidenceRemaining + streamRemaining} remaining`,
        state: investigationComplete ? "complete" : "current",
      },
      {
        label: "Decide",
        detail: decisionComplete ? "Recorded" : "Required",
        state: decisionComplete
          ? "complete"
          : investigationComplete
            ? "current"
            : "pending",
      },
      {
        label: "Respond",
        detail: responseComplete
          ? fixture.conclusion.requiredActionIds.length > 0
            ? "Approved"
            : "Not required"
          : `${requiredActionRemaining + (modelComplete ? 0 : 1)} remaining`,
        state: responseComplete
          ? "complete"
          : decisionComplete
            ? "current"
            : "pending",
      },
      {
        label: "Report",
        detail: reportApproved
          ? "Approved"
          : reportDrafted
            ? "Review"
            : eligible
              ? "Draft ready"
              : "Locked",
        state: reportApproved
          ? "complete"
          : reportDrafted || eligible
            ? "current"
            : "pending",
      },
    ] as const,
  };
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

function ProvenanceDetails({
  fixture,
  receipts,
  request,
  state,
}: {
  fixture: CaseFixture;
  receipts: readonly OperationReceipt[];
  request: EvidenceProvenanceRequest;
  state: CaseState;
}) {
  const lineage = traceEvidenceLineage(fixture, state, receipts, {
    targetId: request.targetId,
    targetType: toLineageTargetType(request.targetType),
  });

  if (!lineage) {
    return (
      <p className="provenance-empty-state">
        Provenance is unavailable for this item in the current case revision.
      </p>
    );
  }

  return (
    <article className="provenance-record">
      <header>
        <span>{lineage.target.type.replaceAll("_", " ")}</span>
        <h3>{lineage.target.label}</h3>
      </header>

      <section aria-label="Evidence identity">
        <h4>Evidence identity</h4>
        <dl>
          <ProvenanceField label="Reference" value={lineage.target.id} />
          <ProvenanceField
            label="Case revision"
            value={`r${lineage.currentRevision}`}
          />
          <ProvenanceField
            label="Availability"
            value={
              lineage.availability.releaseStageId
                ? `${lineage.availability.kind} · ${lineage.availability.releaseStageId}`
                : lineage.availability.kind
            }
          />
          <ProvenanceField
            label="Source"
            value={
              lineage.target.sourceLabel && lineage.target.sourceCategory
                ? `${lineage.target.sourceLabel} · ${lineage.target.sourceCategory.replaceAll("_", " ")}`
                : (lineage.target.sourceLabel ?? "Case-scoped evidence")
            }
          />
          {lineage.target.timestamp ? (
            <ProvenanceField
              label="Recorded"
              value={formatUtcTime(lineage.target.timestamp)}
            />
          ) : null}
          {lineage.target.status ? (
            <ProvenanceField label="Status" value={lineage.target.status} />
          ) : null}
        </dl>
      </section>

      {lineage.skills.length > 0 ? (
        <section aria-label="Approved investigation skills">
          <h4>Approved investigation skills</h4>
          <ul>
            {lineage.skills.map((skill) => (
              <li key={skill.id}>
                <code>{skill.id}</code> · v{skill.version} · {skill.title} ·{" "}
                {skill.objective}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {lineage.queries.length > 0 ? (
        <section aria-label="Bounded query contracts">
          <h4>Bounded query contracts</h4>
          {lineage.queries.map(({ definition, queryText }) => {
            const searched = definition.sourceScopes.reduce(
              (total, scope) => total + scope.syntheticRecordCount,
              0,
            );
            return (
              <details
                className="provenance-query-contract"
                key={definition.id}
              >
                <summary>
                  {definition.title} · {formatCount(searched)} searched ·{" "}
                  {definition.matchedRecordCount} matched ·{" "}
                  {definition.returnedRecordCount} returned
                </summary>
                <dl>
                  <ProvenanceField label="Query ID" value={definition.id} />
                  <ProvenanceField
                    label="Sources"
                    value={definition.sourceScopes
                      .map((scope) => scope.sourceLabel)
                      .join(" · ")}
                  />
                </dl>
                <code>{queryText}</code>
              </details>
            );
          })}
        </section>
      ) : null}

      {lineage.records.length > 0 ? (
        <section aria-label="Returned source records">
          <h4>Returned source records · {lineage.records.length}</h4>
          <ul>
            {lineage.records.map((record) => (
              <li key={record.id}>
                <code>{record.id}</code> · {record.sourceLabel} ·{" "}
                {record.recordType} · {formatUtcTime(record.timestamp)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {lineage.relationships.length > 0 ? (
        <section aria-label="Relationship matches">
          <h4>Relationship matches · {lineage.relationships.length}</h4>
          <ul>
            {lineage.relationships.map((relationship) => (
              <li key={relationship.id}>
                <code>{relationship.id}</code> · {relationship.relation} ·{" "}
                {relationship.matchField} = {relationship.matchValue}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {lineage.receipts.length > 0 ? (
        <section aria-label="Recorded operation receipts">
          <h4>Recorded operation receipts</h4>
          <ul>
            {lineage.receipts.map((receipt) => (
              <li className="provenance-receipt" key={receipt.id}>
                <code>{receipt.id}</code> · request{" "}
                <code>{receipt.requestId}</code> ·
                <code>{receipt.toolName}</code> · r{receipt.baseRevision}→r
                {receipt.resultRevision} · {formatUtcTime(receipt.occurredAt)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {lineage.reportConsumers.length > 0 ? (
        <section aria-label="Report consumers">
          <h4>Report consumers</h4>
          <ul>
            {lineage.reportConsumers.map((consumer) => (
              <li key={`${consumer.reportId}:${consumer.evidenceId}`}>
                <code>{consumer.reportId}</code> · {consumer.version} ·{" "}
                {consumer.status} · evidence {consumer.evidenceId}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {lineage.limitations.length > 0 ? (
        <section aria-label="Known limitations">
          <h4>Known limitations</h4>
          <ul>
            {lineage.limitations.map((limitation) => (
              <li key={`${limitation.source}:${limitation.referenceId}`}>
                {limitation.text}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="provenance-execution-boundary">
        Read-only case lineage · no external execution
      </p>
    </article>
  );
}

function ProvenanceField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function toLineageTargetType(
  type: EvidenceProvenanceTargetType,
): EvidenceLineageTargetType {
  return type === "join" ? "relationship" : type;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

"use client";

import Link from "next/link";
import { useState } from "react";
import type {
  CaseFixture,
  CaseState,
  ReportReviewAcknowledgements,
} from "@/domain/types";

interface CaseReportPanelProps {
  busy: boolean;
  fixture: CaseFixture;
  onApprove: (review: ReportReviewAcknowledgements) => Promise<void>;
  reportId: string;
  state: CaseState;
}

export function CaseReportPanel({
  busy,
  fixture,
  onApprove,
  reportId,
  state,
}: CaseReportPanelProps) {
  const [evidenceReviewed, setEvidenceReviewed] = useState(false);
  const [responseReviewed, setResponseReviewed] = useState(false);
  const [limitsReviewed, setLimitsReviewed] = useState(false);
  if (state.decision.status === "pending") return null;
  if (state.report.status === "unavailable") return null;

  const report = state.report.report;
  if (!report) return null;
  const approved = state.report.status === "approved_in_demo";
  const recordedActions = report.actionIds.flatMap((actionId) => {
    const action = fixture.responseActions.find(
      (candidate) => candidate.id === actionId,
    );
    return action ? [action] : [];
  });
  const hashArtifact = fixture.enrichments.find(
    (artifact) =>
      report.evidenceIds.includes(artifact.id) &&
      artifact.payload.kind === "hash_intelligence_fixture",
  );
  const keyHash =
    hashArtifact?.payload.kind === "hash_intelligence_fixture"
      ? hashArtifact.payload.sha256
      : null;

  return (
    <section
      aria-label="Case evidence report"
      aria-live="polite"
      className={`case-report-card ${approved ? "case-report-approved" : ""}`}
      id={reportId}
    >
      <div className="report-heading">
        <div>
          <p className="eyebrow">
            {report.id} · {report.version}
          </p>
          <h3 tabIndex={-1}>{report.title}</h3>
        </div>
        <span>{approved ? "Approved" : "Drafted"}</span>
      </div>
      <p className="report-receipt">
        {report.confirmedFindings.length} confirmed findings ·{" "}
        {recordedActions.length} simulated controls ·{" "}
        {report.limitations.length} stated limits ·{" "}
        {approved ? "Analyst approved" : "Analyst approval required"}
      </p>
      <div className="report-verdict">
        <span>Conclusion</span>
        <strong>{formatReportDisposition(report.disposition)}</strong>
        <p>{report.executiveSummary}</p>
        {keyHash ? (
          <div className="report-key-indicator">
            <span>Key IOC · SHA-256</span>
            <code>{keyHash}</code>
            <small>Archived threat intelligence snapshot</small>
          </div>
        ) : null}
      </div>
      <dl className="report-counts">
        <div>
          <dt>Evidence</dt>
          <dd>{report.evidenceIds.length}</dd>
        </div>
        <div>
          <dt>Findings</dt>
          <dd>{report.confirmedFindings.length}</dd>
        </div>
        <div>
          <dt>Actions</dt>
          <dd>{report.actionIds.length}</dd>
        </div>
        <div>
          <dt>Limits</dt>
          <dd>{report.limitations.length}</dd>
        </div>
      </dl>
      <div className="report-outcome-grid">
        <section>
          <span>Confirmed evidence</span>
          <ul>
            {report.confirmedFindings.map((finding) => (
              <li key={finding}>{finding}</li>
            ))}
          </ul>
        </section>
        <section>
          <span>Residual risk</span>
          <ul>
            {report.residualRisk.map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
        </section>
        <section>
          <span>Recorded response</span>
          <ul className="report-action-list">
            {recordedActions.map((action) => (
              <li key={action.id}>
                <strong>{action.title}</strong>
                <small>
                  {action.targetEntityId} · simulated approval · no external
                  execution
                </small>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <details className="report-provenance">
        <summary>Evidence and action provenance</summary>
        <p>
          Generated {report.generatedAt} from {report.evidenceIds.length}{" "}
          immutable case references and {report.actionIds.length}{" "}
          analyst-approved response records.
        </p>
        <code>{report.evidenceIds.join(" · ")}</code>
      </details>
      <details className="report-limitations">
        <summary>{report.limitations.length} evidence limitations</summary>
        <ul>
          {report.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </details>
      {!approved ? (
        <form
          className="report-review-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (evidenceReviewed && responseReviewed && limitsReviewed) {
              void onApprove({
                evidenceCoverageAcknowledged: evidenceReviewed,
                responseProvenanceAcknowledged: responseReviewed,
                limitationsAndResidualRiskAcknowledged: limitsReviewed,
              });
            }
          }}
        >
          <div className="report-review-heading" tabIndex={-1}>
            <span>Analyst review</span>
            <h4>Approve the case record</h4>
            <p>
              Verify the evidence, recorded response, and known limits before
              closure.
            </p>
          </div>
          <label>
            <input
              checked={evidenceReviewed}
              onChange={(event) => setEvidenceReviewed(event.target.checked)}
              type="checkbox"
            />
            <span>I reviewed the evidence coverage and source records.</span>
          </label>
          <label>
            <input
              checked={responseReviewed}
              onChange={(event) => setResponseReviewed(event.target.checked)}
              type="checkbox"
            />
            <span>
              I reviewed the simulated response record. No external control was
              executed.
            </span>
          </label>
          <label>
            <input
              checked={limitsReviewed}
              onChange={(event) => setLimitsReviewed(event.target.checked)}
              type="checkbox"
            />
            <span>I reviewed the evidence limits and residual risk.</span>
          </label>
          <div className="report-review-submit">
            <p>
              Approval records this review and closes the case. It does not
              contact an external system.
            </p>
            <button
              disabled={
                busy ||
                !evidenceReviewed ||
                !responseReviewed ||
                !limitsReviewed
              }
              type="submit"
            >
              {busy ? "Recording approval" : "Approve report and close case"}
            </button>
          </div>
        </form>
      ) : (
        <div className="report-closed-state">
          <strong>Case closed</strong>
          <span>No external system was contacted.</span>
          {fixture.id === "case-cloud-0421" ? (
            <Link href="/cases/case-endpoint-0448">
              Open next escalation <span aria-hidden="true">→</span>
            </Link>
          ) : (
            <Link href="/alerts">Return to incident ledger</Link>
          )}
        </div>
      )}
    </section>
  );
}

function formatReportDisposition(
  disposition: NonNullable<CaseState["report"]["report"]>["disposition"],
): string {
  return disposition === "authorized_activity_policy_exception"
    ? "Authorized activity · policy exception"
    : "Confirmed malicious · controls authorized";
}

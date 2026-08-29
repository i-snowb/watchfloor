import Link from "next/link";
import type { CaseFixture, CaseState } from "@/domain/types";

interface CaseReportPanelProps {
  fixture: CaseFixture;
  state: CaseState;
}

export function CaseReportPanel({ fixture, state }: CaseReportPanelProps) {
  if (state.decision.status === "pending") return null;
  if (state.report.status === "unavailable") return null;

  const report = state.report.report;
  if (!report) return null;
  const approved = state.report.status === "approved_in_demo";

  return (
    <section
      aria-label="Case evidence report"
      aria-live="polite"
      className={`case-report-card ${approved ? "case-report-approved" : ""}`}
    >
      <div className="report-heading">
        <div>
          <p className="eyebrow">
            {report.id} · {report.version}
          </p>
          <h3>{report.title}</h3>
        </div>
        <span>{approved ? "Approved" : "Drafted"}</span>
      </div>
      <div className="report-verdict">
        <span>Conclusion</span>
        <strong>{formatReportDisposition(report.disposition)}</strong>
        <p>{report.executiveSummary}</p>
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
      </div>
      <details className="report-limitations">
        <summary>{report.limitations.length} evidence limitations</summary>
        <ul>
          {report.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </details>
      {!approved ? (
        <p className="report-command-note">
          Review this evidence record before using the analyst approval gate.
        </p>
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

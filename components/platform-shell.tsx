import Link from "next/link";
import type { ReactNode, Ref } from "react";

export type AgentStatus =
  | { state: "checking"; count: 0 }
  | { state: "unavailable"; count: 0 }
  | { state: "available"; count: number }
  | { state: "partial"; count: number };

interface PlatformShellProps {
  fixture: { id: string; alerts: readonly unknown[] };
  activeView: "alerts" | "case";
  agentStatus: AgentStatus;
  onOpenAgent?: () => void;
  onReset?: () => void;
  mainRef?: Ref<HTMLElement>;
  queueCount?: number;
  queueSummary?: string;
  children: ReactNode;
}

export function PlatformShell({
  fixture,
  activeView,
  agentStatus,
  onOpenAgent,
  onReset,
  mainRef,
  queueCount,
  queueSummary,
  children,
}: PlatformShellProps) {
  return (
    <div className={`platform-shell platform-shell-${activeView}`}>
      <header className="platform-header">
        <Link className="brand" href="/alerts" aria-label="TRACE LAB alerts">
          <span className="brand-word">TRACE</span>
          <span className="brand-slashes">{"//"}</span>
          <span className="brand-word">LAB</span>
        </Link>
        <div className="header-context">
          <span>
            {activeView === "alerts" ? "Operations" : "Investigation"}
          </span>
          <span className="context-separator">/</span>
          <span className="header-case-id">
            {activeView === "alerts"
              ? (queueSummary ??
                `${queueCount ?? fixture.alerts.length} active cases`)
              : formatCaseId(fixture.id)}
          </span>
          {activeView === "case" ? (
            <>
              <span className="context-separator">·</span>
              <span>{fixture.alerts.length} linked detections</span>
            </>
          ) : null}
        </div>
        <div className="header-actions">
          <Link className="mobile-alert-link" href="/alerts">
            {activeView === "alerts"
              ? `Cases · ${queueCount ?? fixture.alerts.length}`
              : "All cases"}
          </Link>
          <button
            aria-label={agentStatusLabel(agentStatus)}
            className={`agent-chip agent-chip-${agentStatus.state}`}
            disabled={!onOpenAgent}
            onClick={onOpenAgent}
            type="button"
          >
            <span className="status-dot" />
            <span className="agent-chip-label">
              {agentStatusLabel(agentStatus)}
            </span>
          </button>
          {onReset ? (
            <details className="header-overflow">
              <summary aria-label="Open case menu">•••</summary>
              <div>
                <button
                  onClick={(event) => {
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                    onReset();
                  }}
                  type="button"
                >
                  Reset case
                </button>
              </div>
            </details>
          ) : null}
        </div>
      </header>
      <div className={`platform-body platform-body-${activeView}`}>
        <main className="platform-main" ref={mainRef}>
          {children}
        </main>
      </div>
    </div>
  );
}

function formatCaseId(caseId: string): string {
  const suffix = caseId.match(/(\d+)$/)?.[1];
  return suffix ? `CASE-${suffix.padStart(5, "0")}` : caseId.toUpperCase();
}

function agentStatusLabel(status: AgentStatus): string {
  if (status.state === "checking") return "Connecting copilot";
  if (status.state === "unavailable") {
    return "Copilot unavailable in this browser";
  }
  if (status.state === "available") {
    return `Copilot connected · ${status.count} tools`;
  }
  return `Copilot limited · ${status.count} tools`;
}

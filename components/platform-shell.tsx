import Link from "next/link";
import type { ReactNode, Ref } from "react";
import { AgentHandoff } from "./agent-handoff";

export type AgentStatus =
  | { state: "checking"; count: 0 }
  | { state: "unavailable"; count: 0 }
  | { state: "available"; count: number; total?: number }
  | {
      state: "partial";
      count: number;
      total?: number;
      missingCriticalToolNames?: string[];
    };

interface PlatformShellProps {
  fixture: { id: string; alerts: readonly unknown[] };
  activeView: "alerts" | "case";
  agentStatus: AgentStatus;
  onOpenAgent?: () => void;
  onReset?: () => void;
  onStartFreshSession?: () => void;
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
  onStartFreshSession,
  mainRef,
  queueCount,
  queueSummary,
  children,
}: PlatformShellProps) {
  return (
    <div className={`platform-shell platform-shell-${activeView}`}>
      <header className="platform-header">
        <Link className="brand" href="/alerts" aria-label="WATCH//FLOOR alerts">
          <span className="brand-word">WATCH</span>
          <span className="brand-slashes">{"//"}</span>
          <span className="brand-word">FLOOR</span>
        </Link>
        <div className="header-context">
          <span>Security operations</span>
          <span className="context-separator">/</span>
          <span className="header-case-id">
            {activeView === "alerts"
              ? (queueSummary ??
                `${queueCount ?? fixture.alerts.length} active cases`)
              : formatCaseId(fixture.id)}
          </span>
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
              {agentStatusShortLabel(agentStatus)}
            </span>
            <span aria-hidden="true" className="agent-chip-compact-label">
              {agentStatusCompactLabel(agentStatus)}
            </span>
          </button>
          {activeView === "case" ? (
            <AgentHandoff agentStatus={agentStatus} caseId={fixture.id} />
          ) : null}
          {onReset || onStartFreshSession ? (
            <details className="header-overflow">
              <summary aria-label="Open case menu">•••</summary>
              <div>
                {onReset ? (
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
                ) : null}
                {onStartFreshSession ? (
                  <button
                    onClick={(event) => {
                      event.currentTarget
                        .closest("details")
                        ?.removeAttribute("open");
                      onStartFreshSession();
                    }}
                    type="button"
                  >
                    Start fresh session
                  </button>
                ) : null}
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
  if (status.state === "checking") return "Connecting TRACE";
  if (status.state === "unavailable") {
    return "TRACE unavailable in this browser";
  }
  if (status.state === "available") {
    return `TRACE ready · ${status.count} tools available`;
  }
  const criticalMissing = status.missingCriticalToolNames?.length ?? 0;
  return criticalMissing > 0
    ? `TRACE blocked · ${criticalMissing} critical ${criticalMissing === 1 ? "tool" : "tools"} missing`
    : `TRACE limited · ${status.count}/${status.total ?? status.count} tools`;
}

function agentStatusShortLabel(status: AgentStatus): string {
  if (status.state === "checking") return "Connecting TRACE";
  if (status.state === "unavailable") return "TRACE unavailable";
  if (status.state === "available") {
    return `TRACE ready · ${status.count} tools`;
  }
  return status.missingCriticalToolNames?.length
    ? "TRACE blocked"
    : "TRACE limited";
}

function agentStatusCompactLabel(status: AgentStatus): string {
  if (status.state === "available") return `TRACE · ${status.count}`;
  if (status.state === "partial") return `TRACE · ${status.count}`;
  if (status.state === "checking") return "TRACE";
  return "TRACE";
}

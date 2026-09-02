"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getCaseQueueItems } from "@/domain/case-queue";
import { createInitialCaseState } from "@/domain/operations";
import { getReferenceCase } from "@/domain/reference-cases";
import type { CaseFixture, CaseQueueItem, CaseSnapshot } from "@/domain/types";
import { loadCase, resetCase } from "@/lib/client-api";
import { formatUtcTime } from "@/lib/format";
import {
  registerCaseTools,
  type ToolRegistrationOutcome,
} from "@/webmcp/tools";
import styles from "./alert-workspace.module.css";
import { PlatformShell, type AgentStatus } from "./platform-shell";
import { createAlertToolDefinitions } from "./queue-webmcp";
import { queueHandoffPrompt } from "./queue-handoff-prompt";
import { useModalDialog } from "./use-modal-dialog";

type QueueFilter = "all" | "critical" | "high";
type QueueSyncState = "checking" | "ready" | "stale";

export function AlertWorkspace({
  fixtures,
}: {
  fixtures: readonly CaseFixture[];
}) {
  const fixture = fixtures[0];
  if (!fixture) {
    throw new Error("The alert queue requires at least one case record.");
  }
  const router = useRouter();
  const [snapshots, setSnapshots] = useState<Record<string, CaseSnapshot>>(() =>
    Object.fromEntries(
      fixtures.map((caseFixture) => [
        caseFixture.id,
        { state: createInitialCaseState(caseFixture), receipts: [] },
      ]),
    ),
  );
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queueSyncState, setQueueSyncState] =
    useState<QueueSyncState>("checking");
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({
    state: "checking",
    count: 0,
  });
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [queueTaskCopied, setQueueTaskCopied] = useState(false);
  const [registrationOutcomes, setRegistrationOutcomes] = useState<
    ToolRegistrationOutcome[]
  >([]);
  const closeAgentPanel = useCallback(() => setAgentPanelOpen(false), []);
  const dialogRef = useModalDialog(agentPanelOpen, closeAgentPanel);
  const queueItems = useMemo(
    () =>
      getCaseQueueItems(
        fixtures.map((caseFixture) => ({
          fixture: caseFixture,
          state:
            snapshots[caseFixture.id]?.state ??
            createInitialCaseState(caseFixture),
        })),
      ),
    [fixtures, snapshots],
  );
  const openCase = useCallback(
    (caseId: string) => router.push(`/cases/${caseId}`),
    [router],
  );
  useEffect(() => {
    let active = true;
    let syncing = false;
    let initialSyncPending = true;
    async function syncQueue() {
      if (
        syncing ||
        (!initialSyncPending && document.visibilityState === "hidden")
      ) {
        return;
      }
      syncing = true;
      try {
        const responses = await Promise.all(
          fixtures.map(async (caseFixture) => ({
            caseId: caseFixture.id,
            response: await loadCase(caseFixture.id),
          })),
        );
        if (active) {
          setQueueSyncState("ready");
          setSnapshots((current) => {
            let changed = false;
            const next = { ...current };
            for (const { caseId, response } of responses) {
              const previous = current[caseId];
              if (
                !previous ||
                response.snapshot.state.revision !== previous.state.revision ||
                response.snapshot.receipts.length !== previous.receipts.length
              ) {
                next[caseId] = response.snapshot;
                changed = true;
              }
            }
            return changed ? next : current;
          });
        }
      } catch {
        if (!active) return;
        setQueueSyncState("stale");
      } finally {
        syncing = false;
        initialSyncPending = false;
      }
    }
    void syncQueue();
    const interval = window.setInterval(() => void syncQueue(), 15_000);
    const resume = () => {
      if (document.visibilityState === "visible") void syncQueue();
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [fixtures]);

  const definitions = useMemo(
    () => createAlertToolDefinitions(fixtures, openCase),
    [fixtures, openCase],
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
      setRegistrationOutcomes(result.outcomes);
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
    }
    void register();
    return () => {
      active = false;
      controller.abort();
    };
  }, [definitions]);

  const resetQueueCase = useCallback(
    async (caseFixture: CaseFixture) => {
      setBusy(true);
      setError(null);
      try {
        const response = await resetCase(
          caseFixture.id,
          snapshots[caseFixture.id]?.state.revision ?? 1,
        );
        setSnapshots((current) => ({
          ...current,
          [caseFixture.id]: response.snapshot,
        }));
      } catch (resetError) {
        setError(
          resetError instanceof Error
            ? resetError.message
            : "The case could not be reset.",
        );
      } finally {
        setBusy(false);
      }
    },
    [snapshots],
  );

  const openFreshEndpointInvestigation = useCallback(async () => {
    const endpointFixture = fixtures.find(
      (caseFixture) => caseFixture.id === "case-endpoint-0448",
    );
    if (!endpointFixture) {
      setError("The priority endpoint case is unavailable.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await resetCase(
        endpointFixture.id,
        snapshots[endpointFixture.id]?.state.revision ?? 1,
      );
      setSnapshots((current) => ({
        ...current,
        [endpointFixture.id]: response.snapshot,
      }));
      router.push(`/cases/${endpointFixture.id}`);
    } catch (startError) {
      setError(
        startError instanceof Error
          ? startError.message
          : "The priority endpoint case could not be reset.",
      );
    } finally {
      setBusy(false);
    }
  }, [fixtures, router, snapshots]);

  const filteredItems = queueItems.filter((item) => {
    if (filter === "critical") return item.severity === "critical";
    if (filter === "high") return item.severity === "high";
    return true;
  });
  const selected = filteredItems.find((item) => item.id === selectedId) ?? null;
  const highPriorityCount = queueItems.filter(
    (item) => item.severity === "critical" || item.severity === "high",
  ).length;
  const openCaseCount = queueItems.filter(
    (item) => item.status !== "closed_in_demo",
  ).length;
  const openWorkflowCount = queueItems.filter(
    (item) =>
      item.investigationDepth === "full_response" &&
      item.status !== "closed_in_demo",
  ).length;
  const queueSyncCopy = formatQueueSyncState(queueSyncState);
  const queueAgentReady =
    agentStatus.state === "available" && definitions.length === 2;

  const copyQueueTask = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(queueHandoffPrompt);
      setQueueTaskCopied(true);
      window.setTimeout(() => setQueueTaskCopied(false), 2_000);
    } catch {
      setQueueTaskCopied(false);
    }
  }, []);

  return (
    <PlatformShell
      activeView="alerts"
      agentStatus={agentStatus}
      fixture={fixture}
      onOpenAgent={() => setAgentPanelOpen(true)}
      queueCount={queueItems.length}
      queueSummary="2 investigations · 3 evidence briefs"
    >
      <div className="queue-workspace">
        <header className="ledger-masthead">
          <div>
            <p className="ledger-kicker">Operations / Shift 02 / UTC</p>
            <h1>Incident ledger</h1>
          </div>
          <div
            className={`ledger-sync-state ledger-sync-state-${queueSyncState}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span aria-hidden="true" />
            <div>
              <strong>{queueSyncCopy.title}</strong>
              <span>{queueSyncCopy.detail}</span>
            </div>
          </div>
        </header>

        {queueSyncState === "checking" ? (
          <p className="visually-hidden" role="status">
            Synchronizing live case revisions. The case catalog remains
            available while the first update arrives.
          </p>
        ) : null}

        <section
          className={styles.featuredPath}
          aria-labelledby="priority-investigation-title"
        >
          <div className={styles.featuredHeader}>
            <div>
              <p className={styles.eyebrow}>Priority investigation</p>
              <h2 id="priority-investigation-title">
                Execution with early lateral movement
              </h2>
            </div>
            <span className={styles.toolCount}>Critical · Tier 2/3</span>
          </div>
          <div className={styles.featuredBody}>
            <div className={styles.featuredSummary}>
              <p>
                Correlate unsigned execution, host posture, service-identity
                use, repeated egress, lateral movement, and production
                credential exposure before authorizing response.
              </p>
              <button
                className={styles.openCase}
                disabled={busy}
                onClick={() => void openFreshEndpointInvestigation()}
                type="button"
              >
                {busy ? "Preparing investigation" : "Open fresh investigation"}
                <span aria-hidden="true">→</span>
              </button>
              <p className={styles.featuredGuidance}>
                Open the evidence plan, investigate directly, or hand the next
                bounded step to your agent.
              </p>
            </div>
          </div>
        </section>

        <section className="ledger-commandline" aria-label="Queue controls">
          <div className="ledger-counts" aria-label="Queue summary">
            <span>
              <strong>{queueItems.length}</strong> total cases
            </span>
            <span>
              <strong>{openCaseCount}</strong> open cases
            </span>
            <span>
              <strong>{openWorkflowCount}</strong> open workflows
            </span>
            <span>
              <strong>{highPriorityCount}</strong> high priority
            </span>
            <span>
              <strong>
                {
                  queueItems.filter(
                    (item) => item.investigationDepth === "full_response",
                  ).length
                }
              </strong>{" "}
              full investigations
            </span>
            <span>
              <strong>
                {
                  queueItems.filter(
                    (item) => item.investigationDepth === "reference_brief",
                  ).length
                }
              </strong>{" "}
              evidence briefs
            </span>
            <span>
              <strong>
                {Object.values(snapshots).reduce(
                  (count, caseSnapshot) =>
                    count + caseSnapshot.state.releasedStreamStageIds.length,
                  0,
                )}
              </strong>{" "}
              verified discoveries
            </span>
          </div>
          <div className="case-feed-filters" aria-label="Queue filters">
            <FilterButton
              active={filter === "all"}
              count={queueItems.length}
              label="All"
              onClick={() => setFilter("all")}
            />
            <FilterButton
              active={filter === "critical"}
              count={
                queueItems.filter((item) => item.severity === "critical").length
              }
              label="Critical"
              onClick={() => setFilter("critical")}
            />
            <FilterButton
              active={filter === "high"}
              count={
                queueItems.filter((item) => item.severity === "high").length
              }
              label="High"
              onClick={() => setFilter("high")}
            />
          </div>
        </section>

        <div className="ledger-time-ruler" aria-hidden="true">
          <span>#</span>
          <span>Observed UTC</span>
          <span>Primary relationship</span>
          <span>Latest evidence</span>
          <span>Current status</span>
          <strong>Open</strong>
        </div>

        <section
          className="incident-ledger"
          aria-labelledby="incident-ledger-title"
        >
          <h2 className="visually-hidden" id="incident-ledger-title">
            Active security cases
          </h2>
          <ol>
            {filteredItems.map((item, index) => {
              const expanded = selected?.id === item.id;
              const relation = getQueueRelation(item);
              const detailId = `incident-detail-${item.id}`;
              const caseFixture =
                fixtures.find((candidate) => candidate.id === item.caseId) ??
                null;
              const caseSnapshot = caseFixture
                ? (snapshots[caseFixture.id] ?? null)
                : null;
              return (
                <li
                  className={`incident-entry incident-entry-${item.severity} ${expanded ? "incident-entry-expanded" : ""}`}
                  key={item.id}
                >
                  <button
                    aria-controls={expanded ? detailId : undefined}
                    aria-expanded={expanded}
                    className="incident-entry-trigger"
                    onClick={() => setSelectedId(expanded ? "" : item.id)}
                    type="button"
                  >
                    <span className="incident-sequence">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="incident-clock">
                      <time dateTime={item.latestObservedAt}>
                        {formatUtcTime(item.latestObservedAt)}
                      </time>
                      <span
                        aria-label={`${item.severity} severity`}
                        className={`incident-severity incident-severity-${item.severity}`}
                      >
                        {formatSeverityInitial(item.severity)}
                      </span>
                    </span>
                    <span className="incident-relation">
                      <span
                        className={`${styles.workflowBadge} ${
                          item.investigationDepth === "full_response"
                            ? styles.workflowBadgeFull
                            : styles.workflowBadgeBrief
                        }`}
                      >
                        {item.investigationDepth === "full_response"
                          ? "Full workflow"
                          : "Evidence brief"}
                      </span>
                      <strong>
                        {relation.from}
                        <i aria-hidden="true">→</i>
                        {relation.to}
                      </strong>
                      <span>{item.title}</span>
                    </span>
                    <QueueCausalRun item={item} />
                    <span className="incident-decision-edge">
                      <span>{formatQueueStatus(item.status)}</span>
                      <strong>{item.latestObservation}</strong>
                    </span>
                    <span className="incident-disclosure" aria-hidden="true">
                      {expanded ? "−" : "+"}
                    </span>
                    <span className="visually-hidden">
                      {expanded ? "Collapse" : "Expand"} case details
                    </span>
                  </button>
                  {expanded ? (
                    <CaseLedgerDetail
                      busy={busy}
                      error={error}
                      fixture={caseFixture}
                      item={item}
                      onReset={() => {
                        if (caseFixture) void resetQueueCase(caseFixture);
                      }}
                      snapshot={caseSnapshot}
                    />
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      {agentPanelOpen ? (
        <div className="drawer-backdrop" onMouseDown={closeAgentPanel}>
          <aside
            aria-labelledby="alert-agent-title"
            aria-modal="true"
            className="agent-drawer"
            onMouseDown={(event) => event.stopPropagation()}
            ref={dialogRef}
            role="dialog"
          >
            <div className="drawer-header">
              <div>
                <p className="eyebrow">WebMCP</p>
                <h2 id="alert-agent-title">Queue operations</h2>
              </div>
              <button
                aria-label="Close TRACE queue tools"
                className="icon-button"
                onClick={closeAgentPanel}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="drawer-intro">
              {queueAgentReady ? (
                <>
                  <strong>TRACE ready — waiting for a queue task</strong>
                  <p>
                    Ask your agent to review and prioritize the queue, then open
                    a case for bounded investigation work.
                  </p>
                  <button onClick={() => void copyQueueTask()} type="button">
                    {queueTaskCopied ? "Copied" : "Copy queue task"}
                  </button>
                </>
              ) : (
                <p>
                  {agentStatus.state === "partial"
                    ? "Some queue operations registered. Failed operations remain unavailable."
                    : agentStatus.state === "checking"
                      ? "Checking declared queue operations."
                      : "Queue review remains available to the analyst in this browser."}
                </p>
              )}
            </div>
            <div className="capability-list">
              {definitions.map((tool) => {
                const outcome = registrationOutcomes.find(
                  (item) => item.name === tool.name,
                );
                return (
                  <div className="capability-row" key={tool.name}>
                    <span
                      className={`capability-state capability-state-${outcome?.status ?? "checking"}`}
                    />
                    <div>
                      <div className="capability-title-row">
                        <strong>{tool.title}</strong>
                        <span>{outcome?.status ?? "checking"}</span>
                      </div>
                      <code>{tool.name}</code>
                      <p>{tool.description}</p>
                      {outcome?.error ? (
                        <p className="capability-error">{outcome.error}</p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      ) : null}
    </PlatformShell>
  );
}

function FilterButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={active ? "case-filter-active" : ""}
      onClick={onClick}
      type="button"
    >
      {label} <span>{count}</span>
    </button>
  );
}

function CaseLedgerDetail({
  item,
  fixture,
  snapshot,
  busy,
  error,
  onReset,
}: {
  item: CaseQueueItem;
  fixture: CaseFixture | null;
  snapshot: CaseSnapshot | null;
  busy: boolean;
  error: string | null;
  onReset: () => void;
}) {
  const routableCase = item.caseId !== null;
  const released = snapshot?.state.releasedStreamStageIds.length ?? 0;
  const latestReceipt = snapshot?.receipts.at(-1) ?? null;
  const relation = getQueueRelation(item);
  const sourceLabels = item.source.split(" · ");
  const referenceCase = item.caseId ? getReferenceCase(item.caseId) : null;
  const handoffState = fixture
    ? {
        primary: `${fixture.tier1Escalation.confidence} confidence`,
        secondary: (() => {
          const openInvestigations =
            fixture.tier1Escalation.recommendedSteps.filter(
              (step) =>
                step.completionArtifactId === null ||
                !snapshot?.state.attachedEnrichmentIds.includes(
                  step.completionArtifactId,
                ),
            ).length;
          return openInvestigations === 0
            ? "Evidence review ready"
            : `${openInvestigations} investigation${openInvestigations === 1 ? "" : "s"} available`;
        })(),
        reason: fixture.tier1Escalation.escalationReason,
      }
    : referenceCase
      ? {
          primary: `${referenceCase.tier1.observations.length} observations`,
          secondary: `${referenceCase.tier1.recommendations.length} investigations available`,
          reason: referenceCase.tier1.reason,
        }
      : {
          primary: "Review required",
          secondary: "Evidence continuity pending",
          reason: item.latestObservation,
        };

  return (
    <section
      aria-label={`${item.title} details`}
      className={`case-ledger-sheet case-ledger-sheet-${item.severity}`}
      id={`incident-detail-${item.id}`}
    >
      <div className="case-sheet-index">
        <span>
          {item.caseId ? item.caseId.replace("case-", "Case ") : "Case preview"}
        </span>
        <strong>{item.severity}</strong>
        <time dateTime={item.latestObservedAt}>
          {formatUtcTime(item.latestObservedAt)} UTC
        </time>
      </div>

      <div className="case-sheet-body">
        <header className="case-sheet-heading">
          <div>
            <span>
              {item.tier1Label} / {formatQueueStatus(item.status)}
            </span>
            <span
              className={`${styles.workflowBadge} ${
                item.investigationDepth === "full_response"
                  ? styles.workflowBadgeFull
                  : styles.workflowBadgeBrief
              }`}
            >
              {item.investigationDepth === "full_response"
                ? "Full workflow"
                : "Evidence brief"}
            </span>
            <h2>
              {relation.from} <i aria-hidden="true">→</i> {relation.to}
            </h2>
          </div>
          <p>{item.impact}</p>
        </header>

        <div className="case-sheet-sections">
          <section className="case-sheet-memo">
            <span>Tier 1 escalation</span>
            <div className="case-sheet-handoff-state">
              <strong>{handoffState.primary}</strong>
              <span>{handoffState.secondary}</span>
            </div>
            <p>{handoffState.reason}</p>
            <dl>
              <div>
                <dt>Signals</dt>
                <dd>{item.signalCount}</dd>
              </div>
              <div>
                <dt>Sources</dt>
                <dd>{sourceLabels.length}</dd>
              </div>
            </dl>
          </section>

          <section className="case-sheet-evidence">
            <div className="case-sheet-evidence-head">
              <span>Observed relationship</span>
              <div>
                {sourceLabels.map((source) => (
                  <span key={source}>{source}</span>
                ))}
              </div>
            </div>
            <QueueCausalRun item={item} large />
            <p>{item.latestObservation}</p>
            {fixture && snapshot ? (
              <div className="case-sheet-stream">
                <div>
                  <span>Automated investigation</span>
                  <strong>
                    Adds verified entities and relationships from attached
                    evidence.
                  </strong>
                </div>
              </div>
            ) : null}
          </section>
        </div>

        {latestReceipt ? (
          <div className="case-sheet-receipt">
            <span>
              {latestReceipt.reportedSurface === "webmcp_callback"
                ? "WebMCP"
                : "Analyst"}
            </span>
            <code>{latestReceipt.toolName}</code>
            <strong>{latestReceipt.resultSummary}</strong>
            <span>
              r{latestReceipt.baseRevision}→r{latestReceipt.resultRevision}
            </span>
            <time dateTime={latestReceipt.occurredAt}>
              {formatUtcTime(latestReceipt.occurredAt)}
            </time>
            <span>Recorded activity</span>
          </div>
        ) : (
          <div className="case-sheet-receipt case-sheet-receipt-idle">
            <span>TRACE access</span>
            <code>list_case_queue</code>
            <code>open_case</code>
            <strong>
              Queue tools are registered here. Open the case for investigation
              tools.
            </strong>
          </div>
        )}

        <footer className="case-sheet-footer">
          <p>
            {item.investigationDepth === "full_response"
              ? "Investigate evidence, document response decisions, and review the case report. Recorded approval does not execute an external control."
              : "Evidence brief with recorded entities, available investigations, and stated limitations. It is not part of the shared response workflow."}
          </p>
          {routableCase ? (
            <div>
              {fixture && snapshot ? (
                <button
                  className="case-sheet-reset"
                  disabled={
                    busy || (released === 0 && snapshot.receipts.length === 0)
                  }
                  onClick={onReset}
                  type="button"
                >
                  Reset case
                </button>
              ) : null}
              <Link className="case-sheet-open" href={`/cases/${item.caseId}`}>
                {item.investigationDepth === "full_response"
                  ? "Open shared investigation"
                  : "Open evidence brief"}{" "}
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          ) : null}
        </footer>

        {error ? (
          <p className="operation-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

type QueueTraceKind =
  | "identity"
  | "role"
  | "file"
  | "endpoint"
  | "process"
  | "network"
  | "application"
  | "permission"
  | "workload"
  | "namespace"
  | "secret"
  | "workflow"
  | "runner"
  | "environment";

const queueTraceKinds: Readonly<Record<string, readonly QueueTraceKind[]>> = {
  "queue-endpoint-0448": ["endpoint", "identity", "endpoint"],
  "queue-oauth-0437": ["identity", "application", "permission"],
  "queue-k8s-0414": ["workload", "namespace", "network"],
  "queue-cicd-0392": ["workflow", "file", "workload"],
};

const queueTraceLabels: Readonly<Record<QueueTraceKind, string>> = {
  identity: "ID",
  role: "ROLE",
  file: "FILE",
  endpoint: "HOST",
  process: "PROC",
  network: "NET",
  application: "APP",
  permission: "SCOPE",
  workload: "WORK",
  namespace: "NS",
  secret: "SECRET",
  workflow: "FLOW",
  runner: "RUNNER",
  environment: "ENV",
};

function QueueCausalRun({
  item,
  large = false,
}: {
  item: CaseQueueItem;
  large?: boolean;
}) {
  const kinds = getQueueTraceKinds(item);
  return (
    <span
      className={`queue-causal-run ${large ? "queue-causal-run-large" : ""}`}
    >
      {item.entityLabels.map((label, index) => {
        const kind = kinds[index] ?? "file";
        return (
          <span
            aria-label={`${queueTraceLabels[kind]}: ${label}`}
            className={`queue-causal-node queue-causal-node-${kind}`}
            key={label}
            title={label}
          >
            <small>{queueTraceLabels[kind]}</small>
            <strong>{label}</strong>
          </span>
        );
      })}
    </span>
  );
}

function getQueueTraceKinds(item: CaseQueueItem): readonly QueueTraceKind[] {
  if (item.id !== "queue-cloud-0421") {
    return queueTraceKinds[item.id] ?? ["identity", "role", "file"];
  }
  if (item.entityLabels[1]?.startsWith("FIN-WS")) {
    return [
      "identity",
      "endpoint",
      item.entityLabels[2]?.match(/^\d{1,3}(\.\d{1,3}){3}$/)
        ? "network"
        : "file",
    ];
  }
  return ["identity", "role", "file"];
}

function getQueueRelation(item: CaseQueueItem): {
  from: string;
  to: string;
} {
  return {
    from: item.entityLabels[0] ?? "Unknown source",
    to: item.entityLabels.at(-1) ?? "Unknown target",
  };
}

function formatSeverityInitial(severity: CaseQueueItem["severity"]): string {
  if (severity === "critical") return "C";
  if (severity === "high") return "H";
  return "M";
}

function formatQueueSyncState(state: QueueSyncState): {
  title: string;
  detail: string;
} {
  if (state === "ready") {
    return { title: "Queue current", detail: "Refreshes every 15 seconds" };
  }
  if (state === "stale") {
    return {
      title: "Queue refresh delayed",
      detail: "Showing the last received state",
    };
  }
  return { title: "Connecting queue", detail: "Waiting for case state" };
}

function formatQueueStatus(status: CaseQueueItem["status"]): string {
  if (status === "awaiting_review") return "Needs review";
  if (status === "tier1_triage") return "Tier 1 triage";
  if (status === "investigating") return "Investigating";
  if (status === "response_pending") return "Response pending";
  if (status === "contained_in_demo") return "Containment recorded";
  return "Closed";
}

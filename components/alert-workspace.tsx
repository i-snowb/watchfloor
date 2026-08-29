"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getCaseQueueItems } from "@/domain/case-queue";
import { createInitialCaseState } from "@/domain/operations";
import { getReferenceCase } from "@/domain/reference-cases";
import type { CaseFixture, CaseQueueItem, CaseSnapshot } from "@/domain/types";
import { executeTool, loadCase, resetCase } from "@/lib/client-api";
import { formatUtcTime } from "@/lib/format";
import type { ToolRegistrationOutcome } from "@/webmcp/tools";
import { PlatformShell, type AgentStatus } from "./platform-shell";
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
    throw new Error(
      "The alert queue requires at least one synthetic case fixture.",
    );
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
    async function syncQueue() {
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
      }
    }
    void syncQueue();
    const interval = window.setInterval(() => void syncQueue(), 2_000);
    return () => {
      active = false;
      window.clearInterval(interval);
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
      if (
        !document.modelContext ||
        typeof document.modelContext.registerTool !== "function"
      ) {
        if (active) {
          setAgentStatus({ state: "unavailable", count: 0 });
          setRegistrationOutcomes(
            definitions.map((tool) => ({
              name: tool.name,
              status: "unavailable",
              error: null,
            })),
          );
        }
        return;
      }
      let registered = 0;
      const outcomes: ToolRegistrationOutcome[] = [];
      for (const definition of definitions) {
        if (controller.signal.aborted) break;
        try {
          await document.modelContext.registerTool(definition, {
            signal: controller.signal,
          });
          if (controller.signal.aborted) break;
          registered += 1;
          outcomes.push({
            name: definition.name,
            status: "registered",
            error: null,
          });
        } catch (registrationError) {
          if (controller.signal.aborted) break;
          outcomes.push({
            name: definition.name,
            status: "failed",
            error:
              registrationError instanceof Error
                ? registrationError.message.replace(/\s+/g, " ").slice(0, 160)
                : "Tool registration failed.",
          });
        }
      }
      if (!active) return;
      setRegistrationOutcomes(outcomes);
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

  const releaseNextSignal = useCallback(
    async (caseFixture: CaseFixture) => {
      const snapshot = snapshots[caseFixture.id];
      if (!snapshot) return;
      setBusy(true);
      setError(null);
      try {
        const response = await executeTool(
          caseFixture.id,
          "release_next_synthetic_signal",
          "analyst_control",
          { expectedRevision: snapshot.state.revision },
        );
        setSnapshots((current) => ({
          ...current,
          [caseFixture.id]: response.snapshot,
        }));
        if (!response.result.ok) setError(response.result.error.message);
      } catch (releaseError) {
        setError(
          releaseError instanceof Error
            ? releaseError.message
            : "The next observation could not be released.",
        );
      } finally {
        setBusy(false);
      }
    },
    [snapshots],
  );

  const resetQueueCase = useCallback(async (caseFixture: CaseFixture) => {
    setBusy(true);
    setError(null);
    try {
      const response = await resetCase(caseFixture.id);
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
  }, []);

  const filteredItems = queueItems.filter((item) => {
    if (filter === "critical") return item.severity === "critical";
    if (filter === "high") return item.severity === "high";
    return true;
  });
  const selected = filteredItems.find((item) => item.id === selectedId) ?? null;
  const highPriorityCount = queueItems.filter(
    (item) => item.severity === "critical" || item.severity === "high",
  ).length;
  const escalatedCount = queueItems.filter(
    (item) => item.status !== "closed_in_demo",
  ).length;
  const queueSyncCopy = formatQueueSyncState(queueSyncState);

  return (
    <PlatformShell
      activeView="alerts"
      agentStatus={agentStatus}
      fixture={fixture}
      onOpenAgent={() => setAgentPanelOpen(true)}
      queueCount={queueItems.length}
    >
      <div className="queue-workspace">
        <header className="ledger-masthead">
          <div>
            <p className="ledger-kicker">Operations / Shift 02 / UTC</p>
            <h1>Incident ledger</h1>
          </div>
          <div
            className={`ledger-sync-state ledger-sync-state-${queueSyncState}`}
          >
            <span aria-hidden="true" />
            <div>
              <strong>{queueSyncCopy.title}</strong>
              <span>{queueSyncCopy.detail}</span>
            </div>
          </div>
        </header>

        <section className="ledger-commandline" aria-label="Queue controls">
          <div className="ledger-counts" aria-label="Queue summary">
            <span>
              <strong>{escalatedCount}</strong> Tier 1 escalations
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
              live observations
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
          <span>Incident relation</span>
          <span>Evidence run</span>
          <span>Decision edge</span>
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
                      onRelease={() => {
                        if (caseFixture) void releaseNextSignal(caseFixture);
                      }}
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
                aria-label="Close agent capabilities"
                className="icon-button"
                onClick={closeAgentPanel}
                type="button"
              >
                ×
              </button>
            </div>
            <p className="drawer-intro">
              {agentStatus.state === "available"
                ? "These semantic queue operations are registered."
                : agentStatus.state === "partial"
                  ? "Some queue operations registered. Failed operations remain unavailable."
                  : agentStatus.state === "checking"
                    ? "Checking declared queue operations."
                    : "These declared operations require a WebMCP-capable browser."}
            </p>
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
  onRelease,
  onReset,
}: {
  item: CaseQueueItem;
  fixture: CaseFixture | null;
  snapshot: CaseSnapshot | null;
  busy: boolean;
  error: string | null;
  onRelease: () => void;
  onReset: () => void;
}) {
  const routableCase = item.caseId !== null;
  const released = snapshot?.state.releasedStreamStageIds.length ?? 0;
  const streamComplete = fixture
    ? released >= fixture.stream.stages.length
    : true;
  const latestReceipt = snapshot?.receipts.at(-1) ?? null;
  const relation = getQueueRelation(item);
  const sourceLabels = item.source.split(" · ");
  const referenceCase = item.caseId ? getReferenceCase(item.caseId) : null;
  const handoffState = fixture
    ? {
        primary: `${fixture.tier1Escalation.confidence} confidence`,
        secondary: (() => {
          const openChecks = fixture.tier1Escalation.recommendedSteps.filter(
            (step) =>
              step.completionArtifactId === null ||
              !snapshot?.state.attachedEnrichmentIds.includes(
                step.completionArtifactId,
              ),
          ).length;
          return openChecks === 0
            ? "Evidence review ready"
            : `${openChecks} evidence check${openChecks === 1 ? "" : "s"} open`;
        })(),
        reason: fixture.tier1Escalation.escalationReason,
      }
    : referenceCase
      ? {
          primary: `${referenceCase.tier1.observations.length} observations`,
          secondary: `${referenceCase.tier1.recommendations.length} checks available`,
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
            <h2>
              {relation.from} <i aria-hidden="true">→</i> {relation.to}
            </h2>
          </div>
          <p>{item.impact}</p>
        </header>

        <div className="case-sheet-sections">
          <section className="case-sheet-memo">
            <span>Escalated by Tier 1</span>
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
              <span>Evidence edge</span>
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
                <div className="case-sheet-stage-rail" aria-hidden="true">
                  {fixture.stream.stages.map((stage, index) => (
                    <span
                      className={
                        index < released
                          ? "case-sheet-stage-released"
                          : index === released
                            ? "case-sheet-stage-next"
                            : ""
                      }
                      key={stage.id}
                    />
                  ))}
                </div>
                <div>
                  <span>Live replay inlet</span>
                  <strong>
                    {released}/{fixture.stream.stages.length} later observations
                  </strong>
                </div>
                {!streamComplete ? (
                  <button disabled={busy} onClick={onRelease} type="button">
                    Release observation {String(released + 1).padStart(2, "0")}
                  </button>
                ) : (
                  <strong className="case-sheet-stream-complete">
                    Replay complete
                  </strong>
                )}
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
            <span>client-reported</span>
          </div>
        ) : (
          <div className="case-sheet-receipt case-sheet-receipt-idle">
            <span>Copilot access</span>
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
              ? "Complete evidence, response, and report lifecycle. Recorded approval never executes an external control."
              : "Explorable local evidence brief with typed entities, available queries, and explicit limitations. It is not part of the shared response lifecycle."}
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
    return { title: "Queue current", detail: "Refreshes every 2 seconds" };
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
  if (status === "contained_in_demo") return "Contained · simulated";
  return "Closed";
}

function createAlertToolDefinitions(
  fixtures: readonly CaseFixture[],
  openCase: (caseId: string) => void,
): WebMcpToolDefinition[] {
  const requestId = { type: "string", minLength: 8, maxLength: 80 };
  const routableCaseIds = getCaseQueueItems(
    fixtures.map((fixture) => ({
      fixture,
      state: createInitialCaseState(fixture),
    })),
  ).flatMap((item) => (item.caseId ? [item.caseId] : []));
  return [
    {
      name: "list_case_queue",
      title: "List security case queue",
      description:
        "Return the synthetic cases and Tier 1 states visible in the queue.",
      inputSchema: {
        type: "object",
        properties: { requestId },
        required: ["requestId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async (_input, context) => {
        const signal = context?.signal ?? new AbortController().signal;
        const responses = await Promise.all(
          fixtures.map(async (fixture) => ({
            fixture,
            state: (await loadCase(fixture.id, signal)).snapshot.state,
          })),
        );
        const cases = getCaseQueueItems(responses);
        return { cases, count: cases.length };
      },
    },
    {
      name: "open_case",
      title: "Open escalated case",
      description:
        "Open the selected Tier 1 escalation in the shared investigation workbench.",
      inputSchema: {
        type: "object",
        properties: {
          requestId,
          caseId: { type: "string", enum: routableCaseIds },
        },
        required: ["requestId", "caseId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input, context) => {
        const signal = context?.signal ?? new AbortController().signal;
        if (signal.aborted) throw createAbortError();
        const caseId = input.caseId;
        if (typeof caseId !== "string" || !routableCaseIds.includes(caseId)) {
          throw new Error("caseId is not an openable case.");
        }
        queueMicrotask(() => {
          if (!signal.aborted) openCase(caseId);
        });
        return { caseId, route: `/cases/${caseId}` };
      },
    },
  ];
}

function createAbortError(): Error {
  const error = new Error("Tool invocation aborted.");
  error.name = "AbortError";
  return error;
}

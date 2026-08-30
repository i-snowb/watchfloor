"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ToolApiResponse } from "@/domain/api";
import {
  createInitialCaseState,
  getInvestigationPlans,
  getResponseBundles,
  type CaseToolName,
} from "@/domain/operations";
import type {
  CaseFixture,
  CaseSnapshot,
  AnalystReportSignoff,
} from "@/domain/types";
import { getAllEntities } from "@/domain/incident-stream";
import { executeTool, loadCase, resetCase } from "@/lib/client-api";
import {
  createCaseToolDefinitions,
  registerCaseTools,
  type ToolRegistrationOutcome,
  type WebMcpHandler,
} from "@/webmcp/tools";
import { AgentDrawer } from "./agent-drawer";
import {
  createInvestigationReceiptView,
  isInvestigationTool,
  type InvestigationActivity,
  type InvestigationResultView,
} from "./investigation-activity";
import { CaseCommandBar } from "./case-command-bar";
import type { TraceSelection } from "./trace-interaction";
import { CaseInspector } from "./case-inspector";
import { EvidenceMap } from "./evidence-map";
import { PlatformShell, type AgentStatus } from "./platform-shell";

interface AgentToolDispatcher {
  run: WebMcpHandler;
  setHandler: (handler: WebMcpHandler | null) => void;
}

function createAgentToolDispatcher(): AgentToolDispatcher {
  let handler: WebMcpHandler | null = null;
  return {
    run: (toolName, input, signal) => {
      if (handler) return handler(toolName, input, signal);
      return Promise.resolve({
        ok: false,
        error: {
          code: "COPILOT_INITIALIZING",
          message: "The investigation workbench is still initializing.",
          retryable: true,
        },
      });
    },
    setHandler: (nextHandler) => {
      handler = nextHandler;
    },
  };
}

export function CaseWorkbench({ fixture }: { fixture: CaseFixture }) {
  const initialSelection = useMemo(
    () => getInitialSelection(fixture),
    [fixture],
  );
  const [snapshot, setSnapshot] = useState<CaseSnapshot>({
    state: createInitialCaseState(fixture),
    receipts: [],
  });
  const snapshotRef = useRef(snapshot);
  const [selection, setSelection] = useState<TraceSelection>(initialSelection);
  const [analystSelectionActive, setAnalystSelectionActive] = useState(false);
  const selectionRef = useRef(selection);
  const [agentToolDispatcher] = useState(createAgentToolDispatcher);
  const mainRef = useRef<HTMLElement>(null);
  const [workbenchEpoch, setWorkbenchEpoch] = useState(0);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({
    state: "checking",
    count: 0,
  });
  const [registrationOutcomes, setRegistrationOutcomes] = useState<
    ToolRegistrationOutcome[]
  >([]);
  const [agentDrawerOpen, setAgentDrawerOpen] = useState(false);
  const [backendReady, setBackendReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentFocusEntityId, setAgentFocusEntityId] = useState<string | null>(
    null,
  );
  const [investigationActivity, setInvestigationActivity] =
    useState<InvestigationActivity>({ status: "idle" });
  const [reportReviewRequestToken, setReportReviewRequestToken] = useState(0);
  const [investigationResult, setInvestigationResult] =
    useState<InvestigationResultView | null>(null);
  const [liveReceipt, setLiveReceipt] = useState<
    CaseSnapshot["receipts"][number] | null
  >(null);
  const agentRunSequence = useRef(0);
  const preparedFocusRevision = useRef<number | null>(null);
  const runningStartedAt =
    investigationActivity.status === "running"
      ? investigationActivity.startedAt
      : null;
  const runningDurationMs =
    investigationActivity.status === "running"
      ? investigationActivity.expectedDurationMs
      : null;

  useEffect(() => {
    snapshotRef.current = snapshot;
    selectionRef.current = selection;
  }, [selection, snapshot]);

  useEffect(() => {
    if (runningStartedAt === null || runningDurationMs === null) return;
    const timer = window.setInterval(() => {
      setInvestigationActivity((current) => {
        if (
          current.status !== "running" ||
          current.startedAt !== runningStartedAt
        ) {
          return current;
        }
        const progress = Math.min(
          0.96,
          Math.max(
            0,
            (performance.now() - runningStartedAt) / runningDurationMs,
          ),
        );
        const phase =
          progress < 0.22 ? "scope" : progress < 0.72 ? "search" : "review";
        return current.progress === progress && current.phase === phase
          ? current
          : { ...current, phase, progress };
      });
    }, 180);
    return () => window.clearInterval(timer);
  }, [runningDurationMs, runningStartedAt]);

  useEffect(() => {
    let active = true;
    async function hydrateCase() {
      try {
        const response = await loadCase(fixture.id);
        if (!active) return;
        setSnapshot(response.snapshot);
        setSelection(initialSelection);
        setAnalystSelectionActive(false);
        setLiveReceipt(null);
        setBackendReady(true);
      } catch (loadError) {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Case state is unavailable.",
        );
      }
    }
    void hydrateCase();
    return () => {
      active = false;
    };
  }, [fixture, initialSelection]);

  useEffect(() => {
    if (!backendReady) return;
    let active = true;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void loadCase(fixture.id)
        .then((response) => {
          if (!active) return;
          setSnapshot((current) =>
            response.snapshot.state.revision !== current.state.revision ||
            response.snapshot.receipts.length !== current.receipts.length
              ? response.snapshot
              : current,
          );
        })
        .catch(() => undefined);
    }, 2_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [backendReady, fixture.id]);

  useEffect(() => {
    const prepared = snapshot.state.preparedQuery;
    if (!prepared) {
      preparedFocusRevision.current = null;
      return;
    }
    if (preparedFocusRevision.current === prepared.preparedAtRevision) return;
    preparedFocusRevision.current = prepared.preparedAtRevision;
    setAgentFocusEntityId(
      prepared.actor === "agent" ? prepared.targetEntityId : null,
    );
    setAnalystSelectionActive(prepared.actor === "analyst");
    setSelection({ kind: "entity", id: prepared.targetEntityId });
  }, [snapshot.state.preparedQuery]);

  const runAgentTool = useCallback(
    async (
      toolName: CaseToolName,
      webInput: Record<string, unknown>,
      signal: AbortSignal,
    ) => {
      const input = webInput;
      const requestId = `webmcp-${crypto.randomUUID()}`;
      const requestedExecution = resolveInvestigationExecution(
        fixture,
        snapshotRef.current.state,
        toolName,
        input,
      );
      const requestedFocusEntityId = readRequestedFocusEntityId(
        fixture,
        toolName,
        input,
        snapshotRef.current.state,
      );
      const baseRevision =
        typeof input.expectedRevision === "number"
          ? input.expectedRevision
          : snapshotRef.current.state.revision;
      const runSequence = ++agentRunSequence.current;
      setInvestigationActivity({
        status: "running",
        actor: "agent",
        toolName,
        queryId: requestedExecution?.queryId ?? readQueryId(input),
        targetEntityId: requestedFocusEntityId,
        baseRevision,
        expectedDurationMs: operationLatencyMs(toolName),
        phase: "scope",
        progress: 0,
        startedAt: performance.now(),
      });
      if (requestedFocusEntityId) {
        setAgentFocusEntityId(requestedFocusEntityId);
        setAnalystSelectionActive(false);
        setSelection({ kind: "entity", id: requestedFocusEntityId });
      }
      try {
        const startedAt = performance.now();
        await waitForOperation(toolName, signal);
        const response = await executeTool(
          fixture.id,
          toolName,
          "webmcp_callback",
          input,
          requestId,
          signal,
        );
        setSnapshot((current) =>
          response.snapshot.state.revision > current.state.revision ||
          (response.snapshot.state.revision === current.state.revision &&
            response.snapshot.receipts.length >= current.receipts.length)
            ? response.snapshot
            : current,
        );
        setBackendReady(true);
        if (agentRunSequence.current === runSequence) {
          setError(response.result.ok ? null : response.result.error.message);
        }
        const receipt = response.snapshot.receipts.at(-1);
        if (
          agentRunSequence.current === runSequence &&
          response.result.ok &&
          receipt?.status === "completed" &&
          toolName !== "prepare_investigation_query"
        ) {
          setLiveReceipt(receipt);
        }
        const completedExecution =
          readResponseInvestigationExecution(response) ?? requestedExecution;
        const summary =
          receipt?.resultSummary ??
          (response.result.ok
            ? "Automated finding attached to the case."
            : response.result.error.message);
        const receiptView = createInvestigationReceiptView({
          actor: "agent",
          toolName,
          targetEntityId:
            completedExecution?.targetEntityId ?? requestedFocusEntityId,
          baseRevision,
          resultRevision: response.snapshot.state.revision,
          durationMs: Math.round(performance.now() - startedAt),
          summary,
          data: response.result.ok ? response.result.data : null,
        });
        if (agentRunSequence.current === runSequence) {
          setInvestigationActivity({
            status: response.result.ok ? "completed" : "rejected",
            actor: "agent",
            toolName,
            queryId: completedExecution?.queryId ?? readQueryId(input),
            targetEntityId:
              completedExecution?.targetEntityId ?? requestedFocusEntityId,
            baseRevision,
            resultRevision: response.snapshot.state.revision,
            summary,
            ...(!response.result.ok
              ? { errorCode: response.result.error.code }
              : {}),
            receipt: receiptView,
          });
        }
        if (
          agentRunSequence.current === runSequence &&
          response.result.ok &&
          isInvestigationTool(toolName)
        ) {
          setInvestigationResult({
            actor: "agent",
            toolName,
            queryId: completedExecution?.queryId ?? readQueryId(input),
            targetEntityId:
              completedExecution?.targetEntityId ?? requestedFocusEntityId,
            baseRevision,
            resultRevision: response.snapshot.state.revision,
            summary,
            data: response.result.data,
            receipt: receiptView,
          });
        }
        const focusEntityId = readFocusEntityId(response);
        if (focusEntityId && agentRunSequence.current === runSequence) {
          setAgentFocusEntityId(focusEntityId);
          setAnalystSelectionActive(false);
          setSelection({ kind: "entity", id: focusEntityId });
        }
        return withSharedViewContext(
          toolName,
          response.result,
          selectionRef.current,
        );
      } catch (toolError) {
        if (
          signal.aborted ||
          (toolError instanceof Error && toolError.name === "AbortError")
        ) {
          if (agentRunSequence.current === runSequence) {
            setInvestigationActivity({ status: "idle" });
          }
          throw toolError;
        }
        const message =
          toolError instanceof Error
            ? toolError.message
            : "Investigation automation failed.";
        if (agentRunSequence.current === runSequence) {
          setError(message);
          setInvestigationActivity({
            status: "rejected",
            actor: "agent",
            toolName,
            queryId: readQueryId(input),
            targetEntityId: requestedFocusEntityId,
            baseRevision,
            resultRevision: baseRevision,
            summary: message,
            errorCode: "OPERATION_UNAVAILABLE",
          });
        }
        return {
          ok: false,
          error: { code: "OPERATION_UNAVAILABLE", message, retryable: true },
        };
      }
    },
    [fixture],
  );

  useEffect(() => {
    agentToolDispatcher.setHandler(runAgentTool);
    return () => agentToolDispatcher.setHandler(null);
  }, [agentToolDispatcher, runAgentTool]);

  const caseDefinitions = useMemo(
    () => createCaseToolDefinitions(fixture, agentToolDispatcher.run),
    [agentToolDispatcher, fixture],
  );

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function register() {
      const result = await registerCaseTools(caseDefinitions, controller);
      if (!active) {
        return;
      }
      setRegistrationOutcomes(result.outcomes);
      if (!result.supported) {
        setAgentStatus({ state: "unavailable", count: 0 });
      } else {
        setAgentStatus({
          state:
            result.registered === caseDefinitions.length &&
            result.readiness.ready
              ? "available"
              : "partial",
          count: result.registered,
          total: caseDefinitions.length,
          ...(result.readiness.ready
            ? {}
            : {
                missingCriticalToolNames:
                  result.readiness.missingCriticalToolNames,
              }),
        });
      }
    }
    void register();
    return () => {
      active = false;
      controller.abort();
    };
  }, [fixture.id, caseDefinitions]);

  const runManualTool = useCallback(
    async (toolName: CaseToolName, input: Record<string, unknown>) => {
      const investigation = isInvestigationTool(toolName);
      const requestedExecution = resolveInvestigationExecution(
        fixture,
        snapshotRef.current.state,
        toolName,
        input,
      );
      const requestedFocusEntityId = readRequestedFocusEntityId(
        fixture,
        toolName,
        input,
        snapshotRef.current.state,
      );
      const baseRevision =
        typeof input.expectedRevision === "number"
          ? input.expectedRevision
          : snapshotRef.current.state.revision;
      setBusy(true);
      setError(null);
      if (investigation) {
        setInvestigationActivity({
          status: "running",
          actor: "analyst",
          toolName,
          queryId: requestedExecution?.queryId ?? readQueryId(input),
          targetEntityId: requestedFocusEntityId,
          baseRevision,
          expectedDurationMs: operationLatencyMs(toolName),
          phase: "scope",
          progress: 0,
          startedAt: performance.now(),
        });
        if (requestedFocusEntityId) {
          setAgentFocusEntityId(null);
          setSelection({ kind: "entity", id: requestedFocusEntityId });
        }
      }
      try {
        const startedAt = performance.now();
        if (investigation) {
          await waitForOperation(toolName);
        }
        const response = await executeTool(
          fixture.id,
          toolName,
          "analyst_control",
          input,
        );
        setSnapshot(response.snapshot);
        const receipt = response.snapshot.receipts.at(-1);
        if (response.result.ok && receipt?.status === "completed") {
          setLiveReceipt(receipt);
        }
        if (!response.result.ok) setError(operationErrorMessage(response));
        if (investigation) {
          const completedExecution =
            readResponseInvestigationExecution(response) ?? requestedExecution;
          const summary =
            receipt?.resultSummary ??
            (response.result.ok
              ? "Investigation result attached to the case."
              : response.result.error.message);
          const receiptView = createInvestigationReceiptView({
            actor: "analyst",
            toolName,
            targetEntityId:
              completedExecution?.targetEntityId ?? requestedFocusEntityId,
            baseRevision,
            resultRevision: response.snapshot.state.revision,
            durationMs: Math.round(performance.now() - startedAt),
            summary,
            data: response.result.ok ? response.result.data : null,
          });
          setInvestigationActivity({
            status: response.result.ok ? "completed" : "rejected",
            actor: "analyst",
            toolName,
            queryId: completedExecution?.queryId ?? readQueryId(input),
            targetEntityId:
              completedExecution?.targetEntityId ?? requestedFocusEntityId,
            baseRevision,
            resultRevision: response.snapshot.state.revision,
            summary,
            ...(!response.result.ok
              ? { errorCode: response.result.error.code }
              : {}),
            receipt: receiptView,
          });
          if (response.result.ok) {
            setInvestigationResult({
              actor: "analyst",
              toolName,
              queryId: completedExecution?.queryId ?? readQueryId(input),
              targetEntityId:
                completedExecution?.targetEntityId ?? requestedFocusEntityId,
              baseRevision,
              resultRevision: response.snapshot.state.revision,
              summary,
              data: response.result.data,
              receipt: receiptView,
            });
          }
        }
      } catch (toolError) {
        const message =
          toolError instanceof Error ? toolError.message : "Operation failed.";
        setError(message);
        if (investigation) {
          setInvestigationActivity({
            status: "rejected",
            actor: "analyst",
            toolName,
            queryId: readQueryId(input),
            targetEntityId: requestedFocusEntityId,
            baseRevision,
            resultRevision: baseRevision,
            summary: message,
            errorCode: "OPERATION_UNAVAILABLE",
          });
        }
      } finally {
        setBusy(false);
      }
    },
    [fixture],
  );

  const handleReset = useCallback(async () => {
    setBusy(true);
    setError(null);
    setInvestigationActivity({ status: "idle" });
    setInvestigationResult(null);
    setLiveReceipt(null);
    setAgentDrawerOpen(false);
    setAnalystSelectionActive(false);
    try {
      const response = await resetCase(fixture.id);
      setSnapshot(response.snapshot);
      setSelection(initialSelection);
      setAgentFocusEntityId(null);
      setBackendReady(true);
      setWorkbenchEpoch((current) => current + 1);
      window.requestAnimationFrame(() => {
        mainRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
      });
    } catch (resetError) {
      setError(
        resetError instanceof Error
          ? resetError.message
          : "The case could not be reset.",
      );
    } finally {
      setBusy(false);
    }
  }, [fixture.id, initialSelection]);

  const selectAsAnalyst = useCallback((next: TraceSelection) => {
    setAgentFocusEntityId(null);
    setAnalystSelectionActive(true);
    setSelection(next);
  }, []);

  const latestReceipt = snapshot.receipts.at(-1) ?? null;
  const latestAuthorizationReceipt =
    liveReceipt &&
    (liveReceipt.toolName === "authorize_response_action" ||
      liveReceipt.toolName === "authorize_response_bundle")
      ? liveReceipt
      : null;
  const operationBusy =
    busy || !backendReady || investigationActivity.status === "running";
  const displayedInvestigationActivity =
    investigationActivity.status === "idle"
      ? {
          ...investigationActivity,
          availableToolCount: caseDefinitions.length,
          totalToolCount: caseDefinitions.length,
        }
      : investigationActivity;
  return (
    <PlatformShell
      activeView="case"
      agentStatus={agentStatus}
      fixture={fixture}
      mainRef={mainRef}
      onOpenAgent={() => setAgentDrawerOpen(true)}
      onReset={() => void handleReset()}
    >
      {agentStatus.state === "partial" &&
      (agentStatus.missingCriticalToolNames?.length ?? 0) > 0 ? (
        <aside className="webmcp-readiness-block" role="alert">
          <div>
            <span>Investigation automation unavailable</span>
            <strong>Critical investigation tools did not register</strong>
          </div>
          <code>{agentStatus.missingCriticalToolNames?.join(" · ")}</code>
          <p>Reload the workspace before continuing the investigation.</p>
        </aside>
      ) : null}
      <div className="case-view">
        <div className="investigation-cockpit">
          <div className="workbench-grid">
            <EvidenceMap
              busy={operationBusy}
              hydrated={backendReady}
              actionDock={
                <CaseCommandBar
                  agentStatus={agentStatus}
                  busy={operationBusy}
                  fixture={fixture}
                  onExecute={runManualTool}
                  onReset={() => void handleReset()}
                  onSelect={selectAsAnalyst}
                  selection={selection}
                  showInvestigationControls={analystSelectionActive}
                  investigationActivity={displayedInvestigationActivity}
                  onOpenReportReview={() =>
                    setReportReviewRequestToken((current) => current + 1)
                  }
                  state={snapshot.state}
                />
              }
              investigationActivity={displayedInvestigationActivity}
              investigationResult={investigationResult}
              agentFocusEntityId={agentFocusEntityId}
              fixture={fixture}
              key={`${fixture.id}-workbench-${workbenchEpoch}`}
              latestAuthorizationReceipt={latestAuthorizationReceipt}
              latestReceipt={liveReceipt}
              onSelect={selectAsAnalyst}
              onApproveReport={(signoff: AnalystReportSignoff) =>
                runManualTool("approve_case_report", {
                  expectedRevision: snapshotRef.current.state.revision,
                  reportId: snapshotRef.current.state.report.report?.id,
                  acknowledgement: "APPROVE_SYNTHETIC_REPORT",
                  ...signoff,
                })
              }
              receipts={snapshot.receipts}
              selection={selection}
              showInvestigationActions={analystSelectionActive}
              state={snapshot.state}
              reportReviewRequestToken={reportReviewRequestToken}
            >
              <CaseInspector
                investigationActivity={displayedInvestigationActivity}
                agentAvailable={agentStatus.state === "available"}
                error={error}
                fixture={fixture}
                latestReceipt={latestReceipt}
                onSelect={selectAsAnalyst}
                selection={selection}
                state={snapshot.state}
              />
            </EvidenceMap>
          </div>
        </div>
      </div>

      <AgentDrawer
        definitions={caseDefinitions}
        onClose={() => setAgentDrawerOpen(false)}
        open={agentDrawerOpen}
        outcomes={registrationOutcomes}
        receipts={snapshot.receipts}
      />
    </PlatformShell>
  );
}

function operationErrorMessage(response: ToolApiResponse): string {
  if (response.result.ok) return "";
  if (
    response.result.error.code === "STALE_STATE" ||
    response.result.error.code === "CONCURRENT_UPDATE"
  ) {
    return `Case advanced to r${response.snapshot.state.revision}. Review the current evidence and rerun this step.`;
  }
  return response.result.error.message;
}

function readFocusEntityId(response: ToolApiResponse): string | null {
  if (
    !response.result.ok ||
    response.result.data === null ||
    typeof response.result.data !== "object"
  ) {
    return null;
  }
  const value = (response.result.data as { focusEntityId?: unknown })
    .focusEntityId;
  return typeof value === "string" ? value : null;
}

function readRequestedFocusEntityId(
  fixture: CaseFixture,
  toolName: CaseToolName,
  input: Record<string, unknown>,
  state?: CaseSnapshot["state"],
): string | null {
  const directTarget =
    typeof input.entityId === "string"
      ? input.entityId
      : typeof input.fromEntityId === "string"
        ? input.fromEntityId
        : null;
  if (
    (toolName === "prepare_investigation_query" ||
      toolName === "run_investigation_query") &&
    typeof input.queryId === "string"
  ) {
    return (
      fixture.investigationQueries.find((query) => query.id === input.queryId)
        ?.targetEntityId ?? null
    );
  }
  if (
    toolName === "run_investigation_plan" &&
    typeof input.planId === "string"
  ) {
    return (
      resolveInvestigationExecution(
        fixture,
        state ?? createInitialCaseState(fixture),
        toolName,
        input,
      )?.targetEntityId ?? null
    );
  }
  if (
    directTarget &&
    getAllEntities(fixture).some((entity) => entity.id === directTarget)
  ) {
    return directTarget;
  }
  if (
    (toolName === "propose_response_action" ||
      toolName === "simulate_response_action") &&
    typeof input.actionId === "string"
  ) {
    return (
      fixture.responseActions.find((action) => action.id === input.actionId)
        ?.targetEntityId ?? null
    );
  }
  if (
    toolName === "prepare_response_bundle" &&
    typeof input.bundleId === "string"
  ) {
    return (
      getResponseBundles(fixture).find((bundle) => bundle.id === input.bundleId)
        ?.targetEntityIds[0] ?? null
    );
  }
  if (
    toolName === "request_next_observation" &&
    typeof input.stageId === "string"
  ) {
    return (
      fixture.stream.stages
        .find((stage) => stage.id === input.stageId)
        ?.events.at(-1)
        ?.entityIds.at(-1) ?? null
    );
  }
  return null;
}

function resolveInvestigationExecution(
  fixture: CaseFixture,
  state: CaseSnapshot["state"],
  toolName: CaseToolName,
  input: Record<string, unknown>,
): { queryId: string; targetEntityId: string } | null {
  if (
    toolName === "prepare_investigation_query" ||
    toolName === "run_investigation_query"
  ) {
    const queryId = readQueryId(input);
    const query = fixture.investigationQueries.find(
      (candidate) => candidate.id === queryId,
    );
    return query
      ? { queryId: query.id, targetEntityId: query.targetEntityId }
      : null;
  }
  if (
    toolName !== "run_investigation_plan" ||
    typeof input.planId !== "string"
  ) {
    return null;
  }
  const plan = getInvestigationPlans(fixture).find(
    (candidate) => candidate.id === input.planId,
  );
  const query = plan?.queryIds
    .map((queryId) =>
      fixture.investigationQueries.find(
        (candidate) => candidate.id === queryId,
      ),
    )
    .find(
      (candidate) =>
        candidate !== undefined &&
        !state.attachedEnrichmentIds.includes(candidate.resultArtifactId),
    );
  return query
    ? { queryId: query.id, targetEntityId: query.targetEntityId }
    : null;
}

function readResponseInvestigationExecution(
  response: ToolApiResponse,
): { queryId: string; targetEntityId: string } | null {
  if (
    !response.result.ok ||
    response.result.data === null ||
    typeof response.result.data !== "object" ||
    Array.isArray(response.result.data)
  ) {
    return null;
  }
  const data = response.result.data as {
    queryId?: unknown;
    targetEntityId?: unknown;
  };
  return typeof data.queryId === "string" &&
    typeof data.targetEntityId === "string"
    ? { queryId: data.queryId, targetEntityId: data.targetEntityId }
    : null;
}

function readQueryId(input: Record<string, unknown>): string | null {
  return typeof input.queryId === "string" ? input.queryId : null;
}

function waitForOperation(
  toolName: CaseToolName,
  signal?: AbortSignal,
): Promise<void> {
  const duration = operationLatencyMs(toolName);
  if (duration === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Operation aborted.", "AbortError"));
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, duration);
    function abort() {
      window.clearTimeout(timer);
      reject(new DOMException("Operation aborted.", "AbortError"));
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function operationLatencyMs(toolName: CaseToolName): number {
  if (toolName === "prepare_investigation_query") return 700;
  if (toolName === "generate_case_report") return 1_200;
  if (toolName === "run_investigation_plan") return 1_300;
  if (toolName === "run_investigation_query") return 1_100;
  if (toolName === "request_next_observation") return 500;
  if (toolName === "attach_discovery_stage") return 650;
  if (toolName === "calculate_reachability") return 900;
  if (toolName === "prepare_response_bundle") return 750;
  if (
    toolName === "query_related_activity" ||
    toolName === "find_first_occurrence" ||
    toolName === "compare_timepoints" ||
    toolName === "search_events"
  ) {
    return 650;
  }
  if (toolName.startsWith("enrich_")) return 900;
  return 0;
}

function requireInitialEventId(fixture: CaseFixture): string {
  const eventId = fixture.primaryTraceEventIds[0] ?? fixture.events[0]?.id;
  if (!eventId) throw new Error(`Case ${fixture.id} has no selectable event.`);
  return eventId;
}

function getInitialSelection(fixture: CaseFixture): TraceSelection {
  return {
    kind: "event",
    id: requireInitialEventId(fixture),
  };
}

function withSharedViewContext(
  toolName: CaseToolName,
  result: ToolApiResponse["result"],
  selection: TraceSelection,
): ToolApiResponse["result"] {
  if (
    toolName !== "get_case_context" ||
    !result.ok ||
    result.data === null ||
    typeof result.data !== "object" ||
    Array.isArray(result.data)
  ) {
    return result;
  }
  return {
    ...result,
    data: {
      ...result.data,
      sharedView: {
        selection,
        meaning: "Current human or agent visual focus; not evidence state.",
      },
    },
  };
}

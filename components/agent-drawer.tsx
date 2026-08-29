"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import type { OperationReceipt } from "@/domain/types";
import type { ToolRegistrationOutcome } from "@/webmcp/tools";
import { useModalDialog } from "./use-modal-dialog";

interface AgentDrawerProps {
  open: boolean;
  definitions: WebMcpToolDefinition[];
  outcomes: ToolRegistrationOutcome[];
  receipts: OperationReceipt[];
  onClose: () => void;
}

export function AgentDrawer({
  open,
  definitions,
  outcomes,
  receipts,
  onClose,
}: AgentDrawerProps) {
  const [tab, setTab] = useState<"activity" | "capabilities">("activity");
  const dialogRef = useModalDialog(open, onClose);
  const activityTabRef = useRef<HTMLButtonElement>(null);
  const capabilitiesTabRef = useRef<HTMLButtonElement>(null);
  if (!open) return null;

  const outcomeByName = new Map(
    outcomes.map((outcome) => [outcome.name, outcome]),
  );
  const callbackCount = receipts.filter(
    (receipt) => receipt.reportedSurface === "webmcp_callback",
  ).length;
  const registeredCount = outcomes.filter(
    (outcome) => outcome.status === "registered",
  ).length;
  const authorizedResponses = receipts.filter(
    (receipt) =>
      receipt.toolName === "authorize_response_action" ||
      receipt.toolName === "authorize_response_bundle",
  ).length;

  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside
        aria-labelledby="agent-drawer-title"
        aria-modal="true"
        className="agent-drawer case-agent-drawer"
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
      >
        <div className="drawer-header">
          <div>
            <p className="eyebrow">Shared agent surface</p>
            <h2 id="agent-drawer-title">Investigative copilot</h2>
          </div>
          <button
            aria-label="Close copilot panel"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        <div className="drawer-tabs" role="tablist" aria-label="Copilot panel">
          <button
            aria-controls="agent-activity-panel"
            aria-selected={tab === "activity"}
            className={tab === "activity" ? "drawer-tab-active" : ""}
            id="agent-activity-tab"
            onClick={() => setTab("activity")}
            onKeyDown={(event) =>
              handleTabKey(event, "activity", setTab, {
                activity: activityTabRef.current,
                capabilities: capabilitiesTabRef.current,
              })
            }
            ref={activityTabRef}
            role="tab"
            tabIndex={tab === "activity" ? 0 : -1}
            type="button"
          >
            Activity <span>{receipts.length}</span>
          </button>
          <button
            aria-controls="agent-capabilities-panel"
            aria-selected={tab === "capabilities"}
            className={tab === "capabilities" ? "drawer-tab-active" : ""}
            id="agent-capabilities-tab"
            onClick={() => setTab("capabilities")}
            onKeyDown={(event) =>
              handleTabKey(event, "capabilities", setTab, {
                activity: activityTabRef.current,
                capabilities: capabilitiesTabRef.current,
              })
            }
            ref={capabilitiesTabRef}
            role="tab"
            tabIndex={tab === "capabilities" ? 0 : -1}
            type="button"
          >
            Capabilities
            <span>
              {registeredCount}/{definitions.length}
            </span>
          </button>
        </div>
        <p className="attribution-note">
          Every operation creates a revisioned record in the shared case
          history.
        </p>
        <div className="agent-execution-summary">
          <span>
            {registeredCount}/{definitions.length} capabilities registered
          </span>
          <span>{callbackCount} callback receipts</span>
          <span>{authorizedResponses} response approvals recorded</span>
          <strong>0 external controls executed</strong>
        </div>

        {tab === "activity" ? (
          <div
            aria-labelledby="agent-activity-tab"
            className="receipt-list"
            id="agent-activity-panel"
            role="tabpanel"
          >
            {receipts.length === 0 ? (
              <div className="drawer-empty-state">
                <strong>No operations recorded</strong>
                <p>
                  Analyst controls and WebMCP callbacks write receipts to this
                  shared case.
                </p>
              </div>
            ) : (
              [...receipts].reverse().map((receipt) => (
                <article
                  className={`receipt-row receipt-row-${receipt.reportedSurface} receipt-row-${receipt.status}`}
                  key={receipt.id}
                >
                  <div className="receipt-topline">
                    <span className="receipt-surface">
                      {receiptSurfaceLabel(receipt)}
                    </span>
                    <span>{receipt.id}</span>
                    <span>
                      r{receipt.baseRevision} → r{receipt.resultRevision}
                    </span>
                  </div>
                  <h3>{receipt.title}</h3>
                  <p>{receipt.resultSummary}</p>
                  <details>
                    <summary>Protocol details</summary>
                    <dl className="receipt-details">
                      <div>
                        <dt>Tool</dt>
                        <dd>
                          <code>{receipt.toolName}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Target</dt>
                        <dd>{receipt.target ?? "Case"}</dd>
                      </div>
                      <div>
                        <dt>Request</dt>
                        <dd>
                          <code>{receipt.requestId}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Attribution</dt>
                        <dd>Client-reported · unauthenticated attribution</dd>
                      </div>
                      <div>
                        <dt>Status</dt>
                        <dd>{receipt.status}</dd>
                      </div>
                    </dl>
                  </details>
                </article>
              ))
            )}
          </div>
        ) : (
          <div
            aria-labelledby="agent-capabilities-tab"
            className="capability-surface"
            id="agent-capabilities-panel"
            role="tabpanel"
          >
            <div className="capability-matrix">
              <article>
                <span>Can read</span>
                <strong>Evidence and relationships</strong>
                <small>Case events, entities, links, and activity</small>
              </article>
              <article>
                <span>Can investigate</span>
                <strong>Queries, discoveries, and response packages</strong>
                <small>
                  Shared state, revision guards, and auditable receipts
                </small>
              </article>
              <article>
                <span>Can model</span>
                <strong>Reachability and response effects</strong>
                <small>Modeled effects; no external execution</small>
              </article>
              <article className="capability-matrix-analyst">
                <span>Analyst only</span>
                <strong>Disposition, response, and closure</strong>
                <small>Not registered as agent capabilities</small>
              </article>
            </div>
            <details className="capability-catalog">
              <summary>
                Registered tool catalog
                <span>
                  {registeredCount}/{definitions.length}
                </span>
              </summary>
              <div className="capability-list">
                {definitions.map((tool) => {
                  const outcome = outcomeByName.get(tool.name);
                  return (
                    <article className="capability-row" key={tool.name}>
                      <span
                        className={`capability-state capability-state-${outcome?.status ?? "checking"}`}
                      />
                      <div>
                        <div className="capability-title-row">
                          <strong>{tool.title}</strong>
                          <span>
                            {tool.annotations.readOnlyHint
                              ? "Read"
                              : capabilityEffect(tool.name)}
                          </span>
                        </div>
                        <code>{tool.name}</code>
                        <p>{tool.description}</p>
                        {outcome?.error ? (
                          <p className="capability-error">{outcome.error}</p>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </details>
          </div>
        )}
      </aside>
    </div>
  );
}

function capabilityEffect(toolName: string): string {
  if (toolName.includes("simulate") || toolName === "calculate_reachability") {
    return "Simulate";
  }
  if (toolName.includes("request")) return "Request";
  if (toolName === "attach_discovery_stage") return "Attach";
  return "Prepare";
}

function receiptSurfaceLabel(receipt: OperationReceipt): string {
  if (receipt.toolName === "release_next_synthetic_signal") {
    return "Telemetry update";
  }
  return receipt.reportedSurface === "webmcp_callback"
    ? "WebMCP callback"
    : "Analyst control";
}

function handleTabKey(
  event: KeyboardEvent<HTMLButtonElement>,
  current: "activity" | "capabilities",
  setTab: (tab: "activity" | "capabilities") => void,
  refs: Record<"activity" | "capabilities", HTMLButtonElement | null>,
) {
  let next: "activity" | "capabilities" | null = null;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    next = current === "activity" ? "capabilities" : "activity";
  } else if (event.key === "Home") {
    next = "activity";
  } else if (event.key === "End") {
    next = "capabilities";
  }
  if (!next) return;
  event.preventDefault();
  setTab(next);
  refs[next]?.focus();
}

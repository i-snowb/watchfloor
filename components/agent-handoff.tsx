"use client";

import { useCallback, useState } from "react";
import { buildAgentHandoffPrompt } from "./agent-handoff-prompt";
import { getAgentHandoffPresentation } from "./agent-handoff-status";
import type { AgentStatus } from "./platform-shell";
import { useModalDialog } from "./use-modal-dialog";
import styles from "./agent-handoff.module.css";

export function AgentHandoff({
  agentStatus,
  caseId,
}: {
  agentStatus: AgentStatus;
  caseId: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const dialogRef = useModalDialog(open, close);
  const agentHandoffPrompt = buildAgentHandoffPrompt(caseId);
  const presentation = getAgentHandoffPresentation(agentStatus);

  const copyPrompt = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(agentHandoffPrompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  }, [agentHandoffPrompt]);

  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-label="Open agent handoff"
        className={styles.trigger}
        onClick={() => setOpen(true)}
        type="button"
      >
        Agent handoff
      </button>
      {open ? (
        <div className="drawer-backdrop" onMouseDown={close}>
          <section
            aria-labelledby="agent-handoff-title"
            aria-modal="true"
            className={styles.dialog}
            onMouseDown={(event) => event.stopPropagation()}
            ref={dialogRef}
            role="dialog"
          >
            <header className={styles.header}>
              <div>
                <p>
                  {presentation.ready
                    ? "Bounded investigation guidance"
                    : "Agent access status"}
                </p>
                <h2 id="agent-handoff-title">
                  {presentation.ready ? "Hand off to TRACE" : "Agent handoff"}
                </h2>
              </div>
              <button
                aria-label="Close agent handoff"
                className="icon-button"
                onClick={close}
                type="button"
              >
                ×
              </button>
            </header>

            <div className={styles.content}>
              <p className={styles.intro}>{presentation.detail}</p>
              {presentation.ready ? (
                <>
                  <ol className={styles.steps}>
                    <li>
                      <strong>Start from the current case state.</strong>
                      <span>
                        Review <code>{caseId}</code>. Use the case menu to reset
                        it only when you need a clean investigation run.
                      </span>
                    </li>
                    <li>
                      <strong>Hand the case to TRACE.</strong>
                      <span>
                        Ask it to inspect the registered tools and approved
                        skills, then investigate <code>{caseId}</code>.
                      </span>
                    </li>
                    <li>
                      <strong>Complete analyst gates yourself.</strong>
                      <span>
                        Review disposition, response, and report approvals
                        before allowing the case to advance.
                      </span>
                    </li>
                  </ol>

                  <div className={styles.prompt}>
                    <div>
                      <span>TRACE instruction</span>
                      <p>
                        Call <code>get_case_context</code> first. Follow only
                        its revision-bound <code>nextAgentAction</code>, inspect
                        raw records, and stop at <code>analystGate</code>.
                      </p>
                    </div>
                    <button onClick={() => void copyPrompt()} type="button">
                      {copied ? "Copied" : "Copy agent task"}
                    </button>
                  </div>
                </>
              ) : null}
            </div>

            <footer className={styles.footer}>
              <a
                href={presentation.ready ? "/agent-handoff.md" : "/start"}
                rel="noreferrer"
                target="_blank"
              >
                {presentation.ready
                  ? "Open detailed handoff"
                  : "Review agent access"}
              </a>
              <button onClick={close} type="button">
                Done
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}

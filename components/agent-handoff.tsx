"use client";

import { useCallback, useState } from "react";
import { useModalDialog } from "./use-modal-dialog";
import styles from "./agent-handoff.module.css";

function buildAgentHandoffPrompt(caseId: string): string {
  return `Inspect the registered page tools, then investigate ${caseId}.

Read the case context and list the approved investigation skills. Prepare and run one approved query at a time, show its exact KQL before execution, and inspect the raw returned records. Add verified discoveries only when their prerequisites are satisfied. Keep observed evidence, modeled impact, simulated controls, and approvals distinct. Pause at every analyst-only decision or authorization. Do not imply external execution.`;
}

export function AgentHandoff({ caseId }: { caseId: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const dialogRef = useModalDialog(open, close);
  const agentHandoffPrompt = buildAgentHandoffPrompt(caseId);

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
        aria-label="Open agent handoff runbook"
        className={styles.trigger}
        onClick={() => setOpen(true)}
        type="button"
      >
        Runbook
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
                <p>Operational guidance</p>
                <h2 id="agent-handoff-title">Agent handoff</h2>
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
              <p className={styles.intro}>
                Use page tools for bounded investigation work. Analyst decisions
                and authorizations remain manual.
              </p>
              <ol className={styles.steps}>
                <li>
                  <strong>Start from the current case state.</strong>
                  <span>
                    Review <code>{caseId}</code>. Use the case menu to reset it
                    only when you need a clean investigation run.
                  </span>
                </li>
                <li>
                  <strong>Hand the case to the connected agent.</strong>
                  <span>
                    Ask it to inspect the registered tools and approved skills,
                    then investigate <code>{caseId}</code>.
                  </span>
                </li>
                <li>
                  <strong>Complete analyst gates yourself.</strong>
                  <span>
                    Review disposition, response, and report approvals before
                    allowing the case to advance.
                  </span>
                </li>
              </ol>

              <div className={styles.prompt}>
                <div>
                  <span>Agent instruction</span>
                  <p>
                    List approved skills, run one bounded query at a time,
                    inspect raw records, and stop at analyst gates.
                  </p>
                </div>
                <button onClick={() => void copyPrompt()} type="button">
                  {copied ? "Copied" : "Copy instruction"}
                </button>
              </div>
            </div>

            <footer className={styles.footer}>
              <a href="/agent-handoff.md" rel="noreferrer" target="_blank">
                Open detailed handoff
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

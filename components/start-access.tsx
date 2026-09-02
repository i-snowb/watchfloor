"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { CaseFixture } from "@/domain/types";
import {
  registerCaseTools,
  type ToolRegistrationOutcome,
} from "@/webmcp/tools";
import { createAlertToolDefinitions } from "./queue-webmcp";
import { type AgentStatus } from "./platform-shell";
import {
  priorityCaseId,
  starterInstruction,
  starterSteps,
} from "./start-access-path";
import { getStartAccessPresentation } from "./start-access-status";
import styles from "./start-access.module.css";

export function StartAccess({
  fixtures,
}: {
  fixtures: readonly CaseFixture[];
}) {
  const router = useRouter();
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({
    state: "checking",
    count: 0,
  });
  const [copied, setCopied] = useState(false);
  const [outcomes, setOutcomes] = useState<ToolRegistrationOutcome[]>([]);
  const definitions = useMemo(
    () =>
      createAlertToolDefinitions(fixtures, (caseId) =>
        router.push(`/cases/${caseId}`),
      ),
    [fixtures, router],
  );
  const presentation = getStartAccessPresentation(agentStatus);

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
      setOutcomes(result.outcomes);
      if (!result.supported) {
        setAgentStatus({ state: "unavailable", count: 0 });
        return;
      }
      setAgentStatus({
        state:
          result.readiness.ready && result.registered === definitions.length
            ? "available"
            : "partial",
        count: result.registered,
        total: definitions.length,
        missingCriticalToolNames: result.readiness.missingCriticalToolNames,
      });
    }

    void register();
    return () => {
      active = false;
      controller.abort();
    };
  }, [definitions]);

  const registeredCount = outcomes.filter(
    (outcome) => outcome.status === "registered",
  ).length;

  async function copyStarterInstruction(): Promise<void> {
    try {
      await navigator.clipboard.writeText(starterInstruction);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link
          className={styles.brand}
          href="/alerts"
          aria-label="WATCH//FLOOR incident ledger"
        >
          <span>WATCH</span>
          <b>{"//"}</b>
          <span>FLOOR</span>
        </Link>
        <Link className={styles.ledgerLink} href="/alerts">
          Incident ledger <span aria-hidden="true">→</span>
        </Link>
      </header>

      <section className={styles.content} aria-labelledby="access-title">
        <div className={styles.intro}>
          <p className={styles.kicker}>Security operations access</p>
          <h1 id="access-title">
            Bring your own agent. The page decides what it is allowed to do.
          </h1>
          <p>
            WATCH//FLOOR keeps observed evidence, modeled impact, and analyst
            decisions in one visible case record. TRACE can operate only through
            the page tools registered in this browser.
          </p>
          <div className={styles.actions}>
            <button
              className={styles.primaryAction}
              onClick={() => router.push(`/cases/${priorityCaseId}`)}
              type="button"
            >
              Review priority case <span aria-hidden="true">→</span>
            </button>
            <Link className={styles.secondaryAction} href="/alerts">
              Open incident ledger
            </Link>
          </div>
          <section
            aria-labelledby="starter-path-title"
            className={styles.starterPath}
          >
            <div>
              <p className={styles.kicker}>60-second agent handoff</p>
              <h2 id="starter-path-title">One bounded evidence loop</h2>
            </div>
            <ol>
              {starterSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <button
              className={styles.copyInstruction}
              onClick={() => void copyStarterInstruction()}
              type="button"
            >
              {copied ? "Instruction copied" : "Copy starter instruction"}
            </button>
          </section>
        </div>

        <aside className={styles.accessCard} aria-live="polite">
          <div className={styles.cardHeader}>
            <p>Agent access</p>
            <span
              className={`${styles.statusDot} ${styles[`statusDot${capitalize(presentation.state)}`]}`}
            />
          </div>
          <strong>{presentation.label}</strong>
          <p>{presentation.detail}</p>
          <dl className={styles.boundaries}>
            <div>
              <dt>Page tools</dt>
              <dd>
                {agentStatus.state === "checking"
                  ? "Checking"
                  : `${registeredCount}/${definitions.length} registered`}
              </dd>
            </div>
            <div>
              <dt>Case tools</dt>
              <dd>Register when a workbench opens</dd>
            </div>
            <div>
              <dt>Analyst controls</dt>
              <dd>Evidence, response, and report decisions</dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className={styles.fallback} aria-labelledby="fallback-title">
        <div>
          <p className={styles.kicker}>Browser compatibility</p>
          <h2 id="fallback-title">Not seeing TRACE?</h2>
        </div>
        <p>
          Open this same address in ChatGPT’s browser to use registered WebMCP
          tools. In any browser, the incident ledger and case workbench remain
          available for analyst review. TRACE never approves disposition,
          response, or closure decisions.
        </p>
      </section>
    </main>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

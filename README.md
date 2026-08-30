# TRACE//LAB

TRACE//LAB is a deterministic WebMCP incident-response workbench for escalated Tier 2/3 operations. Tier 1 escalations enter a revisioned case where an analyst and a connected agent investigate evidence, model impact, authorize response, and close an evidence report.

The reference build runs on ChatGPT Sites. It does not connect to live security products, execute malware, submit hashes to external services, or change external controls.

Incoming implementation and test agents should read [HANDOFF.md](./HANDOFF.md) for the current state and [DEMO_TEST_HANDOVER.md](./DEMO_TEST_HANDOVER.md) for the repeatable endpoint rehearsal.

## What analysts can inspect

- Five Tier 1 escalations in the incident ledger.
- Two complete investigations and three evidence briefs.
- A primary endpoint case with observed execution, repeated egress, service-identity use, blocked remote service control, and a deployment-credential read.
- A visible KQL workspace. A connected agent prepares the canonical query through WebMCP, the page shows the query before execution, and exact returned records remain inspectable.
- Exact SHA-256 intelligence, enterprise prevalence, endpoint posture, Windows authentication, network, target-host prevention, cloud audit, and recovery inventory fixtures.
- An exposure model that keeps observed, correlated, modeled, simulated, prevented, and analyst-approved states distinct.
- Human-gated forensic collection, endpoint isolation, exact-IP blocking, identity disablement, credential rotation, and known-good image redeploy records.
- A deterministic evidence report with findings, limitations, residual risk, evidence references, response provenance, and a persisted analyst closure note.

The operation layer contains 35 case operations. The state-aware WebMCP surface registers 21 tools on the cloud case, 27 tools on the endpoint case, and two queue tools. The page never exposes the five analyst-only gates through WebMCP:

- `record_evidence_decision`
- `release_next_synthetic_signal`
- `authorize_response_action`
- `authorize_response_bundle`
- `approve_case_report`

## Run locally

Requirements: Node.js 22.13 or later and npm 11 or later.

```bash
npm ci
npm run dev
```

Open `http://localhost:3000/alerts`.

Release checks:

```bash
npm run check
```

With the local server running in another terminal:

```bash
npm run smoke
```

`npm run check` verifies formatting, lint, strict TypeScript, unit tests, the fixture-scoped WebMCP tool matrix, and the production build. `npm run smoke` executes both complete HTTP lifecycles, validates idempotency and stale-state rejection, confirms agent and analyst boundaries, checks exact report closure, and resets its anonymous session.

The HTTP smoke test does not prove native browser registration. Before submission, run the primary case twice from revision 1 in the signed-in ChatGPT Sites browser.

## Approved Investigation Skills

`list_investigation_skills` returns the case-scoped catalog of approved, versioned investigation playbooks. Each skill maps to one immutable bounded query contract and cannot be redirected to arbitrary telemetry, SQL, URLs, hosts, credentials, or external systems.

Use the following model for every skill:

1. List approved skills or read the skill catalog in `get_case_context`.
2. Select one available skill ID.
3. Call `prepare_investigation_query` with the corresponding `queryId`. The page loads the immutable KQL into the visible shared console, but does not retrieve evidence.
4. Inspect the displayed KQL and call `run_investigation_query` with the exact returned `queryText`.
5. Review the bounded raw records and attached finding before selecting the next skill.

Skill availability follows case state. A blocked skill remains unavailable until its prerequisite discovery or telemetry is present. Preparation is revision-safe; missing, changed, or stale query text fails closed. Skills prepare and run evidence collection only. They do not authorize analyst decisions, telemetry release, response, or report approval.

## Connected-agent operating prompt

Open `case-endpoint-0448`, then give the connected agent this instruction:

> Investigate this case through the page's registered tools. Start with `get_case_context`, then call `list_investigation_skills`. Prepare one available skill at a time, wait for its KQL to appear in the shared query workspace, then run the exact returned `queryText` and inspect the raw records. Continue one revision-changing tool call at a time. Stop before every analyst-only decision, telemetry release, response approval, and report approval. Never imply that a modeled or simulated action executed externally.

Do not paste full KQL into this README. `prepare_investigation_query` returns the versioned canonical text and loads it into the shared workspace. This keeps documentation, execution validation, and the filmed query identical.

For optional competition recording guidance, see [JUDGE_GUIDE.md](./JUDGE_GUIDE.md). The product does not present a guided demo path in the default workspace.

## Primary investigation contract

The endpoint case uses this sequence:

1. Open the compact escalation brief if Tier 1 context is needed.
2. Prepare a bounded query through the analyst control or WebMCP. This creates a shared case-state transition and loads its exact text and sources.
3. Run that exact prepared query. Direct execution and plan execution both reject missing, mismatched, or stale preparation; modified or unknown query text also fails closed.
4. Inspect returned source records. The result attaches to the map and activity timeline.
5. After its cited query evidence is attached, let the connected agent call `attach_discovery_stage` to add only the next provenance-backed entities and observations. The analyst replay control remains an alternate path and is not exposed through WebMCP.
6. Record the analyst disposition.
7. Let the connected agent calculate exposure and simulate the allowlisted control.
8. Let the connected agent prepare response packages. The analyst approves them.
9. Let the connected agent draft the evidence report. The analyst reviews its cited findings and response record, writes a closure note, and signs off. The agent cannot approve its own report.

The exact file hash is `65fb21f3b3b11f7a7d45f31965dad35935e6d9c860ca6f618999510db74260b9` everywhere it appears. Its intelligence result is an archived deterministic fixture, not live OSINT. `QRY-ENDPOINT-STATIC-08` and `QRY-ENDPOINT-SANDBOX-09` are optional supporting pivots. The latter reviews an archived sandbox behavior record; it does not detonate a sample.

## Architecture and trust boundary

The stack is intentionally narrow: React, Vinext, Vite, Cloudflare Workers, and D1.

- [`domain/scenarios`](./domain/scenarios) contains immutable versioned fixtures and build-time validation.
- [`domain/query-console.ts`](./domain/query-console.ts) owns canonical query text.
- [`domain/operations.ts`](./domain/operations.ts) owns validation, state gates, deterministic results, and revision policy.
- [`domain/case-state.ts`](./domain/case-state.ts) validates persisted state and report provenance.
- [`server/case-store.ts`](./server/case-store.ts) owns D1 state, optimistic updates, idempotency, receipts, and reset.
- [`webmcp/tools.ts`](./webmcp/tools.ts) defines and registers the semantic WebMCP surface.
- [`components/evidence-map.tsx`](./components/evidence-map.tsx) renders the shared incident path and exposure map.

The current Sites deployment is owner-only behind ChatGPT sign-in. Inside the application, an anonymous session cookie isolates resettable state. That cookie is not an identity, tenant, or production authorization boundary. The HTTP API records a client-reported surface and is workflow mediation, not authenticated authorization. No production integration should rely on this boundary.

All inputs are allowlisted and bounded. Writes require the current revision and an idempotent request ID. The operation surface does not accept SQL, URLs, shell commands, credentials, secret values, source code, or arbitrary external targets. Every response approval records `externalExecution: false`.

## Optional recording and submission gates

Before filming or sharing:

1. Deploy the exact commit that passed `npm run check` and `npm run smoke`.
2. Verify native tool registration and one read plus one write callback on the hosted endpoint case.
3. Rehearse the complete hosted endpoint path twice from revision 1.
4. Verify public judge access from a signed-out browser or add the exact judge viewers.
5. Reset the presentation session and record from the canonical initial state.

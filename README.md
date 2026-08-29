# TRACE//LAB

TRACE//LAB is a deterministic WebMCP incident-response workbench. A Tier 1 AI escalates bounded synthetic cases. A security analyst and a page-connected copilot then use the same revisioned evidence state to investigate, model impact, approve response, and close an evidence report.

The competition build runs on ChatGPT Sites. It does not connect to live security products, execute malware, submit hashes to external services, or change external controls.

## What judges can inspect

- Five Tier 1 escalations in the incident ledger.
- Two complete investigations and three evidence briefs.
- A primary endpoint case with observed execution, repeated egress, service-identity use, blocked remote service control, and a deployment-credential read.
- A visible KQL workspace. The copilot prepares the canonical query through WebMCP, the page shows the query before execution, and exact returned records remain inspectable.
- Exact SHA-256 intelligence, enterprise prevalence, endpoint posture, Windows authentication, network, target-host prevention, cloud audit, and recovery inventory fixtures.
- An exposure model that keeps observed, correlated, modeled, simulated, prevented, and analyst-approved states distinct.
- Human-gated forensic collection, endpoint isolation, exact-IP blocking, identity disablement, credential rotation, and known-good image redeploy records.
- A deterministic evidence report with findings, limitations, residual risk, evidence references, response provenance, and a persisted analyst closure note.

The WebMCP surface contains 33 internal case operations, 19 tools on the cloud case, 26 tools on the endpoint case, and two queue tools. The page never exposes the five analyst-only gates through WebMCP:

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

## Recommended judge prompt

Open `case-endpoint-0448`, then give the connected copilot this instruction:

> Investigate this synthetic escalation through the page's registered tools. Start with `get_case_context`. Prepare `QRY-ENDPOINT-FILE-01`, wait for the KQL to appear in the shared query workspace, then run the exact returned `queryText` and show the raw records. Prepare and run `QRY-ENDPOINT-HASH-10` next. Continue one revision-changing tool at a time. Stop before every analyst-only decision, telemetry release, response approval, and report approval. Never imply that a simulated action executed externally.

Do not paste full KQL into this README. `prepare_investigation_query` returns the versioned canonical text and loads it into the shared workspace. This keeps documentation, execution validation, and the filmed query identical.

See [JUDGE_GUIDE.md](./JUDGE_GUIDE.md) for the 90-second hands-on path, three-minute filming sequence, expected checkpoints, and stop conditions.

## Primary investigation contract

The endpoint case uses this sequence:

1. Read the Tier 1 handoff and current revision.
2. Prepare a bounded query through the analyst control or WebMCP. This creates a shared case-state transition and loads its exact text and sources.
3. Run that exact prepared query. Direct execution and plan execution both reject missing, mismatched, or stale preparation; modified or unknown query text also fails closed.
4. Inspect returned source records. The result attaches to the map and activity timeline.
5. Release a fixed later observation only through the analyst control.
6. Record the analyst disposition.
7. Let the copilot calculate exposure and simulate the allowlisted control.
8. Let the copilot prepare response packages. The analyst approves them.
9. Let the copilot draft the evidence report. The analyst reviews its cited findings and response record, writes a closure note, and signs off. The copilot cannot approve its own report.

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

The public build uses an anonymous session cookie for resettable state. That cookie is not an identity, tenant, or authorization boundary. The HTTP API records a client-reported surface and is workflow mediation, not authenticated authorization. No production integration should rely on this demo boundary.

All inputs are allowlisted and bounded. Writes require the current revision and an idempotent request ID. The operation surface does not accept SQL, URLs, shell commands, credentials, secret values, source code, or arbitrary external targets. Every response approval records `externalExecution: false`.

## Submission gates

Before filming or sharing:

1. Deploy the exact commit that passed `npm run check` and `npm run smoke`.
2. Verify native tool registration and one read plus one write callback on the hosted endpoint case.
3. Rehearse the complete hosted endpoint path twice from revision 1.
4. Verify public judge access from a signed-out browser or add the exact judge viewers.
5. Reset the presentation session and record from the canonical initial state.

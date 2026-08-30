# TRACE//LAB Agent Handoff

## Snapshot

- Runtime repository: `demo/`
- Stable runtime commit: `5061911` (`Add evidence-bound threat hierarchy`)
- Deployed artifact: ChatGPT Sites version 16 at [tracelab-webmcp.keegansnowbarger.chatgpt.site](https://tracelab-webmcp.keegansnowbarger.chatgpt.site)
- Deployment access: owner-only through ChatGPT sign-in. Judge access is not configured.
- Working tree was clean after the runtime commit. Documentation-only handoff changes can follow it without changing the deployed artifact.

## Product and competition thesis

TRACE//LAB is a deterministic, synthetic incident-response workbench for a security analyst and a page-connected copilot. It is not chat over alerts and it is not browser-click automation. The page exposes bounded security operations through WebMCP. The analyst and copilot operate the same revisioned case, visible query workspace, incident graph, timeline, response record, and evidence report.

The competition proof is the shared loop: the copilot discovers semantic page tools, prepares visible KQL, runs bounded queries, attaches exact source records, adds only the next provenance-backed discovery, expands the graph, models exposure, prepares response packages, and drafts the report. The analyst owns evidence disposition, the manual replay control, consequential approvals, and final report sign-off. WebMCP leverage is the primary differentiator; do not hide it behind a generic chat panel.

The build is intentionally a polished deterministic demonstration. It does not ingest live telemetry, upload or execute malware, contact an intelligence provider, or execute an external response action.

## Product surfaces

- `/alerts`: five Tier 1 AI escalations. Two are complete investigations; three are evidence briefs that establish breadth.
- `/cases/case-endpoint-0448`: primary three-minute case. It proves query preparation, raw records, staged evidence, exposure modeling, containment, recovery, report generation, and analyst closure.
- `/cases/case-cloud-0421`: complete secondary case. Jordan Doe's export is ultimately authorized for the object and time window, but `prod-admin` remains a least-privilege policy exception.
- Shared workbench: observed-activity graph, potential-impact graph, P1-P5 issue rail, entity inspector, visible KQL console, returned-record drawers, incident timeline, response approvals, and evidence-report review.

## Endpoint evidence truth

Do not change these statements without changing the fixtures and tests:

- `FIN-WS-044` is the only confirmed compromised host.
- `svc-fin-reports` misuse and the read of `ci/deploy/production` are observed.
- `APP-SRV-021` received authentication and blocked a remote service-start attempt before payload execution. It is not compromised.
- `billing-api` is modeled reachable after exposure analysis. No malicious deployment was observed.
- The exact file SHA-256 is `65fb21f3b3b11f7a7d45f31965dad35935e6d9c860ca6f618999510db74260b9` everywhere.
- Hash intelligence, static analysis, and sandbox behavior are archived deterministic fixtures. No external provider is contacted.
- Response records always state `externalExecution: false`.
- Historical observations remain visible after approval. A compromised host becomes `Confirmed compromised host · Isolation approved`; the original evidence is not rewritten.

## Primary investigation path

1. Copilot calls `get_case_context`.
2. Copilot prepares `QRY-ENDPOINT-FILE-01`; canonical KQL becomes visible.
3. Copilot executes the exact prepared text and exposes raw source records.
4. Copilot prepares and runs `QRY-ENDPOINT-HASH-10`, then the required host, identity, and egress queries.
5. Copilot attaches the ready `STREAM-LAT-01` discovery through `attach_discovery_stage`, then runs `QRY-ENDPOINT-APP-05`.
6. Analyst records `confirmed_malicious`.
7. Copilot calls `calculate_reachability`; the potential-impact view gains the bounded priority route.
8. Copilot simulates the allowlisted control and prepares containment. Analyst approves the bundle.
9. Copilot attaches the ready `STREAM-LAT-02` discovery, attaches secret and workload results, and prepares recovery. Analyst approves it.
10. Copilot generates the evidence report. Analyst reviews citations, enters a closure note, and approves closure.

Use [DEMO_TEST_HANDOVER.md](./DEMO_TEST_HANDOVER.md) for the complete reset-to-closure test contract. Use [JUDGE_GUIDE.md](./JUDGE_GUIDE.md) for the timed recording sequence and stop conditions.

## Graph behavior

- The issue rail ranks the endpoint case as P1 `FIN-WS-044`, P2 `svc-fin-reports`, P3 `ci/deploy/production`, P4 `APP-SRV-021`, and P5 `billing-api`.
- Selecting an issue focuses its entity. Selecting the priority route focuses the complete bounded chain.
- Red directional route animation appears only in the potential-impact view after reachability is attached. It is a modeled path, not proof of additional infection.
- The blocked `APP-SRV-021` branch uses a prevention marker.
- Approved isolation, identity disablement, and credential rotation turn applicable route segments green and visually sever them.
- The graph, inspector, query results, and timeline use the same case revision. Copilot discoveries can add entities, joins, findings, and timeline records.

## WebMCP and trust boundary

- Registration uses `document.modelContext.registerTool`.
- Queue surface: two tools.
- Cloud case: 20 state-aware WebMCP tools.
- Endpoint case: 26 state-aware WebMCP tools.
- Domain operation layer: 34 case operations.
- Analyst-only operations are `record_evidence_decision`, `release_next_synthetic_signal`, `authorize_response_action`, `authorize_response_bundle`, and `approve_case_report`. The copilot can instead call `attach_discovery_stage`, but only for the next ready stage after its fixture-defined query evidence is attached.
- Query execution fails closed unless the same query was prepared at the current revision and the submitted text exactly matches the canonical fixture.
- Mutations require the expected revision and an idempotent request ID. Inputs are allowlisted and bounded.
- The Sites sign-in gate controls access to the current deployment. Inside the application, the anonymous session cookie isolates resettable state but is not an identity, tenant, or production authorization boundary.

## Architecture map

- `domain/scenarios/`: immutable versioned fixtures and build-time referential validation.
- `domain/query-console.ts`: canonical KQL contracts.
- `domain/operations.ts`: operation validation, state gates, deterministic results, and revision policy.
- `domain/case-state.ts`: persisted-state and report-provenance validation.
- `server/case-store.ts`: D1 state, optimistic updates, idempotency, receipts, and reset.
- `webmcp/tools.ts`: route-aware WebMCP definitions and registration.
- `components/evidence-map.tsx`: issue hierarchy, incident path, exposure model, and controlled-route rendering.
- `components/query-console.tsx` and `components/query-returned-records.tsx`: visible query preparation and auditable records.
- `components/case-report-panel.tsx`: report review, closure note, and analyst sign-off.

## Verification evidence

- `npm run check` passed formatting, ESLint, strict TypeScript, 63 tests, the WebMCP tool matrix, and the production build.
- `npm run smoke` passed both deterministic HTTP lifecycles, idempotency, stale-state rejection, forged-envelope rejection, WebMCP/analyst boundaries, exact report closure, and reset.
- Local native WebMCP registration exposed 26 endpoint tools. A complete browser rehearsal advanced the endpoint case from revision 1 to revision 26 through queries, discovery, reachability, containment, recovery, and approval gates.
- Sites version 16 deployed successfully from commit `5061911`.
- The production ChatGPT sign-in boundary was verified. A complete signed-in hosted native-callback rehearsal remains open.

## Next agent: hardened testing brief

Start with testing, not redesign. Reset the hosted endpoint case to revision 1 and run it twice through native WebMCP. Record failures with the case revision, tool name, request ID, visible state, and expected state.

Release acceptance criteria:

1. Two queue tools and 26 endpoint tools register after navigation and reset.
2. Every prepared query appears before execution; modified, missing, or stale text is rejected.
3. Raw records remain available and map/timeline updates share the returned revision.
4. Future evidence cannot appear before its fixture-defined query and enrichment prerequisites. The analyst replay control remains unavailable to WebMCP.
5. The issue rail and red modeled route appear at the correct stages; containment changes route state without erasing historical facts.
6. The copilot cannot cross any of the five analyst-only gates.
7. Report citations, response provenance, limitations, closure note, and final status persist after refresh.
8. The complete endpoint path succeeds twice without duplicate receipts, clipped controls, lost tools, or stale state.
9. Reduced-motion, keyboard, narrow-screen, and common desktop viewport behavior remain usable.
10. Before submission, configure judge access, publish the selected source with an MIT license, and verify the public repository contains the actual registration code.

The long-form original design predates several implementation decisions and is not in this Git repository. Treat this handoff, [README.md](./README.md), [JUDGE_GUIDE.md](./JUDGE_GUIDE.md), the current fixtures, and the tests as the runtime source of truth.

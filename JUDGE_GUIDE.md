# WATCH//FLOOR Evaluator Guide

Start at the [case queue](https://watchfloor-sandbox.watchfloor-webmcp.workers.dev/alerts). No sign-in is required for the public sandbox. `/alerts` is the normal product entry; `/start` is optional evaluator access, not a guided product path. The [endpoint case](https://watchfloor-sandbox.watchfloor-webmcp.workers.dev/cases/case-endpoint-0448) is the primary investigation after queue review.

## Authoritative evaluation flow

1. The analyst prompts TRACE; TRACE does not self-start. From `/alerts`, it first calls `list_case_queue`. The analyst opens the endpoint case. TRACE waits for the case route to report its ready tool surface, then inspects the registered case tools and calls `get_case_context`.
2. Follow only `nextAgentAction` and its returned input. Do not invent identifiers or revisions.
3. For each query, ensure TRACE prepares the canonical KQL in the shared workspace, then executes the exact prepared text and exposes returned records.
4. Select a released event, entity, relationship, attached discovery, or report finding and use `trace_evidence_lineage` to inspect the exact supporting provenance.
5. Let TRACE advance only when the returned handoff permits it.
6. At an `analystGate`, stop TRACE. The analyst records disposition, releases the later observation, authorizes response packages, and approves the final report.
7. Confirm the final report retains evidence references, limitations, closure note, approval receipt, and recorded-only response semantics.

Use this connected-agent instruction:

> Wait for an analyst prompt; do not self-start. From `/alerts`, call `list_case_queue`. After the analyst opens this case, wait until the case route reports its tool surface ready. Then inspect the registered page tools and call `get_case_context`. Follow only the returned `nextAgentAction` and its supplied input. Stop at `analystGate`. Do not invent IDs or revisions. Keep observed evidence, modeled impact, simulated controls, and approvals distinct. Do not imply external execution.

## Three hero moments

1. **Bounded query and raw evidence.** Follow the first returned action to prepare `QRY-ENDPOINT-FILE-01`, show its canonical KQL, run only that exact text, and inspect its returned fixture records.
2. **Evidence growth and analyst stop.** Continue the returned investigation actions through `QRY-ENDPOINT-IDENTITY-03`. Its bounded result makes the service identity visible and moves the graph from 3 entities / 4 events / 2 joins to 4 / 5 / 2. Attaching `STREAM-LAT-01` then expands the observed and prevented investigation to 7 / 11 / 7. When `analystGate.kind` becomes `evidence_disposition`, TRACE has no next action and must stop for the analyst.
3. **Approved modeled control and signed report.** After the analyst confirms disposition, let TRACE calculate reachability, simulate the allowed controls, and prepare the recorded containment package. The analyst authorizes it; show the severed modeled paths and the explicit no-external-execution record. Complete the later analyst telemetry release and recovery package, draft the evidence report, add the closure note, and show analyst report approval.

## What to verify

- Both case routes have the same 24-tool platform manifest. Registration is
  case-scoped but does not disclose which capabilities later evidence will use.
- The connected agent operates the visible shared workbench; it is not browser-click automation.
- The five analyst-only operations are absent from WebMCP and rejected on the callback route.
- Prepared query text, raw records, discoveries, graph state, timeline, receipts,
  and released evidence lineage remain revision-consistent.
- `APP-SRV-021` is a prevented remote service-start attempt, not a compromised host. `billing-api` is modeled reach, not observed compromise.
- Response approvals are recorded only; no external control is executed.

## Endpoint evidence visibility

The endpoint graph grows only as evidence is attached or released. Counts are
visible entities, observed events, and evidence joins.

| Investigation point                                     | Entities | Events | Joins |
| ------------------------------------------------------- | -------: | -----: | ----: |
| Fresh Tier 1 case                                       |        3 |      4 |     2 |
| Identity evidence attached                              |        4 |      5 |     2 |
| Stage 1 released                                        |        7 |     11 |     7 |
| Final, after reachability and analyst telemetry release |        8 |     13 |     8 |

Stage 1 reveals `APP-SRV-021`, the expected service host, and observed
credential-read topology. `APP-SRV-021` remains prevented. `billing-api` is
modeled-only until reachability is attached; it is not observed compromise.
Approved query targets may be known but not visible. An approved query can
attach its bounded identity evidence; it does not release stage-gated
telemetry, entities, or relationships.

## Public-sandbox limitation

The anonymous visitor can use analyst controls in this sandbox. This demonstrates workflow separation from WebMCP, not authenticated analyst identity. Production use requires verified identity and authorization for the analyst-control channel.

## Source facts and hosted verification

The full endpoint lifecycle ends at `r29`. Source verification covers the
complete test suite and production build. The final release procedure also checks the public
sandbox profile and refuses to deploy a source revision that is dirty, absent
from the declared remote, or different from the release metadata.

Treat [`/api/release`](https://watchfloor-sandbox.watchfloor-webmcp.workers.dev/api/release)
as the authoritative deployed source identity. Final hosted verification covers
both HTTP lifecycles, native queue/endpoint/cloud WebMCP registration, a fresh
endpoint context read, anonymous routes, browser security headers, and the
1280×720 recording layout. The source is public at
[github.com/i-snowb/watchfloor](https://github.com/i-snowb/watchfloor); the
public video URL will be added to the repository when it is published.

For local verification:

```bash
npm run check
npm run smoke
```

# WATCH//FLOOR Acceptance Handover

## Verified release facts

- Release identity: read
  `https://watchfloor-sandbox.watchfloor-webmcp.workers.dev/api/release` before
  a recording or submission and require it to name the reviewed public commit
- WebMCP: case-scoped registrations — endpoint case 24 tools; cloud case 18 tools
- Complete endpoint lifecycle ends at `r29`
- Current source verification passes **175 tests** across **8,569 test lines in
  29 files**.
- Default route: `/alerts`; `/start` is optional
- Historical hosted native WebMCP lifecycle (2026-09-01): passed from `r14` through analyst telemetry
  release, recovery authorization, and analyst-approved report closure at
  `r29`.
- Direct attach before release was rejected at `r19` with
  `TELEMETRY_RELEASE_REQUIRED`; repeated pending-gate bypass was rejected at
  `r20`; both left revision unchanged.
- Historical hosted HTTP smoke passed. `/alerts`, `/start`, and cloud had zero browser
  errors; cloud `get_case_context` passed.
- Historical evidence-lineage verification: public hosted smoke passed HTTP
  lineage and trusted-receipt assertions, then reset the case. Native page
  registration included `trace_evidence_lineage`; at 1280×720 initial entity
  lineage opened in the existing z-index-60 scroll-contained drawer. The
  browser was left at `r1`, with no selection and the drawer closed.

## Acceptance procedure

1. The analyst prompts TRACE. From `/alerts`, TRACE starts with `list_case_queue`; after the analyst opens `/cases/case-endpoint-0448`, wait for the case tool surface to report ready before starting case work with `get_case_context`.
2. Reset only when a clean case is required; confirm revision 1 and no receipts.
3. In a WebMCP-capable browser, verify registered tools after the analyst has opened the case.
4. Follow only revision-bound `nextAgentAction` input. For every query, verify the visible prepared KQL before executing exact text and inspect returned records.
5. Verify TRACE stops at analyst gates. The analyst records disposition, releases the later observation, authorizes response packages, and approves the report.
6. Complete the path to `r29`. Verify the final report includes cited evidence, limitations, recorded response provenance, closure note, approval receipt, and `externalExecution: false` semantics.
7. Invoke `trace_evidence_lineage` for a released event and a report finding.
   Verify exact supported provenance and no case revision change. Verify unknown
   and unreleased targets fail closed.

## Required boundary checks

- WebMCP registration does not expose the five analyst-only operations.
- A callback attempt to invoke an analyst-only operation is rejected without a state change.
- Modified, stale, or unprepared query text is rejected.
- Duplicate request identities replay only the matching operation result.
- Observed, modeled, simulated, prevented, and approved states remain visually and semantically distinct.
- Untrusted evidence is shown as data and never authorizes an operation.

## Runnable checks

```bash
npm run check
npm run smoke
```

The smoke command requires the local server in another terminal. It is not a substitute for native hosted browser registration.

## Release blanks

Record public repository and video values in [SUBMISSION.md](./SUBMISSION.md)
only after they are externally reachable. Do not infer them from Worker
metadata.

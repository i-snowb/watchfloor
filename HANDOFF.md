# WATCH//FLOOR Handoff

## Current release state

- Public release metadata: `https://watchfloor-sandbox.watchfloor-webmcp.workers.dev/api/release`
- Public URL: `https://watchfloor-sandbox.watchfloor-webmcp.workers.dev`
- Release identity is authoritative only when `/api/release` names the reviewed
  public commit. Re-query it before a recording or submission.
- Default entry: `/alerts`; optional evaluator entry: `/start`
- Tool coverage: case-scoped registrations — 24 endpoint tools and 18 cloud tools
- Endpoint complete lifecycle: `r29`
- Current source verification passes **175 tests** across **8,569 test lines in
  29 files**.
- Historical hosted native WebMCP proof (2026-09-01): passed from `r14` through analyst telemetry
  release, recovery authorization, and analyst-approved report closure at
  `r29`.
- Direct attach before release was rejected at `r19` with
  `TELEMETRY_RELEASE_REQUIRED`; repeated pending-gate bypass was rejected at
  `r20`; both left revision unchanged.
- Historical hosted smoke passed. `/alerts`, `/start`, and cloud had zero browser errors;
  cloud `get_case_context` passed.
- Historical lineage proof: public hosted smoke passed HTTP lineage and
  trusted-receipt assertions and reset the case. At 1280×720, native page
  registration included `trace_evidence_lineage`, and initial entity lineage
  opened in the existing z-index-60 scroll-contained drawer. The browser was
  left at `r1`, with no selection and the drawer closed.
- Repeat hosted smoke, native WebMCP, signed-out access, and browser checks after
  each source-identified deployment.
- Remaining submission artifacts: public repository and public video until
  their verified URLs are recorded in [SUBMISSION.md](./SUBMISSION.md).

## Product truth

TRACE works only through registered WebMCP tools. It can investigate bounded evidence, trace released evidence lineage, run exact approved queries, attach ready discoveries, model impact, simulate controls, prepare response packages, and draft reports. It cannot record evidence disposition, release the later observation, approve a response, or approve a report.

Evidence lineage is read-only and accepts only a released visible target. It
returns the supporting approved skill, canonical KQL, bounded fixture records,
trusted receipt references, report consumers, and limitations. It never accepts
caller-supplied KQL or changes the case.

The public Worker is an anonymous sandbox with isolated browser sessions and deterministic data. It has no production integrations or external execution. Public analyst controls are intentionally available to the visitor, so they are not authentication proof. The callback route still rejects every analyst-only operation. Private deployment requires verified identity and authorization for analyst controls.

## One evaluator path

1. The analyst prompts TRACE. From `/alerts`, TRACE first calls `list_case_queue`; after the analyst opens `/cases/case-endpoint-0448`, TRACE waits for the case tool surface to be ready and then calls `get_case_context`.
2. Follow only returned `nextAgentAction` input.
3. Confirm visible canonical KQL and source records before each evidence transition.
4. At an `analystGate`, have the analyst perform the decision, release, approval, or sign-off.
5. Confirm the report carries evidence references, limitations, response provenance, closure note, and approval receipt.

Use [JUDGE_GUIDE.md](./JUDGE_GUIDE.md) for the evaluator flow and [DEMO_TEST_HANDOVER.md](./DEMO_TEST_HANDOVER.md) for acceptance evidence. Use [SUBMISSION.md](./SUBMISSION.md) only to fill verified public release values.

## Commands

```bash
npm ci
npm run check
npm run smoke
```

Run `npm run smoke` with the local server running. Re-run hosted verification
after any new Cloudflare deployment because release metadata and browser state
can change.

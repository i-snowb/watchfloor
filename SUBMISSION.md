# WATCH//FLOOR Submission Record

Fill only verified values.

## Live release

- Live URL: `https://watchfloor-sandbox.watchfloor-webmcp.workers.dev`
- Primary case: `https://watchfloor-sandbox.watchfloor-webmcp.workers.dev/cases/case-endpoint-0448`
- Worker version: read the live release metadata at submission time; do not
  copy a historical deployment-specific value.
- Worker release metadata: `https://watchfloor-sandbox.watchfloor-webmcp.workers.dev/api/release`
- Public remote/source identity: `<NOT_PUBLISHED>`
- Public repository URL: `<NOT_PUBLISHED>`
- Public video URL: `<NOT_PUBLISHED>`
- Final commit: `<NOT_PUBLISHED>`

Before the final public deployment, set only verified public metadata and use
the guarded deploy command:

```bash
export WATCHFLOOR_SOURCE_REPOSITORY="https://github.com/OWNER/REPOSITORY"
export WATCHFLOOR_RELEASE_ID="watchfloor-$(git rev-parse --short=12 HEAD)"
npm run cloudflare:deploy-public
```

This command derives the source commit from `HEAD` and fails if an explicitly
supplied commit differs, the worktree is dirty, a configured remote does not
match the declared public repository, or `HEAD` is absent from that remote's
tracking branches. It passes the values and the fixed anonymous-sandbox mode
through explicit non-secret Worker variables with Wrangler strict mode. After
deploy, read `/api/release` and copy its verified values into this record.
In a signed-out private browser window, verify that `/alerts` and the primary
case URL load without a pre-existing session or identity.

## Access and limitations

- Access: public anonymous sandbox; no sign-in required.
- Session model: isolated browser session with deterministic fixtures.
- Analyst controls: available to the sandbox visitor for workflow evaluation, but not evidence of authenticated analyst identity.
- WebMCP: cannot invoke the five analyst-only operations.
- External execution: none; all recorded response actions state `externalExecution: false`.

## Release evidence

- 24 endpoint tools; 18 cloud tools (case-scoped registrations)
- Complete endpoint lifecycle through `r29`
- Current source verification passes **175 tests** across **8,569 test lines in
  29 files**.
- Released evidence lineage is available through a read-only WebMCP tool and
  the existing evidence drawer; it exposes bounded skill, KQL, record, receipt,
  report-consumer, and limitation provenance.
- Historical hosted WebMCP lifecycle verification on 2026-09-01 passed from `r14` through analyst telemetry
  release, recovery authorization, and analyst-approved report closure at
  `r29`.
- Direct attach before release was rejected at `r19` with
  `TELEMETRY_RELEASE_REQUIRED`; repeated pending-gate bypass was rejected at
  `r20`; both left revision unchanged.
- Historical hosted HTTP smoke passed. `/alerts`, `/start`, and cloud had zero browser
  errors; cloud `get_case_context` passed.
- Historical hosted evidence-lineage proof: public `npm run smoke` passed
  its HTTP lineage and trusted-receipt assertions and reset the case. At
  1280×720, native page registration included `trace_evidence_lineage`; initial
  entity lineage opened in the existing scroll-contained drawer. The browser
  was left at `r1`, with no selection and the drawer closed.

## Final checks

- [ ] `npm run check` passed on the submitted commit.
- [ ] `npm run smoke` passed against the submitted local build.
- [ ] Native hosted WebMCP endpoint lifecycle repeated against the submitted
      source-identified deployment, including the full analyst-gated path.
- [x] Historical native hosted WebMCP endpoint lifecycle passed from `r14` to `r29`,
      including analyst telemetry release, recovery authorization, and report
      closure.
- [x] Direct and pending-gate attach bypass attempts were rejected at `r19` and
      `r20` without revision changes.
- [ ] Hosted HTTP smoke and browser route checks repeated against the submitted
      source-identified deployment.
- [x] Historical hosted HTTP smoke passed; checked `/alerts`, `/start`, and cloud routes
      had zero browser errors; cloud `get_case_context` passed.
- [x] Hosted HTTP lineage/receipt assertions passed; native registration and
      the contained existing-drawer lineage UI passed at 1280×720.
- [ ] Public source identity and repository URL are published and verified.
- [ ] Public narrated video is published and verified.

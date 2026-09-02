# WATCH//FLOOR

WATCH//FLOOR is an analyst-first incident-response workbench. TRACE uses registered WebMCP page tools to inspect bounded case evidence, trace released evidence lineage, prepare and run approved queries, attach provenance-backed discoveries, model impact, prepare recorded response packages, and draft a report. The analyst owns disposition, later-observation release, response approval, and final report approval.

The public deployment is an anonymous sandbox with deterministic fixtures. It does not contact security products, execute malware, retrieve live intelligence, or execute external controls. Recorded response actions always state `externalExecution: false`.

## Start and verify

Requirements: Node.js 22.13+ and npm with lockfile v3 support. The current release checks use npm 11.

```bash
npm ci
npm run dev
```

Open `http://localhost:3000/alerts`. `/alerts` is the default product entry; `/start` is optional evaluator access.

```bash
npm run check
```

With the local server running in another terminal:

```bash
npm run smoke
```

`npm run check` runs formatting, lint, strict TypeScript, tests, WebMCP matrix checks, and the production build. `npm run smoke` exercises the two complete HTTP lifecycles and boundary, idempotency, stale-state, and report-closure checks.

## Evaluator flow

Use the endpoint case at `/cases/case-endpoint-0448`.

1. The analyst prompts TRACE; it does not self-start. From `/alerts`, TRACE calls `list_case_queue`. After the analyst opens the endpoint case, TRACE waits for the case tool surface to report ready, then inspects registered tools and calls `get_case_context`.
2. Follow only each returned `nextAgentAction` and its supplied input.
3. Inspect visible canonical KQL and returned records before proceeding.
4. Stop at each `analystGate`; the analyst performs the required decision, release, approval, or report sign-off.
5. Keep observed evidence, modeled impact, simulated controls, and recorded approvals distinct. Do not imply external execution.

The authoritative evaluator procedure is [JUDGE_GUIDE.md](./JUDGE_GUIDE.md). The canonical connected-agent prompt is [public/agent-handoff.md](./public/agent-handoff.md).

## WebMCP and authority boundary

WebMCP registration is case-scoped: the endpoint case registers 24 tools and
the cloud case registers 18. Five analyst-only operations are never registered
as WebMCP tools and are rejected on the callback surface:

- `record_evidence_decision`
- `release_next_synthetic_signal`
- `authorize_response_action`
- `authorize_response_bundle`
- `approve_case_report`

The public sandbox intentionally lets the visitor use analyst controls. That is a workflow boundary, not authenticated-human proof. A private deployment must protect the analyst-control channel with verified identity and authorization.

## Endpoint evidence visibility

The endpoint graph is evidence-released, not pre-expanded. Counts below cover
visible entities, observed events, and evidence joins; modeled reach remains
separate from observed and prevented activity.

| Investigation point                                     | Entities | Events | Joins |
| ------------------------------------------------------- | -------: | -----: | ----: |
| Fresh Tier 1 case                                       |        3 |      4 |     2 |
| Identity evidence attached                              |        4 |      5 |     2 |
| Stage 1 released                                        |        7 |     11 |     7 |
| Final, after reachability and analyst telemetry release |        8 |     13 |     8 |

Stage 1 reveals `APP-SRV-021`, the expected service host, and the observed
credential-read topology. `APP-SRV-021` is prevented, not compromised.
`billing-api` is modeled-only and remains hidden until reachability is attached;
it is not observed compromise. Approved query targets can be known before they
are visible. An approved query can attach its bounded identity evidence; it
does not release stage-gated telemetry, entities, or relationships.

## Public release

- Live URL: [watchfloor-sandbox.watchfloor-webmcp.workers.dev](https://watchfloor-sandbox.watchfloor-webmcp.workers.dev)
- Release identity: read the live
  [`/api/release`](https://watchfloor-sandbox.watchfloor-webmcp.workers.dev/api/release)
  endpoint. A final release must identify the reviewed public commit
- Endpoint lifecycle: revision `r29`
- Current source verification passes **175 tests** across **8,569 test lines in
  29 files**.

Historical hosted verification on 2026-09-01 passed from `r14` through analyst
telemetry release, recovery authorization, and analyst-approved report closure
at `r29`. Direct attach before analyst release was rejected at `r19` with
`TELEMETRY_RELEASE_REQUIRED` and no revision change; a repeated pending-gate
bypass was rejected at `r20` with no revision change. Hosted smoke passed, and
`/alerts`, `/start`, and the cloud route had zero browser errors; cloud
`get_case_context` passed.

In that historical hosted check, public `npm run smoke` passed its HTTP
evidence-lineage and trusted-receipt assertions, then reset the case.
Separately, the in-app browser at 1280×720 showed the then-current
`TRACE ready · 29 tools` label, native registration including
`trace_evidence_lineage`, and initial entity lineage in the existing
scroll-contained drawer. It was left at `r1` with no selection and the drawer
closed. These checks distinguish hosted HTTP operation coverage from native
page registration and UI coverage.

Those historical checks do not attest to later source changes. Before
submission, `/api/release` must identify the reviewed public commit and hosted
smoke plus native WebMCP verification must be repeated against that exact
deployment.

### Final public release procedure

Do this only after the reviewed source is committed and pushed to its public
GitHub, GitLab, or Bitbucket repository. The deploy command refuses a dirty
tree, a nonmatching `HEAD`, a missing remote, a remote that does not match the
declared public repository, or a `HEAD` absent from that remote's tracking
branches. The values are public release metadata, not secrets; do not put them
in `wrangler.public.json`.

`wrangler.public.json` identifies the live sandbox's D1 database and rate-limit
namespaces. Those identifiers are public configuration, not credentials, but
they are account-specific. A fork must provision its own resources and replace
those identifiers before deploying; local `npm run dev` and `npm run check` do
not use the live resources.

```bash
export WATCHFLOOR_SOURCE_REPOSITORY="https://github.com/OWNER/REPOSITORY"
export WATCHFLOOR_RELEASE_ID="watchfloor-$(git rev-parse --short=12 HEAD)"
npm run cloudflare:deploy-public
```

The deploy derives the commit from `HEAD`, rejects a supplied mismatch, and
passes those values plus `WATCHFLOOR_AUTH_MODE=anonymous_sandbox` as explicit
Wrangler `--var` bindings with `--strict`. Verify
the exact source-to-deployment identity after the command completes:

```bash
curl --fail --silent --show-error \
  https://watchfloor-sandbox.watchfloor-webmcp.workers.dev/api/release
```

The returned `sourceCommit`, `sourceRepository`, and `releaseId` must equal
the current `git rev-parse HEAD`, the exported repository URL, and the
exported release ID. Then run the hosted smoke test against the same URL.
Finally, in a signed-out private browser window, load `/alerts` and the
primary case URL to confirm that public evaluation access works without a
pre-existing session or identity.

The public deployment has no remote source identity, public repository URL, or
public video yet. These are deliberate release blanks; see
[SUBMISSION.md](./SUBMISSION.md). Do not bind production data, credentials, or
integrations to the public Worker.

## Repository map

- `domain/`: fixtures, state transitions, query contracts, and operation validation.
- `webmcp/tools.ts`: route-scoped tool definitions and browser registration.
- `server/`: request authentication, surface enforcement, limits, D1 persistence, idempotency, and receipts.
- `components/`: shared analyst and TRACE workbench UI.
- `tests/`: unit, lifecycle, security, and deployment-contract coverage.

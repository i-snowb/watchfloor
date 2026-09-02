# WATCH//FLOOR Submission Record

Fill only verified values.

## Live release

- Live URL: `https://watchfloor-sandbox.watchfloor-webmcp.workers.dev`
- Primary case: `https://watchfloor-sandbox.watchfloor-webmcp.workers.dev/cases/case-endpoint-0448`
- Worker version: read the live release metadata at submission time; do not
  copy a historical deployment-specific value.
- Worker release metadata: `https://watchfloor-sandbox.watchfloor-webmcp.workers.dev/api/release`
- Public remote/source identity: `https://github.com/i-snowb/watchfloor`
- Public repository URL: `https://github.com/i-snowb/watchfloor`
- Public video URL: `<NOT_PUBLISHED>`
- Final commit: read `sourceCommit` from `/api/release` after the final publish

Before the final public deployment, set only verified public metadata and use
the guarded deploy command:

```bash
export WATCHFLOOR_SOURCE_REPOSITORY="https://github.com/i-snowb/watchfloor"
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

- The guarded public deploy reruns formatting, lint, strict TypeScript, 175
  tests, the production build, sandbox-profile validation, and source
  provenance checks.
- Hosted smoke passes both deterministic case lifecycles through report closure
  and final reset, including released evidence lineage, trusted receipts,
  idempotency, stale state, forged envelopes, and WebMCP/analyst boundaries.
- Native hosted registration exposes 2 queue tools, 24 endpoint tools, and 18
  cloud tools. Endpoint `get_case_context` returns the fresh `r1` bounded next
  action.
- `/alerts`, `/start`, the endpoint case, and the cloud case load anonymously
  with the expected browser security headers.
- At 1280×720, the endpoint body has no horizontal overflow, its three opening
  graph cards remain contained, and the checked routes have no console errors.
- `/api/release` is the authoritative link between the deployed Worker and the
  exact public GitHub commit.

## Final checks

- [x] `npm run check` passes on the public source commit.
- [x] Guarded Cloudflare deployment identifies the exact public source commit.
- [x] Hosted lifecycle smoke, release metadata, routes, and headers pass.
- [x] Native hosted queue, endpoint, and cloud WebMCP registration passes.
- [x] Endpoint `get_case_context` works through native WebMCP at fresh `r1`.
- [x] Public source, README, license, and social asset are anonymously reachable.
- [x] Recording-width containment and checked-route console output pass.
- [ ] Public narrated video is published and verified.

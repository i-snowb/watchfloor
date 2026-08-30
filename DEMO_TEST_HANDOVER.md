# WATCH//FLOOR Endpoint Test Handover

## Purpose

This is the execution contract for the primary endpoint investigation and its hardened test. The target is `case-endpoint-0448` on the hosted ChatGPT Site. The canonical path starts at revision 1, uses native WebMCP for every connected-agent operation, stops at analyst-only gates, and closes at revision 28 when no optional forensic queries are added.

Use this document to rehearse, diagnose failures, and prove the endpoint path is reproducible. Optional recording guidance is in [JUDGE_GUIDE.md](./JUDGE_GUIDE.md).

## What the investigation must prove

1. The page exposes security semantics through WebMCP, not browser click targets.
2. The connected agent works in the analyst's visible query editor, graph, inspector, and timeline.
3. Connected-agent query results add auditable records, findings, entities, relationships, and incident stages to the shared case.
4. Observed activity, prevented activity, modeled exposure, simulated controls, and analyst-approved records remain distinct.
5. The connected agent can move quickly, but it cannot make the malicious disposition, execute the analyst replay control, authorize response, or approve its own report.
6. Every state change has a receipt and a revision. No external security system is contacted.

## Stable target

- Runtime baseline: commit `5061911`, ChatGPT Sites version 16.
- Hosted route: `/cases/case-endpoint-0448`.
- Initial state: revision 1, no attached query results, no discovery stage, pending decision, no impact model, no response approval, and no report.
- Operation layer: 35 bounded case operations.
- Native route surface: 27 registered endpoint tools.
- Current deployment access: owner-only through ChatGPT sign-in. Judge access is a separate submission gate.

Do not test against an old open tab without resetting it. The application uses browser-session state, so a successful API smoke run does not reset the presentation browser.

## Connected-agent operating rules

- Start with `get_case_context` and `list_investigation_skills`. Read `revision`, available skills, discoveries, response packages, and `collaborationHandoff`.
- Send one revision-changing tool call at a time.
- Use the current `expectedRevision`. After success, use the returned revision for the next write.
- Do not add a `requestId` to WebMCP input. The page creates the operation envelope and receipt.
- Every approved skill uses `prepare_investigation_query` followed by `run_investigation_query` with the exact returned `queryText`. A skill ID is the case query ID and maps to one immutable bounded query contract.
- Wait until the canonical KQL is visible before running it.
- Use `attach_discovery_stage` only when `get_case_context` marks the next stage ready.
- Stop when `collaborationHandoff.nextOwner` is `analyst`.
- Never claim a control executed outside WATCH//FLOOR.

## Preflight

Complete this before each full rehearsal:

1. Confirm the intended build passed `npm run check` and `npm run smoke`.
2. Sign in to the hosted Site and open `/alerts`.
3. Confirm five Tier 1 escalations and open **Execution with early lateral movement**.
4. Reset the case. Reload once.
5. Confirm revision 1, zero operation receipts, pending disposition, and no prepared query.
6. Confirm **27/27** endpoint tools register. Do not continue if the browser reports that WebMCP is unavailable.
7. Confirm **Observed activity** is the default view and **Potential impact** states that reachability is required.
8. Confirm no entity, finding, action, or report from a previous run remains.

Use this opening prompt in the signed-in case:

> Work this synthetic escalation through the registered page tools. Begin with `get_case_context`. Prepare and run one exact visible query at a time, show raw records for the file and exact-hash queries, and use `attach_discovery_stage` when the next cited discovery is ready. Keep observed, prevented, modeled, simulated, and analyst-approved states distinct. Stop before every analyst disposition, response authorization, and report approval. Never imply external execution.

## Canonical revision path

This path omits optional static-analysis and sandbox queries. Read-only calls do not change the revision.

| Result revision | Actor   | Operation                                                            |
| --------------- | ------- | -------------------------------------------------------------------- |
| r1              | Agent   | `get_case_context` and `list_investigation_skills`                   |
| r2 / r3         | Agent   | prepare / run `QRY-ENDPOINT-FILE-01`                                 |
| r4 / r5         | Agent   | prepare / run `QRY-ENDPOINT-HASH-10`                                 |
| r6 / r7         | Agent   | prepare / run `QRY-ENDPOINT-HOST-02`                                 |
| r8 / r9         | Agent   | prepare / run `QRY-ENDPOINT-IDENTITY-03`                             |
| r10 / r11       | Agent   | prepare / run `QRY-ENDPOINT-EGRESS-04`                               |
| r12             | Agent   | attach `STREAM-LAT-01` through `attach_discovery_stage`              |
| r13 / r14       | Agent   | prepare / run `QRY-ENDPOINT-APP-05`                                  |
| r15             | Analyst | record `confirmed_malicious`                                         |
| r16             | Agent   | `calculate_reachability`                                             |
| r17             | Agent   | `simulate_control`                                                   |
| r18             | Agent   | prepare `containment` package                                        |
| r19             | Analyst | authorize `containment` package                                      |
| r20             | Agent   | attach `STREAM-LAT-02` through `attach_discovery_stage`              |
| r21 / r22       | Agent   | prepare / run `QRY-ENDPOINT-SECRET-06`                               |
| r23 / r24       | Agent   | prepare / run `QRY-ENDPOINT-WORKLOAD-07`                             |
| r25             | Agent   | prepare `recovery` package                                           |
| r26             | Analyst | authorize `recovery` package                                         |
| r27             | Agent   | `generate_case_report`                                               |
| r28             | Analyst | approve `REPORT-ENDPOINT-0448` with a persisted analyst closure note |

Optional `QRY-ENDPOINT-STATIC-08` and `QRY-ENDPOINT-SANDBOX-09` add two revisions each. If an optional query or the manual replay path is used, verify the same state transitions instead of requiring the exact final revision.

## Detailed rehearsal

### 1. Establish shared context

Connected agent:

```json
{}
```

Tool: `get_case_context`

Visible proof:

- The optional escalation brief identifies unsigned execution, repeated destination activity, service-identity use, and withheld response actions.
- The graph distinguishes file, endpoint, network indicator, identity, application host, secret, and workload entities.
- No response is approved and no downstream workload is described as compromised.

### 2. Run the first visible investigation query

Connected agent prepares:

```json
{
  "expectedRevision": 1,
  "queryId": "QRY-ENDPOINT-FILE-01"
}
```

The page must show the canonical KQL before execution. The connected agent then runs:

```json
{
  "expectedRevision": 2,
  "queryId": "QRY-ENDPOINT-FILE-01",
  "queryText": "<exact queryText returned by prepare_investigation_query>"
}
```

Visible proof:

- Running state lasts long enough to read as a real bounded query.
- Raw records show the file event, unsigned process execution, process-bound TLS activity, and exact SHA-256.
- The result attaches to the file on the graph.
- The investigation timeline adds an agent receipt with operation, outcome, and revision.
- Preparation alone does not attach findings or reveal result counts.

Use the same prepare/run protocol for every later query. Never copy KQL from documentation.

### 3. Establish file, host, identity, and network context

Run, in order:

1. `QRY-ENDPOINT-HASH-10`
2. `QRY-ENDPOINT-HOST-02`
3. `QRY-ENDPOINT-IDENTITY-03`
4. `QRY-ENDPOINT-EGRESS-04`

Required proof:

- Hash: archived malicious/high-confidence fixture and zero enterprise prevalence. No live OSINT request.
- Host: healthy EDR, assigned endpoint, and isolation support.
- Identity: `svc-fin-reports` is scoped to `FIN-REPORTS-SRV-010` and has no prior `APP-SRV-021` logons in 90 days.
- Network: the exact destination is absent from approved egress and prior peer history.
- Every result exposes returned records and adds a graph packet and timeline receipt.

### 4. Let the connected agent expand the incident

After the identity query is attached, `get_case_context` must report `STREAM-LAT-01` as ready.

Connected agent:

```json
{
  "expectedRevision": 11,
  "stageId": "STREAM-LAT-01",
  "rationale": "Attach the verified host-boundary discovery from the returned identity records."
}
```

Tool: `attach_discovery_stage`

Visible proof:

- The graph visibly adds `FIN-REPORTS-SRV-010`, two cited observations, and the new relationships.
- The timeline gains a **Verified discovery added** receipt.
- `APP-SRV-021` is a lateral target with authentication evidence. It is not marked compromised.
- The remote service-start result says blocked before execution.
- The discovery cites `QRY-ENDPOINT-IDENTITY-03` and its exact source records.

Then prepare and run `QRY-ENDPOINT-APP-05`. Its returned records must confirm healthy target EDR and prevention before payload execution.

### 5. Stop for the analyst disposition

The connected agent stops. The analyst selects **Confirm malicious · contain** and records a rationale of 8–240 characters.

Expected internal operation:

```json
{
  "expectedRevision": 14,
  "decision": "confirmed_malicious",
  "rationale": "Unsigned execution, repeated TLS, out-of-scope service identity use, blocked remote service control, and credential access meet the containment threshold."
}
```

Tool: `record_evidence_decision` through analyst control only.

Visible proof:

- The receipt identifies the analyst as decision owner.
- No containment appears approved.
- A WebMCP attempt to call this operation must fail without changing the revision.

### 6. Model the highest-consequence route

Connected agent:

```json
{
  "expectedRevision": 15,
  "fromEntityId": "endpoint:fin-ws-044",
  "maxDepth": 6
}
```

Tool: `calculate_reachability`

Then:

```json
{
  "expectedRevision": 16,
  "control": "isolate_compromised_path"
}
```

Tool: `simulate_control`

Visible proof:

- **Potential impact** becomes available.
- The P1-P5 issue rail ranks `FIN-WS-044`, `svc-fin-reports`, `ci/deploy/production`, `APP-SRV-021`, and `billing-api`.
- The red directional priority route is `FIN-WS-044 → svc-fin-reports → ci/deploy/production → billing-api`.
- `billing-api` says modeled at risk or modeled not observed. It never says infected.
- `APP-SRV-021` shows a prevention marker.
- The simulation affects a copy of the graph. It is not yet an approved control.

### 7. Prepare and authorize containment

Connected agent:

```json
{
  "expectedRevision": 17,
  "bundleId": "containment"
}
```

Tool: `prepare_response_bundle`

The package must contain:

- `collect_endpoint_forensics`
- `contain_endpoint`
- `block_network_indicator`
- `disable_service_identity`

The analyst reviews the package and authorizes the exact returned `proposalId` with `AUTHORIZE_SYNTHETIC_BUNDLE`.

Visible proof:

- Four controls become `authorized_in_demo`.
- `FIN-WS-044` retains confirmed-compromise evidence and gains **Isolation approved**.
- `svc-fin-reports` retains misuse evidence and gains **Disable approved**.
- Applicable modeled route segments become green and severed.
- Every action states that no external action executed.

### 8. Let the connected agent add recovery scope

Connected agent attaches the next ready discovery:

```json
{
  "expectedRevision": 19,
  "stageId": "STREAM-LAT-02",
  "rationale": "Attach the cited credential and workload recovery inventory after containment approval."
}
```

Tool: `attach_discovery_stage`

Then prepare and run:

1. `QRY-ENDPOINT-SECRET-06`
2. `QRY-ENDPOINT-WORKLOAD-07`

Visible proof:

- Credential posture includes rotation support without secret material.
- Workload inventory shows current image `billing-api:v2026.08.28.3` and known-good image `billing-api:v2026.08.27.7`.
- The workload is not described as malicious. No deployment through the credential was observed.

### 9. Prepare and authorize recovery

Connected agent prepares:

```json
{
  "expectedRevision": 24,
  "bundleId": "recovery"
}
```

The package contains `rotate_deployment_credential` followed by `rollback_workload_image`. The analyst authorizes the exact returned `proposalId` with `AUTHORIZE_SYNTHETIC_BUNDLE`.

Visible proof:

- Credential rotation and known-good redeploy are recorded approvals, not external executions.
- The historical credential read remains visible.
- Six response actions are now `authorized_in_demo`.

### 10. Generate and approve the evidence report

Connected agent:

```json
{
  "expectedRevision": 26
}
```

Tool: `generate_case_report`

The analyst reviews `REPORT-ENDPOINT-0448`, enters a 24–600 character closure note, and approves with `APPROVE_SYNTHETIC_REPORT`.

Required report proof:

- Disposition: `confirmed_malicious_synthetic`.
- Four confirmed findings.
- Six recorded response action IDs.
- 29 evidence references on the canonical required-query path.
- Limitations explicitly deny observed payload execution on `APP-SRV-021`, malicious deployment, and proof from modeled reachability.
- Residual risk and response provenance are visible.
- The analyst closure note persists after refresh.
- Final lifecycle is `closed_in_demo`; final report state is `approved_in_demo`.

## Analyst replay boundary test

The analyst UI can release the next fixed signal through `release_next_synthetic_signal`. WebMCP cannot call that operation. This is an alternate replay path, not the canonical endpoint path. Optional recording may use the same path.

Test it once from a reset case:

1. Complete the discovery's required queries.
2. Attempt `release_next_synthetic_signal` from the agent surface. Expect `SURFACE_NOT_ALLOWED` and no revision change.
3. Release it through the analyst control. Confirm that only the next fixed stage appears.

Do not combine this alternate release with `attach_discovery_stage` for the same stage.

## Mandatory negative tests

Run these before filming. They do not all need to appear in the video.

| Test                                            | Expected result                                                             |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| Run a query without preparation                 | `QUERY_PREPARATION_REQUIRED`; no revision change                            |
| Alter one character of prepared KQL             | `QUERY_TEXT_MISMATCH`; no revision change                                   |
| Reuse the prior revision after a write          | `STALE_STATE`; current state remains intact                                 |
| Attach a discovery before its cited query       | `DISCOVERY_QUERY_REQUIRED` or `DISCOVERY_EVIDENCE_REQUIRED`                 |
| Attach `STREAM-LAT-02` before `STREAM-LAT-01`   | `DISCOVERY_NOT_AVAILABLE`                                                   |
| Ask WebMCP to record the disposition            | Operation unavailable or `SURFACE_NOT_ALLOWED`                              |
| Ask WebMCP to release the analyst replay signal | Operation unavailable or `SURFACE_NOT_ALLOWED`                              |
| Ask WebMCP to authorize either package          | Operation unavailable or `SURFACE_NOT_ALLOWED`                              |
| Generate the report before all gates            | `CONTEXT_REQUIRED`, `RESPONSE_REQUIRED`, `STREAM_INCOMPLETE`, or model gate |
| Ask WebMCP to approve the report                | Operation unavailable or `SURFACE_NOT_ALLOWED`                              |

All failed writes must preserve the revision and must not create a success receipt.

## Visual and interaction test matrix

Test at the recording viewport and at one narrower desktop viewport:

- No graph node, issue card, result packet, inspector, timeline label, or command bar overlaps critical text.
- Long entity labels remain readable without unexplained truncation.
- Panning, wheel zoom, fit, click inspection, issue selection, and route selection work after every discovery.
- Observed activity and potential impact look materially different.
- Result attachment, new-stage entry, red route propagation, and green containment transitions remain smooth.
- Animation never blocks input and honors reduced motion.
- Timeline text is not clipped; each receipt exposes actor, operation, outcome, and revision.
- Raw returned records remain scrollable and do not cover the analyst gate.
- Report review is a document workflow, not a single close button.
- Refresh preserves current case state and report closure.

## Two-pass video readiness gate

The build is ready to record only after two consecutive signed-in hosted passes satisfy all of these conditions:

1. The page registers 27/27 endpoint tools after reset and navigation.
2. `get_case_context`, skill listing, query preparation, query execution, discovery attachment, reachability, response preparation, and report generation all produce native connected-agent callback receipts.
3. The page visibly changes for every revision-changing WebMCP operation.
4. The canonical endpoint path reaches closure without a stale revision, duplicate receipt, missing tool, clipped control, or hidden raw result.
5. A reset returns to revision 1 with zero receipts and no prior findings.
6. The second pass behaves the same as the first.
7. Returning to `/alerts` reflects the closed case.

If a pass fails, record:

```text
Build/version:
Browser and route:
Case revision before action:
Actor:
Tool or analyst control:
Input identifiers:
Expected state/UI:
Actual state/UI:
Receipt or error code:
Reproduces after reset: yes/no
Screenshot or recording reference:
```

Do not film around a failed gate. Fix or document the failure, reset, and complete two new consecutive passes.

## Recording language

Use these terms:

- **bounded synthetic case data**
- **archived intelligence fixture**
- **blocked before payload execution**
- **modeled reachable; not observed compromised**
- **analyst-approved recorded response; no external execution**
- **agent-added verified discovery from cited query records**

Do not say that WATCH//FLOOR queried a live SIEM, detonated a sample, contacted OSINT, infected `APP-SRV-021`, observed a malicious `billing-api` deployment, or executed an endpoint, firewall, directory, secret-store, or deployment-system action.

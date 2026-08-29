# TRACE//LAB Judge Guide

## Fast hands-on path

This path takes about 90 seconds and demonstrates the WebMCP difference without completing the full response lifecycle.

1. Open the incident ledger and select **Execution with early lateral movement**.
2. Read the compact Tier 1 handoff. Confirm that no response action has been taken.
3. Ask the copilot to call `get_case_context`.
4. Ask it to prepare `QRY-ENDPOINT-FILE-01`. The shared query workspace must show the canonical KQL before execution.
5. Ask it to run the exact returned `queryText`.
6. Open the returned records. Confirm the user-writable file creation, unsigned process start, process-bound TLS connections, and exact SHA-256.
7. Ask it to prepare and run `QRY-ENDPOINT-HASH-10`.
8. Confirm the archived intelligence verdict, high confidence, zero enterprise prevalence, and the explicit statement that no external provider was contacted.
9. Select the result on the graph and confirm the activity timeline records the copilot operation and revision.

Expected result: the agent operates the same visible workbench as the analyst. It does not use hidden browser automation, and it cannot cross an analyst approval gate.

## Three-minute filming sequence

| Time      | Screen action                                                                                              | Point to establish                                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:08 | Show the five-case incident ledger and open the critical endpoint case.                                    | Tier 1 escalated a cross-domain chain; this is not a raw alert feed.                                                            |
| 0:08–0:18 | Show the Tier 1 handoff and select `invoice-sync-helper.exe`.                                              | Tier 1 supplied observations and evidence gaps but withheld response.                                                           |
| 0:18–0:38 | Copilot calls `get_case_context`, prepares `QRY-ENDPOINT-FILE-01`, and runs the visible KQL.               | WebMCP exposes a semantic investigation operation, not a click macro.                                                           |
| 0:38–0:48 | Open raw records and focus one record on the graph.                                                        | The result is auditable source data, not only an AI summary.                                                                    |
| 0:48–1:05 | Copilot prepares and runs `QRY-ENDPOINT-HASH-10`.                                                          | The exact hash receives an archived intelligence verdict without an external request.                                           |
| 1:05–1:20 | Cut a rapid receipt montage of the host, identity, and destination checks attaching to the graph.          | Control readiness and scope evidence complete the analyst decision packet.                                                      |
| 1:20–1:33 | Analyst releases the next observation; copilot runs `QRY-ENDPOINT-APP-05`.                                 | APP-SRV-021 blocked remote service start before payload execution.                                                              |
| 1:33–1:41 | Analyst records **Confirm malicious · contain**.                                                           | The disposition remains a human decision.                                                                                       |
| 1:41–1:51 | Copilot calculates exposure and simulates the allowlisted control.                                         | Observed activity and modeled reach remain visibly different.                                                                   |
| 1:51–2:08 | Copilot prepares the containment package. Analyst reviews and approves it.                                 | Forensic triage, endpoint isolation, exact-IP blocking, and identity disablement are human-gated; no external control executes. |
| 2:08–2:22 | Copilot requests recovery evidence. Analyst releases it. Copilot attaches credential and workload results. | The case can continue after containment without inventing a deployment.                                                         |
| 2:22–2:36 | Copilot prepares recovery. Analyst approves rotation and known-good redeploy records.                      | Recovery is dependency-ordered and auditable.                                                                                   |
| 2:36–2:52 | Copilot generates the evidence report.                                                                     | Show findings, response provenance, evidence references, limitations, and residual risk.                                        |
| 2:52–3:00 | Analyst approves closure and returns to the ledger.                                                        | The case ends at a human gate; the ledger proves scenario breadth.                                                              |

Use this prompt at the start of the endpoint case:

> Work this synthetic case to the next analyst gate through the registered page tools. Use `get_case_context`, then prepare and run one visible exact query at a time. Show raw returned records for the first file query and the exact-hash query. Keep observed evidence separate from modeled reach and simulated response. Stop before every analyst-only decision, telemetry release, response approval, and report approval. Do not claim external execution.

## Query map

The guide lists stable query IDs, not copied KQL. Every query must follow the same protocol: call `prepare_investigation_query`, wait for the canonical KQL to appear in the shared workspace, then execute that prepared query with `run_investigation_query` or the matching next step with `run_investigation_plan`. Both paths reject missing, mismatched, or stale preparation.

| Query ID                   | Purpose                                                            | Required                    |
| -------------------------- | ------------------------------------------------------------------ | --------------------------- |
| `QRY-ENDPOINT-FILE-01`     | File execution, process lineage, repeated TLS, and prevalence      | Yes                         |
| `QRY-ENDPOINT-HASH-10`     | Exact SHA-256 intelligence and enterprise prevalence               | Yes                         |
| `QRY-ENDPOINT-HOST-02`     | FIN-WS-044 ownership, EDR health, and isolation readiness          | Yes                         |
| `QRY-ENDPOINT-IDENTITY-03` | Service-identity scope and APP-SRV-021 history                     | Yes                         |
| `QRY-ENDPOINT-EGRESS-04`   | Repeated destination and approved-egress comparison                | Yes                         |
| `QRY-ENDPOINT-APP-05`      | Target-side authentication, service control, and prevention result | Yes, after release          |
| `QRY-ENDPOINT-SECRET-06`   | Credential posture and downstream permission                       | Yes, after recovery release |
| `QRY-ENDPOINT-WORKLOAD-07` | Current and known-good workload images                             | Yes, after recovery release |
| `QRY-ENDPOINT-STATIC-08`   | Archived static metadata and API-reference summary                 | Optional                    |
| `QRY-ENDPOINT-SANDBOX-09`  | Archived sandbox behavior review                                   | Optional                    |

## Stop conditions

Do not record or submit the build if any condition occurs:

- Native tools do not register on the hosted route.
- A prepared query is not visible before execution.
- Modified query text executes successfully.
- Raw returned records are unavailable.
- The exact SHA-256 differs between the entity, query, result, and report evidence.
- Future telemetry appears before the analyst release.
- APP-SRV-021 is described as compromised or executing a payload.
- The workload is described as malicious or deployed through the exposed credential.
- A simulated control appears approved before the analyst action.
- The copilot can record a disposition, release telemetry, authorize response, or approve the report.
- Any receipt implies that an external endpoint, firewall, directory, secret store, deployment system, sandbox, or intelligence provider was contacted.
- The hosted case cannot complete twice from revision 1 without stale state, clipped controls, duplicate receipts, or lost tools.

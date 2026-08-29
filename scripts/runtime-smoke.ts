import assert from "node:assert/strict";
import type { CaseApiResponse, ToolApiResponse } from "../domain/api";
import { getQueryConsoleContract } from "../domain/query-console";

const baseUrl = process.env.TRACE_BASE_URL ?? "http://localhost:3000";
const sitesAuthorization = process.env.TRACE_SITES_AUTHORIZATION;
const cloud = "case-cloud-0421";
const endpoint = "case-endpoint-0448";
let cookie = "";
type Surface = "webmcp_callback" | "analyst_control";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      ...(sitesAuthorization
        ? { "OAI-Sites-Authorization": sitesAuthorization }
        : {}),
      ...(cookie ? { cookie } : {}),
      ...init.headers,
    },
  });
  const sessionCookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("trace_demo_session="));
  if (sessionCookie) cookie = sessionCookie.split(";", 1)[0] ?? cookie;
  const body: unknown = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return body as T;
}

async function reset(caseId: string): Promise<CaseApiResponse> {
  return request(`/api/cases/${caseId}/reset`, { method: "POST" });
}

async function op(
  caseId: string,
  n: number,
  toolName: string,
  surface: Surface,
  input: Record<string, unknown>,
  ok = true,
): Promise<ToolApiResponse> {
  const normalizedInput =
    toolName === "run_investigation_query" &&
    typeof input.queryId === "string" &&
    input.queryText === undefined
      ? {
          ...input,
          queryText: getQueryConsoleContract(input.queryId)?.text ?? "",
        }
      : input;
  const response = await request<ToolApiResponse>(
    `/api/cases/${caseId}/operations`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: `smoke-${caseId}-${String(n).padStart(2, "0")}-${toolName}`,
        toolName,
        reportedSurface: surface,
        input: normalizedInput,
      }),
    },
  );
  assert.equal(response.result.ok, ok, JSON.stringify(response.result));
  return response;
}

function rejected(
  response: ToolApiResponse,
  code: string,
  revision: number,
): void {
  assert.equal(response.result.ok, false, JSON.stringify(response.result));
  if (!response.result.ok) assert.equal(response.result.error.code, code);
  assert.equal(response.snapshot.state.revision, revision);
}

async function forgedEnvelope(): Promise<void> {
  const response = await fetch(`${baseUrl}/api/cases/${cloud}/operations`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(sitesAuthorization
        ? { "OAI-Sites-Authorization": sitesAuthorization }
        : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({
      requestId: "smoke-forged-envelope",
      toolName: "get_case_context",
      actor: "agent",
      input: {},
    }),
  });
  const body = (await response.json()) as { error?: { code?: string } };
  assert.equal(response.status, 400);
  assert.equal(body.error?.code, "INVALID_REQUEST");
}

async function cloudPath(): Promise<void> {
  const initial = await reset(cloud);
  assert.equal(initial.snapshot.state.revision, 1);
  assert.equal(initial.snapshot.receipts.length, 0);
  const context = await op(cloud, 1, "get_case_context", "webmcp_callback", {});
  const retry = await op(cloud, 1, "get_case_context", "webmcp_callback", {});
  assert.deepEqual(retry.result, context.result);
  assert.equal(retry.snapshot.receipts.length, 1);

  await op(cloud, 2, "run_investigation_query", "webmcp_callback", {
    expectedRevision: 1,
    queryId: "QRY-CLOUD-IDENTITY-01",
  });
  await op(cloud, 3, "run_investigation_query", "webmcp_callback", {
    expectedRevision: 2,
    queryId: "QRY-CLOUD-EGRESS-02",
  });
  await op(cloud, 4, "run_investigation_query", "webmcp_callback", {
    expectedRevision: 3,
    queryId: "QRY-CLOUD-ROLE-03",
  });
  await op(cloud, 5, "run_investigation_query", "webmcp_callback", {
    expectedRevision: 4,
    queryId: "QRY-CLOUD-EXPORT-04",
  });
  rejected(
    await op(
      cloud,
      6,
      "record_evidence_decision",
      "webmcp_callback",
      {
        expectedRevision: 5,
        decision: "authorized_exception",
        rationale: "Analyst-only decision boundary.",
      },
      false,
    ),
    "SURFACE_NOT_ALLOWED",
    5,
  );
  await op(cloud, 7, "record_evidence_decision", "analyst_control", {
    expectedRevision: 5,
    decision: "authorized_exception",
    rationale:
      "Approved change, assigned device, VPN source, export object, and time window align; elevated role use is a policy exception.",
  });
  await op(cloud, 8, "generate_case_report", "webmcp_callback", {
    expectedRevision: 6,
  });
  const final = await op(cloud, 9, "approve_case_report", "analyst_control", {
    expectedRevision: 7,
    reportId: "REPORT-CLOUD-0421",
    acknowledgement: "APPROVE_SYNTHETIC_REPORT",
  });
  const { state, receipts } = final.snapshot;
  assert.equal(state.revision, 8);
  assert.equal(state.lifecycle, "closed_in_demo");
  assert.equal(state.decision.status, "authorized_exception");
  assert.equal(state.report.status, "approved_in_demo");
  assert.equal(state.report.report?.id, "REPORT-CLOUD-0421");
  assert.equal(
    state.report.report?.disposition,
    "authorized_activity_policy_exception",
  );
  assert.deepEqual(state.report.report?.actionIds, []);
  assert.equal(receipts.length, 9);
}

async function endpointPath(): Promise<void> {
  const initial = await reset(endpoint);
  assert.equal(initial.snapshot.state.revision, 1);
  assert.equal(initial.snapshot.receipts.length, 0);
  const context = await op(
    endpoint,
    1,
    "get_case_context",
    "webmcp_callback",
    {},
  );
  const retry = await op(
    endpoint,
    1,
    "get_case_context",
    "webmcp_callback",
    {},
  );
  assert.deepEqual(retry.result, context.result);
  assert.equal(retry.snapshot.receipts.length, 1);
  rejected(
    await op(
      endpoint,
      2,
      "release_next_synthetic_signal",
      "webmcp_callback",
      { expectedRevision: 1 },
      false,
    ),
    "SURFACE_NOT_ALLOWED",
    1,
  );

  await op(endpoint, 3, "run_investigation_query", "webmcp_callback", {
    expectedRevision: 1,
    queryId: "QRY-ENDPOINT-FILE-01",
  });
  rejected(
    await op(
      endpoint,
      4,
      "run_investigation_query",
      "webmcp_callback",
      { expectedRevision: 1, queryId: "QRY-ENDPOINT-HOST-02" },
      false,
    ),
    "STALE_STATE",
    2,
  );
  await op(endpoint, 5, "run_investigation_query", "webmcp_callback", {
    expectedRevision: 2,
    queryId: "QRY-ENDPOINT-HOST-02",
  });
  await op(endpoint, 6, "run_investigation_query", "webmcp_callback", {
    expectedRevision: 3,
    queryId: "QRY-ENDPOINT-IDENTITY-03",
  });
  await op(endpoint, 7, "run_investigation_query", "webmcp_callback", {
    expectedRevision: 4,
    queryId: "QRY-ENDPOINT-EGRESS-04",
  });
  await op(endpoint, 8, "release_next_synthetic_signal", "analyst_control", {
    expectedRevision: 5,
  });
  await op(endpoint, 9, "run_investigation_query", "webmcp_callback", {
    expectedRevision: 6,
    queryId: "QRY-ENDPOINT-APP-05",
  });
  rejected(
    await op(
      endpoint,
      10,
      "record_evidence_decision",
      "webmcp_callback",
      {
        expectedRevision: 7,
        decision: "confirmed_malicious",
        rationale: "Analyst-only decision boundary.",
      },
      false,
    ),
    "SURFACE_NOT_ALLOWED",
    7,
  );
  await op(endpoint, 11, "record_evidence_decision", "analyst_control", {
    expectedRevision: 7,
    decision: "confirmed_malicious",
    rationale:
      "Unsigned execution, repeated egress, out-of-scope authentication, blocked remote service control, and a credential read meet the synthetic containment threshold.",
  });
  await op(endpoint, 12, "calculate_reachability", "webmcp_callback", {
    expectedRevision: 8,
    fromEntityId: "endpoint:fin-ws-044",
    maxDepth: 6,
  });
  await op(endpoint, 13, "simulate_control", "webmcp_callback", {
    expectedRevision: 9,
    control: "isolate_compromised_path",
  });

  const contain = await responsePath(endpoint, 14, 10, "contain_endpoint");
  rejected(
    await op(
      endpoint,
      17,
      "authorize_response_action",
      "webmcp_callback",
      {
        expectedRevision: 12,
        actionId: "contain_endpoint",
        proposalId: contain,
        acknowledgement: "AUTHORIZE_SYNTHETIC_RESPONSE",
      },
      false,
    ),
    "SURFACE_NOT_ALLOWED",
    12,
  );
  await authorize(endpoint, 18, 12, "contain_endpoint", contain);
  const identity = await responsePath(
    endpoint,
    19,
    13,
    "disable_service_identity",
  );
  await authorize(endpoint, 22, 15, "disable_service_identity", identity);
  await op(endpoint, 23, "release_next_synthetic_signal", "analyst_control", {
    expectedRevision: 16,
  });
  await op(endpoint, 24, "run_investigation_query", "webmcp_callback", {
    expectedRevision: 17,
    queryId: "QRY-ENDPOINT-SECRET-06",
  });
  await op(endpoint, 25, "run_investigation_query", "webmcp_callback", {
    expectedRevision: 18,
    queryId: "QRY-ENDPOINT-WORKLOAD-07",
  });
  const rotate = await responsePath(
    endpoint,
    26,
    19,
    "rotate_deployment_credential",
  );
  await authorize(endpoint, 29, 21, "rotate_deployment_credential", rotate);
  const rollback = await responsePath(
    endpoint,
    30,
    22,
    "rollback_workload_image",
  );
  await authorize(endpoint, 33, 24, "rollback_workload_image", rollback);
  const drafted = await op(
    endpoint,
    34,
    "generate_case_report",
    "webmcp_callback",
    { expectedRevision: 25 },
  );
  assert.equal(
    drafted.snapshot.state.report.report?.id,
    "REPORT-ENDPOINT-0448",
  );
  rejected(
    await op(
      endpoint,
      35,
      "approve_case_report",
      "webmcp_callback",
      {
        expectedRevision: 26,
        reportId: "REPORT-ENDPOINT-0448",
        acknowledgement: "APPROVE_SYNTHETIC_REPORT",
      },
      false,
    ),
    "SURFACE_NOT_ALLOWED",
    26,
  );
  const final = await op(
    endpoint,
    36,
    "approve_case_report",
    "analyst_control",
    {
      expectedRevision: 26,
      reportId: "REPORT-ENDPOINT-0448",
      acknowledgement: "APPROVE_SYNTHETIC_REPORT",
    },
  );
  const { state } = final.snapshot;
  assert.equal(state.revision, 27);
  assert.equal(state.lifecycle, "closed_in_demo");
  assert.equal(state.decision.status, "confirmed_malicious");
  assert.deepEqual(state.releasedStreamStageIds, [
    "STREAM-LAT-01",
    "STREAM-LAT-02",
  ]);
  assert.equal(state.reachabilityAttached, true);
  assert.equal(state.counterfactualAttached, true);
  assert.deepEqual(
    state.responseActions.map((action) => action.status),
    Array(4).fill("authorized_in_demo"),
  );
  assert.equal(state.report.status, "approved_in_demo");
  assert.equal(state.report.report?.id, "REPORT-ENDPOINT-0448");
  assert.equal(
    state.report.report?.disposition,
    "confirmed_malicious_synthetic",
  );
  assert.deepEqual(state.report.report?.actionIds, [
    "contain_endpoint",
    "disable_service_identity",
    "rotate_deployment_credential",
    "rollback_workload_image",
  ]);
  assert.equal(state.report.report?.evidenceIds.length, 26);
}

async function responsePath(
  caseId: string,
  n: number,
  revision: number,
  actionId: string,
): Promise<string> {
  const proposal = await op(
    caseId,
    n,
    "propose_response_action",
    "webmcp_callback",
    {
      expectedRevision: revision,
      actionId,
      reasoning: `Fixture-defined synthetic response for ${actionId}.`,
    },
  );
  const proposalId = proposal.snapshot.state.responseProposal?.id;
  if (typeof proposalId !== "string") {
    throw new Error(`Missing proposal ID for ${actionId}.`);
  }
  await op(caseId, n + 1, "simulate_response_action", "webmcp_callback", {
    expectedRevision: revision + 1,
    actionId,
  });
  return proposalId;
}

async function authorize(
  caseId: string,
  n: number,
  revision: number,
  actionId: string,
  proposalId: string,
): Promise<void> {
  await op(caseId, n, "authorize_response_action", "analyst_control", {
    expectedRevision: revision,
    actionId,
    proposalId,
    acknowledgement: "AUTHORIZE_SYNTHETIC_RESPONSE",
  });
}

await request<CaseApiResponse>(`/api/cases/${cloud}`);
await forgedEnvelope();
await cloudPath();
await endpointPath();
const cloudReset = await reset(cloud);
const endpointReset = await reset(endpoint);
assert.equal(cloudReset.snapshot.state.revision, 1);
assert.equal(endpointReset.snapshot.state.revision, 1);
assert.equal(cloudReset.snapshot.receipts.length, 0);
assert.equal(endpointReset.snapshot.receipts.length, 0);
console.log(
  "Server/API smoke passed: all catalog queries, both deterministic case lifecycles, idempotency, forged envelope, stale-state, WebMCP/analyst boundaries, exact report closure, and final reset. Native WebMCP registration and callbacks are not exercised by this check.",
);

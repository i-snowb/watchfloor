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
  n: number | string,
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

async function prepareAndRunQuery(
  caseId: string,
  n: number,
  surface: Surface,
  expectedRevision: number,
  queryId: string,
): Promise<ToolApiResponse> {
  const prepared = await op(
    caseId,
    `${n}p`,
    "prepare_investigation_query",
    surface,
    { expectedRevision, queryId },
  );
  const queryText = getQueryConsoleContract(queryId)?.text;
  assert.equal(typeof queryText, "string");
  return op(caseId, `${n}r`, "run_investigation_query", surface, {
    expectedRevision: prepared.snapshot.state.revision,
    queryId,
    queryText,
  });
}

const completeReportReview = {
  acknowledgement: "APPROVE_SYNTHETIC_REPORT",
  analystClosureNote:
    "Evidence supports closure. Record the remaining policy exception and assigned follow-up.",
} as const;

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

  let revision = 1;
  revision = (
    await prepareAndRunQuery(
      cloud,
      2,
      "webmcp_callback",
      revision,
      "QRY-CLOUD-IDENTITY-01",
    )
  ).snapshot.state.revision;
  revision = (
    await prepareAndRunQuery(
      cloud,
      3,
      "webmcp_callback",
      revision,
      "QRY-CLOUD-EGRESS-02",
    )
  ).snapshot.state.revision;
  revision = (
    await prepareAndRunQuery(
      cloud,
      4,
      "webmcp_callback",
      revision,
      "QRY-CLOUD-ROLE-03",
    )
  ).snapshot.state.revision;
  revision = (
    await prepareAndRunQuery(
      cloud,
      5,
      "webmcp_callback",
      revision,
      "QRY-CLOUD-EXPORT-04",
    )
  ).snapshot.state.revision;
  rejected(
    await op(
      cloud,
      6,
      "record_evidence_decision",
      "webmcp_callback",
      {
        expectedRevision: revision,
        decision: "authorized_exception",
        rationale: "Analyst-only decision boundary.",
      },
      false,
    ),
    "SURFACE_NOT_ALLOWED",
    revision,
  );
  revision = (
    await op(cloud, 7, "record_evidence_decision", "analyst_control", {
      expectedRevision: revision,
      decision: "authorized_exception",
      rationale:
        "Approved change, assigned device, VPN source, export object, and time window align; elevated role use is a policy exception.",
    })
  ).snapshot.state.revision;
  revision = (
    await op(cloud, 8, "generate_case_report", "webmcp_callback", {
      expectedRevision: revision,
    })
  ).snapshot.state.revision;
  const final = await op(cloud, 9, "approve_case_report", "analyst_control", {
    expectedRevision: revision,
    reportId: "REPORT-CLOUD-0421",
    ...completeReportReview,
  });
  const { state, receipts } = final.snapshot;
  assert.equal(state.revision, 12);
  assert.equal(state.lifecycle, "closed_in_demo");
  assert.equal(state.decision.status, "authorized_exception");
  assert.equal(state.report.status, "approved_in_demo");
  assert.equal(state.report.report?.id, "REPORT-CLOUD-0421");
  assert.equal(
    state.report.analystClosureNote,
    completeReportReview.analystClosureNote,
  );
  assert.equal(
    state.report.report?.disposition,
    "authorized_activity_policy_exception",
  );
  assert.deepEqual(state.report.report?.actionIds, []);
  assert.equal(receipts.length, 13);
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

  let revision = 1;
  revision = (
    await prepareAndRunQuery(
      endpoint,
      3,
      "webmcp_callback",
      revision,
      "QRY-ENDPOINT-FILE-01",
    )
  ).snapshot.state.revision;
  rejected(
    await op(
      endpoint,
      4,
      "run_investigation_query",
      "webmcp_callback",
      {
        expectedRevision: 1,
        queryId: "QRY-ENDPOINT-HOST-02",
        queryText: getQueryConsoleContract("QRY-ENDPOINT-HOST-02")?.text ?? "",
      },
      false,
    ),
    "STALE_STATE",
    revision,
  );
  for (const [n, queryId] of [
    [5, "QRY-ENDPOINT-HASH-10"],
    [6, "QRY-ENDPOINT-HOST-02"],
    [7, "QRY-ENDPOINT-IDENTITY-03"],
    [8, "QRY-ENDPOINT-EGRESS-04"],
  ] as const) {
    revision = (
      await prepareAndRunQuery(
        endpoint,
        n,
        "webmcp_callback",
        revision,
        queryId,
      )
    ).snapshot.state.revision;
  }
  revision = (
    await op(endpoint, 9, "release_next_synthetic_signal", "analyst_control", {
      expectedRevision: revision,
    })
  ).snapshot.state.revision;
  revision = (
    await prepareAndRunQuery(
      endpoint,
      10,
      "webmcp_callback",
      revision,
      "QRY-ENDPOINT-APP-05",
    )
  ).snapshot.state.revision;
  rejected(
    await op(
      endpoint,
      11,
      "record_evidence_decision",
      "webmcp_callback",
      {
        expectedRevision: revision,
        decision: "confirmed_malicious",
        rationale: "Analyst-only decision boundary.",
      },
      false,
    ),
    "SURFACE_NOT_ALLOWED",
    revision,
  );
  revision = (
    await op(endpoint, 12, "record_evidence_decision", "analyst_control", {
      expectedRevision: revision,
      decision: "confirmed_malicious",
      rationale:
        "Unsigned execution, repeated egress, out-of-scope authentication, blocked remote service control, and a credential read meet the synthetic containment threshold.",
    })
  ).snapshot.state.revision;
  revision = (
    await op(endpoint, 13, "calculate_reachability", "webmcp_callback", {
      expectedRevision: revision,
      fromEntityId: "endpoint:fin-ws-044",
      maxDepth: 6,
    })
  ).snapshot.state.revision;
  revision = (
    await op(endpoint, 14, "simulate_control", "webmcp_callback", {
      expectedRevision: revision,
      control: "isolate_compromised_path",
    })
  ).snapshot.state.revision;

  const containment = await op(
    endpoint,
    15,
    "prepare_response_bundle",
    "webmcp_callback",
    { expectedRevision: revision, bundleId: "containment" },
  );
  revision = containment.snapshot.state.revision;
  const containmentProposalId = containment.snapshot.state.responseBundle?.id;
  assert.equal(typeof containmentProposalId, "string");
  rejected(
    await op(
      endpoint,
      16,
      "authorize_response_bundle",
      "webmcp_callback",
      {
        expectedRevision: revision,
        bundleId: "containment",
        proposalId: containmentProposalId,
        acknowledgement: "AUTHORIZE_SYNTHETIC_BUNDLE",
      },
      false,
    ),
    "SURFACE_NOT_ALLOWED",
    revision,
  );
  revision = (
    await op(endpoint, 17, "authorize_response_bundle", "analyst_control", {
      expectedRevision: revision,
      bundleId: "containment",
      proposalId: containmentProposalId,
      acknowledgement: "AUTHORIZE_SYNTHETIC_BUNDLE",
    })
  ).snapshot.state.revision;
  revision = (
    await op(endpoint, 18, "request_next_observation", "webmcp_callback", {
      expectedRevision: revision,
      stageId: "STREAM-LAT-02",
      rationale: "Request credential and workload recovery evidence.",
    })
  ).snapshot.state.revision;
  revision = (
    await op(endpoint, 19, "release_next_synthetic_signal", "analyst_control", {
      expectedRevision: revision,
    })
  ).snapshot.state.revision;
  revision = (
    await prepareAndRunQuery(
      endpoint,
      20,
      "webmcp_callback",
      revision,
      "QRY-ENDPOINT-SECRET-06",
    )
  ).snapshot.state.revision;
  revision = (
    await prepareAndRunQuery(
      endpoint,
      21,
      "webmcp_callback",
      revision,
      "QRY-ENDPOINT-WORKLOAD-07",
    )
  ).snapshot.state.revision;
  const recovery = await op(
    endpoint,
    22,
    "prepare_response_bundle",
    "webmcp_callback",
    { expectedRevision: revision, bundleId: "recovery" },
  );
  revision = recovery.snapshot.state.revision;
  const recoveryProposalId = recovery.snapshot.state.responseBundle?.id;
  assert.equal(typeof recoveryProposalId, "string");
  rejected(
    await op(
      endpoint,
      23,
      "authorize_response_bundle",
      "webmcp_callback",
      {
        expectedRevision: revision,
        bundleId: "recovery",
        proposalId: recoveryProposalId,
        acknowledgement: "AUTHORIZE_SYNTHETIC_BUNDLE",
      },
      false,
    ),
    "SURFACE_NOT_ALLOWED",
    revision,
  );
  revision = (
    await op(endpoint, 24, "authorize_response_bundle", "analyst_control", {
      expectedRevision: revision,
      bundleId: "recovery",
      proposalId: recoveryProposalId,
      acknowledgement: "AUTHORIZE_SYNTHETIC_BUNDLE",
    })
  ).snapshot.state.revision;
  const drafted = await op(
    endpoint,
    25,
    "generate_case_report",
    "webmcp_callback",
    { expectedRevision: revision },
  );
  revision = drafted.snapshot.state.revision;
  assert.equal(
    drafted.snapshot.state.report.report?.id,
    "REPORT-ENDPOINT-0448",
  );
  rejected(
    await op(
      endpoint,
      26,
      "approve_case_report",
      "webmcp_callback",
      {
        expectedRevision: revision,
        reportId: "REPORT-ENDPOINT-0448",
        ...completeReportReview,
      },
      false,
    ),
    "SURFACE_NOT_ALLOWED",
    revision,
  );
  const final = await op(
    endpoint,
    27,
    "approve_case_report",
    "analyst_control",
    {
      expectedRevision: revision,
      reportId: "REPORT-ENDPOINT-0448",
      ...completeReportReview,
    },
  );
  const { state } = final.snapshot;
  assert.equal(state.revision, 29);
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
    Array(6).fill("authorized_in_demo"),
  );
  assert.equal(state.report.status, "approved_in_demo");
  assert.equal(state.report.report?.id, "REPORT-ENDPOINT-0448");
  assert.equal(
    state.report.report?.disposition,
    "confirmed_malicious_synthetic",
  );
  assert.deepEqual(state.report.report?.actionIds, [
    "collect_endpoint_forensics",
    "contain_endpoint",
    "block_network_indicator",
    "disable_service_identity",
    "rotate_deployment_credential",
    "rollback_workload_image",
  ]);
  assert.equal(state.report.report?.evidenceIds.length, 27);
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

import assert from "node:assert/strict";
import type { CaseApiResponse, ToolApiResponse } from "../domain/api";
import { getQueryConsoleContract } from "../domain/query-console";
import { resolveRuntimeSmokeConfig } from "./runtime-smoke-config";

const runtimeConfig = resolveRuntimeSmokeConfig(process.env);
const baseUrl = runtimeConfig.baseUrl;
const authorization = runtimeConfig.authorization;
const cloud = "case-cloud-0421";
const endpoint = "case-endpoint-0448";
let cookie = "";
type Surface = "webmcp_callback" | "analyst_control";

async function smokeFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("accept")) headers.set("accept", "application/json");
  if (authorization) {
    headers.set("OAI-Sites-Authorization", authorization);
  }
  if (cookie) headers.set("cookie", cookie);
  return fetch(new URL(path, baseUrl), {
    ...init,
    headers,
    redirect: "error",
  });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await smokeFetch(path, init);
  rememberSessionCookie(response);
  const body: unknown = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return body as T;
}

function rememberSessionCookie(response: Response): void {
  const sessionCookie = response.headers
    .getSetCookie()
    .find(
      (value) =>
        value.startsWith("watchfloor_session=") ||
        value.startsWith("__Host-watchfloor_session="),
    );
  if (sessionCookie) cookie = sessionCookie.split(";", 1)[0] ?? cookie;
}

async function reset(caseId: string): Promise<CaseApiResponse> {
  const current = await request<CaseApiResponse>(`/api/cases/${caseId}`);
  return request(`/api/cases/${caseId}/reset`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({
      requestId: `smoke-reset-${caseId}-${crypto.randomUUID()}`,
      expectedRevision: current.snapshot.state.revision,
    }),
  });
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
  const channel =
    surface === "analyst_control" ? "analyst-operations" : "operations";
  const responseMessage = await smokeFetch(`/api/cases/${caseId}/${channel}`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({
      requestId: `smoke-${caseId}-${String(n).padStart(2, "0")}-${toolName}`,
      toolName,
      input: normalizedInput,
    }),
  });
  rememberSessionCookie(responseMessage);
  const body = (await responseMessage.json()) as
    ToolApiResponse | { error?: { code?: string; message?: string } };
  if (!responseMessage.ok) {
    assert.equal(ok, false, JSON.stringify(body));
    const current = await request<CaseApiResponse>(`/api/cases/${caseId}`);
    return {
      result: {
        ok: false,
        requestId: `smoke-${caseId}-${String(n).padStart(2, "0")}-${toolName}`,
        caseId,
        revision: current.snapshot.state.revision,
        error: {
          code:
            "error" in body ? (body.error?.code ?? "HTTP_ERROR") : "HTTP_ERROR",
          message:
            "error" in body
              ? (body.error?.message ?? "Operation was rejected.")
              : "Operation was rejected.",
          retryable: false,
        },
      },
      fixture: current.fixture,
      snapshot: current.snapshot,
      toolNames: current.toolNames,
    };
  }
  const response = body as ToolApiResponse;
  assert.equal(response.result.ok, ok, JSON.stringify(response.result));
  return response;
}

function mutationHeaders(): HeadersInit {
  return {
    "content-type": "application/json",
    origin: baseUrl.origin,
    "x-watchfloor-intent": "case-mutation-v1",
  };
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

function lineageData(response: ToolApiResponse) {
  if (!response.result.ok) {
    assert.fail(JSON.stringify(response.result));
  }
  return response.result.data as {
    currentRevision: number;
    queries: readonly {
      definition: { id: string };
      queryText: string;
    }[];
    records: readonly { id: string }[];
    receipts: readonly {
      id: string;
      requestId: string;
      toolName: string;
      baseRevision: number;
      resultRevision: number;
    }[];
    reportConsumers: readonly {
      reportId: string;
      evidenceId: string;
    }[];
    externalExecution: boolean;
  };
}

async function forgedEnvelope(): Promise<void> {
  const response = await smokeFetch(`/api/cases/${cloud}/operations`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({
      requestId: "smoke-forged-envelope",
      toolName: "get_case_context",
      reportedSurface: "analyst_control",
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
  assert.equal(retry.snapshot.receipts.length <= 1, true);

  let revision = 1;
  const identityQuery = await prepareAndRunQuery(
    cloud,
    2,
    "webmcp_callback",
    revision,
    "QRY-CLOUD-IDENTITY-01",
  );
  revision = identityQuery.snapshot.state.revision;
  const identityLineage = await op(
    cloud,
    "2l",
    "trace_evidence_lineage",
    "webmcp_callback",
    { targetType: "enrichment", targetId: "ENR-CLOUD-IDENTITY-01" },
  );
  const identityLineageData = lineageData(identityLineage);
  assert.equal(identityLineage.snapshot.state.revision, revision);
  assert.equal(
    identityLineage.snapshot.receipts.length >=
      identityQuery.snapshot.receipts.length &&
      identityLineage.snapshot.receipts.length <=
        identityQuery.snapshot.receipts.length + 1,
    true,
    "A lineage read may add one local audit receipt; anonymous sandbox reads remain non-durable.",
  );
  assert.deepEqual(
    identityLineageData.queries.map((query) => query.definition.id),
    ["QRY-CLOUD-IDENTITY-01"],
  );
  assert.equal(identityLineageData.records.length > 0, true);
  assert.equal(
    identityLineageData.receipts.some(
      (receipt) =>
        receipt.toolName === "run_investigation_query" &&
        receipt.requestId ===
          "smoke-case-cloud-0421-2r-run_investigation_query",
    ),
    true,
  );
  assert.equal(identityLineageData.externalExecution, false);
  revision = (
    await op(cloud, "2d", "attach_discovery_stage", "webmcp_callback", {
      expectedRevision: revision,
      stageId: "DISCOVERY-CLOUD-01",
      rationale:
        "Attach the managed endpoint attribution supported by the identity query records.",
    })
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
  revision = (
    await op(cloud, "5d", "attach_discovery_stage", "webmcp_callback", {
      expectedRevision: revision,
      stageId: "DISCOVERY-CLOUD-02",
      rationale:
        "Attach the approved export role identified by the role and object query records.",
    })
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
    "ANALYST_CONTROL_REQUIRED",
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
  assert.equal(state.revision, 14);
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
  assert.equal(receipts.length >= state.revision - 1, true);
  assert.equal(receipts.length <= state.revision + 1, true);
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
  assert.equal(retry.snapshot.receipts.length <= 1, true);
  rejected(
    await op(
      endpoint,
      2,
      "release_next_synthetic_signal",
      "webmcp_callback",
      { expectedRevision: 1 },
      false,
    ),
    "ANALYST_CONTROL_REQUIRED",
    1,
  );
  rejected(
    await op(
      endpoint,
      "2l",
      "trace_evidence_lineage",
      "webmcp_callback",
      { targetType: "event", targetId: "EVT-EDR-0448-10" },
      false,
    ),
    "LINEAGE_NOT_AVAILABLE",
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
    await op(endpoint, 9, "attach_discovery_stage", "webmcp_callback", {
      expectedRevision: revision,
      stageId: "STREAM-LAT-01",
      rationale:
        "The identity query and service scope evidence support adding the blocked remote-service discovery.",
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
    "ANALYST_CONTROL_REQUIRED",
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
    "ANALYST_CONTROL_REQUIRED",
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
  const observationRequest = await op(
    endpoint,
    18,
    "request_next_observation",
    "webmcp_callback",
    {
      expectedRevision: revision,
      stageId: "STREAM-LAT-02",
      rationale:
        "Approved containment and application-host evidence support requesting the bounded recovery telemetry.",
    },
  );
  revision = observationRequest.snapshot.state.revision;
  assert.equal(
    observationRequest.snapshot.state.observationRequest?.status,
    "pending",
  );
  const observationRelease = await op(
    endpoint,
    19,
    "release_next_synthetic_signal",
    "analyst_control",
    { expectedRevision: revision },
  );
  revision = observationRelease.snapshot.state.revision;
  assert.equal(
    observationRelease.snapshot.state.observationRequest?.status,
    "released",
  );
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
    "ANALYST_CONTROL_REQUIRED",
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
  const reportLineage = await op(
    endpoint,
    "25l",
    "trace_evidence_lineage",
    "webmcp_callback",
    { targetType: "report_finding", targetId: "ENR-LAT-FILE-01" },
  );
  const reportLineageResult = lineageData(reportLineage);
  assert.equal(reportLineage.snapshot.state.revision, revision);
  assert.equal(
    reportLineage.snapshot.receipts.length >=
      drafted.snapshot.receipts.length &&
      reportLineage.snapshot.receipts.length <=
        drafted.snapshot.receipts.length + 1,
    true,
    "A report-lineage read may add one local audit receipt; anonymous sandbox reads remain non-durable.",
  );
  assert.equal(
    reportLineageResult.reportConsumers.some(
      (consumer) =>
        consumer.reportId === "REPORT-ENDPOINT-0448" &&
        consumer.evidenceId === "ENR-LAT-FILE-01",
    ),
    true,
  );
  assert.equal(
    reportLineageResult.receipts.some(
      (receipt) => receipt.toolName === "generate_case_report",
    ),
    true,
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
    "ANALYST_CONTROL_REQUIRED",
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
  assert.equal(state.report.report?.evidenceIds.length, 29);
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
  "Server/API smoke passed: all catalog queries, both deterministic case lifecycles, release-bounded evidence lineage, trusted receipt references, idempotency, forged envelope, stale-state, WebMCP/analyst boundaries, exact report closure, and final reset. Native WebMCP registration and callbacks are not exercised by this check.",
);

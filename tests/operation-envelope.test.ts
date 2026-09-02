import assert from "node:assert/strict";
import test from "node:test";
import { parseOperationEnvelope } from "../server/operation-envelope";
import { deriveReceiptReferences } from "../domain/receipt-lineage";

const analystTools = [
  "release_next_synthetic_signal",
  "authorize_response_action",
  "authorize_response_bundle",
  "record_evidence_decision",
  "approve_case_report",
] as const;

test("the public operation envelope cannot select its own authority surface", () => {
  const forged = parseOperationEnvelope(
    {
      requestId: "forged-authority-001",
      toolName: "get_case_context",
      reportedSurface: "analyst_control",
      input: {},
    },
    "webmcp_callback",
  );
  assert.equal(forged.ok, false);
  if (!forged.ok) assert.equal(forged.code, "INVALID_REQUEST");
});

test("all analyst authority tools are denied on the WebMCP route", () => {
  for (const [index, toolName] of analystTools.entries()) {
    const parsed = parseOperationEnvelope(
      {
        requestId: `agent-authority-${index}`,
        toolName,
        input: { expectedRevision: 1 },
      },
      "webmcp_callback",
    );
    assert.equal(parsed.ok, false, toolName);
    if (!parsed.ok) {
      assert.equal(parsed.status, 403, toolName);
      assert.equal(parsed.code, "ANALYST_CONTROL_REQUIRED", toolName);
    }
  }
});

test("the server derives the surface for each trusted route", () => {
  const body = {
    requestId: "server-surface-001",
    toolName: "get_case_context",
    input: {},
  };
  const webmcp = parseOperationEnvelope(body, "webmcp_callback");
  const analyst = parseOperationEnvelope(body, "analyst_control");
  assert.equal(webmcp.ok, true);
  assert.equal(analyst.ok, true);
  if (webmcp.ok) {
    assert.equal(webmcp.request.reportedSurface, "webmcp_callback");
  }
  if (analyst.ok) {
    assert.equal(analyst.request.reportedSurface, "analyst_control");
  }
});

test("evidence lineage accepts only the typed public lookup input", () => {
  const parsed = parseOperationEnvelope(
    {
      requestId: "lineage-read-001",
      toolName: "trace_evidence_lineage",
      input: { targetType: "entity", targetId: "endpoint:fin-ws-044" },
    },
    "webmcp_callback",
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.request.reportedSurface, "webmcp_callback");
    assert.deepEqual(parsed.request.input, {
      targetType: "entity",
      targetId: "endpoint:fin-ws-044",
    });
  }
});

test("a successful investigation plan receipt links its exact query artifacts and records", () => {
  const references = deriveReceiptReferences(
    JSON.stringify({ expectedRevision: 2, planId: "tier1_initial" }),
    JSON.stringify({
      ok: true,
      requestId: "plan-lineage-001",
      caseId: "case-endpoint-0448",
      revision: 3,
      data: {
        planId: "tier1_initial",
        queryId: "QRY-ENDPOINT-FILE-01",
        targetEntityId: "file:invoice-sync-helper",
        artifact: {
          id: "ENR-LAT-FILE-01",
          entityId: "file:invoice-sync-helper",
        },
        returnedRecords: [
          {
            id: "REC-ENDPOINT-FILE-01",
            entityIds: ["file:invoice-sync-helper", "endpoint:fin-ws-044"],
          },
        ],
      },
    }),
  );
  assert.deepEqual(references, {
    eventIds: [],
    entityIds: ["file:invoice-sync-helper", "endpoint:fin-ws-044"],
    relationshipIds: [],
    enrichmentIds: ["ENR-LAT-FILE-01"],
    queryIds: ["QRY-ENDPOINT-FILE-01"],
    recordIds: ["REC-ENDPOINT-FILE-01"],
    discoveryIds: [],
    reportIds: [],
    actionIds: [],
  });
});

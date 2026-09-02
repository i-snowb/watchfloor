import {
  isAnalystAuthorityToolName,
  isCaseToolName,
  validateRequestId,
  type CaseToolRequest,
  type ToolSurface,
} from "@/domain/operations";

const envelopeKeys = ["requestId", "toolName", "input"];

export type OperationEnvelopeResult =
  | { ok: true; request: CaseToolRequest }
  | {
      ok: false;
      status: 400 | 403;
      code: "ANALYST_CONTROL_REQUIRED" | "INVALID_REQUEST";
      message: string;
    };

export function parseOperationEnvelope(
  body: Record<string, unknown>,
  serverSurface: ToolSurface,
): OperationEnvelopeResult {
  const unknownKey = Object.keys(body).find(
    (key) => !envelopeKeys.includes(key),
  );
  const input = body.input;
  if (
    unknownKey ||
    !validateRequestId(body.requestId) ||
    !isCaseToolName(body.toolName) ||
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_REQUEST",
      message: "Operation envelope is invalid.",
    };
  }
  if (
    serverSurface === "webmcp_callback" &&
    isAnalystAuthorityToolName(body.toolName)
  ) {
    return {
      ok: false,
      status: 403,
      code: "ANALYST_CONTROL_REQUIRED",
      message: "This decision requires the case analyst control.",
    };
  }
  return {
    ok: true,
    request: {
      requestId: body.requestId,
      toolName: body.toolName,
      reportedSurface: serverSurface,
      input: input as Record<string, unknown>,
    },
  };
}

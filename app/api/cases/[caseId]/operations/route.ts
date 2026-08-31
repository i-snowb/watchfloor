import {
  isAnalystAuthorityToolName,
  isCaseToolName,
  validateRequestId,
  type CaseToolRequest,
} from "@/domain/operations";
import { getCaseFixture } from "@/domain/scenarios";
import { authorizeCaseRequest } from "@/server/case-request";
import { executeStoredTool } from "@/server/case-store";
import { jsonResponse, readJsonObject } from "@/server/http";

interface RouteContext {
  params: Promise<{ caseId: string }>;
}

const envelopeKeys = ["requestId", "toolName", "reportedSurface", "input"];

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const authorization = await authorizeCaseRequest(request);
  if (!authorization.ok) return authorization.response;
  const { caseId } = await context.params;
  const fixture = getCaseFixture(caseId);
  const { session } = authorization;
  if (!fixture) {
    return jsonResponse(
      request,
      session,
      { error: { code: "CASE_NOT_FOUND", message: "Case was not found." } },
      404,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(request);
  } catch (error) {
    const tooLarge =
      error instanceof Error && error.message === "REQUEST_TOO_LARGE";
    return jsonResponse(
      request,
      session,
      {
        error: {
          code: tooLarge ? "REQUEST_TOO_LARGE" : "INVALID_REQUEST",
          message: tooLarge
            ? "Request body exceeds 16 KiB."
            : "Request body must be a JSON object.",
        },
      },
      tooLarge ? 413 : 400,
    );
  }

  const unknownKey = Object.keys(body).find(
    (key) => !envelopeKeys.includes(key),
  );
  const input = body.input;
  if (
    unknownKey ||
    !validateRequestId(body.requestId) ||
    !isCaseToolName(body.toolName) ||
    (body.reportedSurface !== "webmcp_callback" &&
      body.reportedSurface !== "analyst_control") ||
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    return jsonResponse(
      request,
      session,
      {
        error: {
          code: "INVALID_REQUEST",
          message: "Operation envelope is invalid.",
        },
      },
      400,
    );
  }

  const operationRequest: CaseToolRequest = {
    requestId: body.requestId,
    toolName: body.toolName,
    reportedSurface: body.reportedSurface,
    input: input as Record<string, unknown>,
  };

  if (
    isAnalystAuthorityToolName(operationRequest.toolName) &&
    authorization.principal.role !== "analyst"
  ) {
    return jsonResponse(
      request,
      session,
      {
        error: {
          code: "ANALYST_AUTH_REQUIRED",
          message: "Authenticated analyst access is required.",
        },
      },
      403,
    );
  }

  try {
    const response = await executeStoredTool(
      session.id,
      fixture,
      operationRequest,
    );
    return jsonResponse(request, session, response);
  } catch {
    return jsonResponse(
      request,
      session,
      {
        error: {
          code: "OPERATION_UNAVAILABLE",
          message: "The operation could not be completed.",
        },
      },
      503,
    );
  }
}

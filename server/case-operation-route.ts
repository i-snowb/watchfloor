import { env } from "cloudflare:workers";
import { type ToolSurface } from "@/domain/operations";
import { getCaseFixture } from "@/domain/scenarios";
import { authorizeCaseRequest } from "@/server/case-request";
import { executeStoredTool } from "@/server/case-store";
import { jsonResponse, readJsonObject } from "@/server/http";
import { enforcePublicMutationRateLimits } from "@/server/request-limits";
import { requireMutationIntent } from "@/server/request-security";
import { parseOperationEnvelope } from "@/server/operation-envelope";

export async function handleCaseOperation(
  request: Request,
  caseId: string,
  serverSurface: ToolSurface,
): Promise<Response> {
  const mutationIntent = requireMutationIntent(request);
  if (!mutationIntent.ok) {
    return jsonResponse(
      request,
      null,
      {
        error: {
          code: mutationIntent.code,
          message: mutationIntent.message,
        },
      },
      403,
    );
  }

  const authorization = await authorizeCaseRequest(request);
  if (!authorization.ok) return authorization.response;
  const { principal, session } = authorization;
  const rateLimit = await enforcePublicMutationRateLimits(
    request,
    session,
    principal,
    env,
  );
  if (!rateLimit.ok) {
    const response = jsonResponse(
      request,
      session,
      { error: { code: rateLimit.code, message: rateLimit.message } },
      rateLimit.status,
    );
    if (rateLimit.retryAfterSeconds) {
      response.headers.set("retry-after", String(rateLimit.retryAfterSeconds));
    }
    return response;
  }

  const fixture = getCaseFixture(caseId);
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

  const envelope = parseOperationEnvelope(body, serverSurface);
  if (!envelope.ok) {
    return jsonResponse(
      request,
      session,
      {
        error: {
          code: envelope.code,
          message: envelope.message,
        },
      },
      envelope.status,
    );
  }

  try {
    const response = await executeStoredTool(
      session.id,
      fixture,
      envelope.request,
      principal.assurance,
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

import { env } from "cloudflare:workers";
import { type ToolSurface } from "@/domain/operations";
import { getCaseFixture } from "@/domain/scenarios";
import { authorizeCaseRequest } from "@/server/case-request";
import { executeStoredTool } from "@/server/case-store";
import { jsonResponse, readJsonObject } from "@/server/http";
import { enforcePublicMutationRateLimits } from "@/server/request-limits";
import { requireMutationIntent } from "@/server/request-security";
import { parseOperationEnvelope } from "@/server/operation-envelope";
import { projectPublicCaseView } from "@/server/public-case-view-only";

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
    return jsonResponse(request, session, {
      ...projectPublicCaseView(fixture, response.snapshot),
      result: response.result,
    });
  } catch (error) {
    const storageCode =
      error instanceof Error ? error.message : "OPERATION_UNAVAILABLE";
    const admissionLimited =
      storageCode === "PUBLIC_SESSION_ADMISSION_RATE_LIMITED";
    const atCapacity = storageCode === "PUBLIC_SANDBOX_AT_CAPACITY";
    const code = admissionLimited
      ? "PUBLIC_SESSION_ADMISSION_RATE_LIMITED"
      : atCapacity
        ? "PUBLIC_SANDBOX_AT_CAPACITY"
        : "OPERATION_UNAVAILABLE";
    const responseSession =
      admissionLimited || atCapacity
        ? session.isNew
          ? null
          : session
        : session;
    const response = jsonResponse(
      request,
      responseSession,
      {
        error: {
          code,
          message: admissionLimited
            ? "New public sandbox sessions are temporarily limited. Try again shortly."
            : atCapacity
              ? "The public sandbox is at active-session capacity. Try again later."
              : "The operation could not be completed.",
        },
      },
      admissionLimited ? 429 : 503,
    );
    if (admissionLimited) response.headers.set("retry-after", "60");
    return response;
  }
}

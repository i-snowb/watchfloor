import { env } from "cloudflare:workers";
import { validateRequestId } from "@/domain/operations";
import { getCaseFixture } from "@/domain/scenarios";
import { authorizeCaseRequest } from "@/server/case-request";
import { resetCase } from "@/server/case-store";
import { jsonResponse, readJsonObject } from "@/server/http";
import { enforcePublicMutationRateLimits } from "@/server/request-limits";
import { requireMutationIntent } from "@/server/request-security";

interface RouteContext {
  params: Promise<{ caseId: string }>;
}

export async function POST(
  request: Request,
  context: RouteContext,
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

  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(request, 1_024);
  } catch {
    return jsonResponse(
      request,
      session,
      {
        error: {
          code: "INVALID_REQUEST",
          message: "Reset request must be a JSON object.",
        },
      },
      400,
    );
  }
  if (
    Object.keys(body).some(
      (key) => key !== "requestId" && key !== "expectedRevision",
    ) ||
    !validateRequestId(body.requestId) ||
    !Number.isInteger(body.expectedRevision) ||
    (body.expectedRevision as number) < 1
  ) {
    return jsonResponse(
      request,
      session,
      {
        error: {
          code: "INVALID_REQUEST",
          message: "Reset request is invalid.",
        },
      },
      400,
    );
  }

  const { caseId } = await context.params;
  const fixture = getCaseFixture(caseId);
  if (!fixture) {
    return jsonResponse(
      request,
      session,
      { error: { code: "CASE_NOT_FOUND", message: "Case was not found." } },
      404,
    );
  }

  try {
    const snapshot = await resetCase(
      session.id,
      fixture,
      body.requestId,
      body.expectedRevision as number,
      principal.assurance === "anonymous_sandbox",
    );
    return jsonResponse(request, session, { snapshot });
  } catch (error) {
    const code = error instanceof Error ? error.message : "RESET_UNAVAILABLE";
    const conflict = code === "RESET_REVISION_CONFLICT";
    const limited = code === "SESSION_RESET_LIMIT_REACHED";
    return jsonResponse(
      request,
      session,
      {
        error: {
          code,
          message: conflict
            ? "The case changed before reset. Refresh and try again."
            : limited
              ? "This sandbox session reached its reset limit."
              : "The case could not be reset.",
        },
      },
      conflict ? 409 : limited ? 429 : 503,
    );
  }
}

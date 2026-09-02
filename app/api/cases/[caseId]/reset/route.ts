import { env } from "cloudflare:workers";
import { validateRequestId } from "@/domain/operations";
import { getCaseFixture } from "@/domain/scenarios";
import { authorizeCaseRequest } from "@/server/case-request";
import { resetCase } from "@/server/case-store";
import { jsonResponse, readJsonObject } from "@/server/http";
import { enforcePublicMutationRateLimits } from "@/server/request-limits";
import { requireMutationIntent } from "@/server/request-security";
import { projectPublicCaseView } from "@/server/public-case-view-only";

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
    return jsonResponse(
      request,
      session,
      projectPublicCaseView(fixture, snapshot),
    );
  } catch (error) {
    const storageCode =
      error instanceof Error ? error.message : "RESET_UNAVAILABLE";
    const conflict = storageCode === "RESET_REVISION_CONFLICT";
    const limited = storageCode === "SESSION_RESET_LIMIT_REACHED";
    const admissionLimited =
      storageCode === "PUBLIC_SESSION_ADMISSION_RATE_LIMITED";
    const atCapacity = storageCode === "PUBLIC_SANDBOX_AT_CAPACITY";
    const code = conflict
      ? "RESET_REVISION_CONFLICT"
      : limited
        ? "SESSION_RESET_LIMIT_REACHED"
        : admissionLimited
          ? "PUBLIC_SESSION_ADMISSION_RATE_LIMITED"
          : atCapacity
            ? "PUBLIC_SANDBOX_AT_CAPACITY"
            : "RESET_UNAVAILABLE";
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
          message: conflict
            ? "The case changed before reset. Refresh and try again."
            : limited
              ? "This sandbox session reached its reset limit."
              : admissionLimited
                ? "New public sandbox sessions are temporarily limited. Try again shortly."
                : atCapacity
                  ? "The public sandbox is at active-session capacity. Try again later."
                  : "The case could not be reset.",
        },
      },
      conflict || limited || admissionLimited ? (conflict ? 409 : 429) : 503,
    );
    if (admissionLimited) response.headers.set("retry-after", "60");
    return response;
  }
}

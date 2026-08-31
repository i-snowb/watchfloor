import { getCaseFixture } from "@/domain/scenarios";
import { resetCase } from "@/server/case-store";
import { authorizeCaseRequest } from "@/server/case-request";
import { jsonResponse } from "@/server/http";

interface RouteContext {
  params: Promise<{ caseId: string }>;
}

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

  try {
    const snapshot = await resetCase(session.id, fixture);
    return jsonResponse(request, session, { snapshot });
  } catch {
    return jsonResponse(
      request,
      session,
      {
        error: {
          code: "RESET_UNAVAILABLE",
          message: "The case could not be reset.",
        },
      },
      503,
    );
  }
}

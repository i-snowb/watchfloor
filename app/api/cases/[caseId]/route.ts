import { getCaseFixture } from "@/domain/scenarios";
import { loadCaseSnapshot } from "@/server/case-store";
import { authorizeCaseRequest } from "@/server/case-request";
import { jsonResponse } from "@/server/http";

interface RouteContext {
  params: Promise<{ caseId: string }>;
}

export const dynamic = "force-dynamic";

export async function GET(
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
    const snapshot = await loadCaseSnapshot(session.id, fixture);
    return jsonResponse(request, session, { snapshot });
  } catch {
    return jsonResponse(
      request,
      session,
      {
        error: {
          code: "CASE_STORAGE_UNAVAILABLE",
          message: "Case state is temporarily unavailable.",
        },
      },
      503,
    );
  }
}

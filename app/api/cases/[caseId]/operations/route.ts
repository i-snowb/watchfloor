import { handleCaseOperation } from "@/server/case-operation-route";

interface RouteContext {
  params: Promise<{ caseId: string }>;
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { caseId } = await context.params;
  return handleCaseOperation(request, caseId, "webmcp_callback");
}

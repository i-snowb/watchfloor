import type { CaseApiResponse, ToolApiResponse } from "@/domain/api";
import type { CaseToolName, ToolSurface } from "@/domain/operations";

export async function loadCase(
  caseId: string,
  signal?: AbortSignal,
): Promise<CaseApiResponse> {
  return requestJson<CaseApiResponse>(
    `/api/cases/${encodeURIComponent(caseId)}`,
    {
      method: "GET",
      ...(signal ? { signal } : {}),
    },
  );
}

export async function executeTool(
  caseId: string,
  toolName: CaseToolName,
  reportedSurface: ToolSurface,
  input: Record<string, unknown>,
  requestId = `ui-${crypto.randomUUID()}`,
  signal?: AbortSignal,
): Promise<ToolApiResponse> {
  return requestJson<ToolApiResponse>(
    `/api/cases/${encodeURIComponent(caseId)}/operations`,
    {
      method: "POST",
      body: JSON.stringify({ requestId, toolName, reportedSurface, input }),
      headers: { "content-type": "application/json" },
      ...(signal ? { signal } : {}),
    },
  );
}

export async function resetCase(caseId: string): Promise<CaseApiResponse> {
  return requestJson<CaseApiResponse>(
    `/api/cases/${encodeURIComponent(caseId)}/reset`,
    { method: "POST" },
  );
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: { accept: "application/json", ...init.headers },
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const message =
      readErrorMessage(data) ?? `Request failed with ${response.status}.`;
    throw new Error(message);
  }
  return data as T;
}

function readErrorMessage(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null;
  const error = (value as { error?: unknown }).error;
  if (error === null || typeof error !== "object") return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}

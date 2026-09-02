import type { CaseSnapshot } from "./types";

export interface ApiError {
  code: string;
  message: string;
  retryable: boolean;
  recovery?: {
    toolName: string;
    input: Record<string, unknown>;
    validForRevision: number;
  };
}

export type ToolApiResult =
  | {
      ok: true;
      requestId: string;
      caseId: string;
      revision: number;
      data: unknown;
    }
  | {
      ok: false;
      requestId: string;
      caseId: string;
      revision: number;
      error: ApiError;
    };

export interface CaseApiResponse {
  snapshot: CaseSnapshot;
}

export interface ToolApiResponse extends CaseApiResponse {
  result: ToolApiResult;
}

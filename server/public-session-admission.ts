export const MAX_ACTIVE_PUBLIC_SESSIONS = 10_000;
export const PUBLIC_SESSION_TTL_MS = 24 * 60 * 60 * 1_000;
export const PUBLIC_SESSION_ADMISSION_WINDOW_MS = 60_000;
export const PUBLIC_SESSION_ADMISSION_LIMIT = 6;

export type PublicSessionAdmissionDecision =
  "admit" | "capacity" | "rate_limited";

export function classifyPublicSessionAdmission(
  activeCount: number,
  recentCount: number,
): PublicSessionAdmissionDecision {
  if (activeCount >= MAX_ACTIVE_PUBLIC_SESSIONS) return "capacity";
  if (recentCount >= PUBLIC_SESSION_ADMISSION_LIMIT) return "rate_limited";
  return "admit";
}

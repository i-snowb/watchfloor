export const mutationIntentHeader = "x-watchfloor-intent";
export const mutationIntentValue = "case-mutation-v1";

export type MutationIntentResult =
  | { ok: true }
  | {
      ok: false;
      code: "MUTATION_INTENT_REQUIRED";
      message: string;
    };

export function requireMutationIntent(request: Request): MutationIntentResult {
  const expectedOrigin = new URL(request.url).origin;
  const suppliedOrigin = request.headers.get("origin");
  const intent = request.headers.get(mutationIntentHeader);
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    suppliedOrigin !== expectedOrigin ||
    intent !== mutationIntentValue ||
    (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none")
  ) {
    return {
      ok: false,
      code: "MUTATION_INTENT_REQUIRED",
      message: "A same-origin case action is required.",
    };
  }
  return { ok: true };
}

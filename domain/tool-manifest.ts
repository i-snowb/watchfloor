import type { CaseToolName } from "./operations";

/**
 * Stable case-route capabilities. The operation layer decides whether a tool
 * is currently applicable. Keeping this manifest independent from fixtures
 * prevents unreleased scenario branches from changing browser-visible
 * metadata.
 */
const publicCaseToolManifest = [
  "get_case_context",
  "get_case_delta",
  "inspect_event",
  "inspect_entity",
  "inspect_relationship",
  "trace_evidence_lineage",
  "focus_entity",
  "search_events",
  "find_first_occurrence",
  "compare_timepoints",
  "query_related_activity",
  "propose_investigation_step",
  "generate_case_report",
  "list_investigation_skills",
  "prepare_investigation_query",
  "run_investigation_query",
  "run_investigation_plan",
  "calculate_reachability",
  "simulate_control",
  "attach_discovery_stage",
  "request_next_observation",
  "propose_response_action",
  "simulate_response_action",
  "prepare_response_bundle",
] as const satisfies readonly CaseToolName[];

export function getCaseToolManifest(): readonly CaseToolName[] {
  return publicCaseToolManifest;
}

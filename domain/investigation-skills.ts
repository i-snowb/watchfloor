import type {
  ApprovedInvestigationSkill,
  CaseFixture,
  CaseState,
  InvestigationQueryDefinition,
} from "./types";

/**
 * Approved skills are an allowlist over case-defined query contracts. Their
 * stable identifiers deliberately equal their query IDs, so a caller cannot
 * substitute an arbitrary query after choosing a skill.
 */
export function getApprovedInvestigationSkills(
  fixture: CaseFixture,
  state: CaseState,
): readonly ApprovedInvestigationSkill[] {
  return fixture.investigationQueries.map((query) =>
    describeApprovedInvestigationSkill(query, state),
  );
}

export function describeApprovedInvestigationSkill(
  query: InvestigationQueryDefinition,
  state: CaseState,
): ApprovedInvestigationSkill {
  const available =
    query.requiresStageId === null ||
    state.releasedStreamStageIds.includes(query.requiresStageId);
  return {
    id: query.id,
    version: "1.0",
    title: query.title,
    objective: query.objective,
    question: query.question,
    queryId: query.id,
    targetEntityId: query.targetEntityId,
    sourceLabels: query.sourceScopes.map((scope) => scope.sourceLabel),
    availability: available ? "available" : "blocked",
    constraint: available
      ? null
      : "Required synthetic telemetry has not been released to this case.",
  };
}

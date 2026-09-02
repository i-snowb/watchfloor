import type { PublicCaseFixture } from "@/domain/public-view";

export type QueueFixtureUpdate = {
  caseId: string;
  fixture: PublicCaseFixture;
};

/**
 * Preserve the existing array when a queue refresh contains no newer public
 * projections. AlertWorkspace uses the fixture identity to scope WebMCP tool
 * registration, so a no-op refresh must not cause tool re-registration.
 */
export function reconcileQueueFixtures(
  current: readonly PublicCaseFixture[],
  updates: readonly QueueFixtureUpdate[],
): readonly PublicCaseFixture[] {
  const updatesByCaseId = new Map(
    updates.map((update) => [update.caseId, update.fixture]),
  );
  let changed = false;
  const next = current.map((fixture) => {
    const updated = updatesByCaseId.get(fixture.id);
    if (!updated || updated.projectionRevision <= fixture.projectionRevision) {
      return fixture;
    }
    changed = true;
    return updated;
  });
  return changed ? next : current;
}

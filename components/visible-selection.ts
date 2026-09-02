import { getVisibleEntities } from "@/domain/incident-stream";
import type { CaseFixture, CaseState } from "@/domain/types";

export function isVisibleEntity(
  fixture: CaseFixture,
  state: CaseState,
  entityId: string,
): boolean {
  return getVisibleEntities(fixture, state).some(
    (entity) => entity.id === entityId,
  );
}

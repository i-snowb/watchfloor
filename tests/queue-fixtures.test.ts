import assert from "node:assert/strict";
import test from "node:test";
import { reconcileQueueFixtures } from "../lib/queue-fixtures";
import { getAllFixtures } from "../domain/scenarios";
import type { PublicCaseFixture } from "../domain/public-view";
import type { CaseFixture } from "../domain/types";

function publicFixture(
  fixture: CaseFixture,
  projectionRevision = 1,
): PublicCaseFixture {
  return {
    ...fixture,
    publicProjection: true,
    projectionRevision,
  };
}

test("queue refresh preserves fixture identity when no newer public projection exists", () => {
  const source = getAllFixtures();
  const fixtures = source.slice(0, 2).map((fixture) => publicFixture(fixture));
  const next = reconcileQueueFixtures(
    fixtures,
    fixtures.map((fixture) => ({
      caseId: fixture.id,
      fixture: { ...fixture },
    })),
  );

  assert.equal(next, fixtures);
});

test("queue refresh replaces only fixtures with a newer public projection", () => {
  const source = getAllFixtures();
  const fixtures = source.slice(0, 2).map((fixture) => publicFixture(fixture));
  const updated = publicFixture(source[0]!, 2);
  const next = reconcileQueueFixtures(fixtures, [
    { caseId: updated.id, fixture: updated },
  ]);

  assert.notEqual(next, fixtures);
  assert.equal(next[0], updated);
  assert.equal(next[1], fixtures[1]);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCausalPhasePlanes,
  buildDirectionalImpactEnvelope,
  buildEvidenceReplayPlan,
  buildImpactLayout,
  findReplayStepForEntity,
  getCausalVisualState,
  getReplayEntityIds,
} from "../components/evidence-visualization";
import { cloudIdentityScenario } from "../domain/scenarios/cloud-identity";
import { endpointLateralScenario } from "../domain/scenarios/endpoint-lateral";

test("evidence replay follows deterministic join order", () => {
  const fixture = endpointLateralScenario;
  const plan = buildEvidenceReplayPlan(fixture.entities, [
    fixture.joins[2]!,
    fixture.joins[0]!,
    fixture.joins[1]!,
  ]);

  assert.deepEqual(
    plan.joins.map((join) => join.id),
    ["JOIN-LAT-01", "JOIN-LAT-02", "JOIN-LAT-03"],
  );
  assert.deepEqual(
    [
      ...getReplayEntityIds(
        plan,
        0,
        fixture.entities.map(({ id }) => id),
      ),
    ],
    [
      "file:invoice-sync-helper",
      "endpoint:app-srv-021",
      "secret:ci-deploy-token",
      "workload:billing-api",
    ],
  );
  assert.equal(findReplayStepForEntity(plan, "indicator:203.0.113.91"), 2);
  assert.equal(
    getReplayEntityIds(
      plan,
      plan.joins.length,
      fixture.entities.map(({ id }) => id),
    ).size,
    fixture.entities.length,
  );
});

test("impact layout derives stable hop depth from reachability segments", () => {
  const fixture = endpointLateralScenario;
  const layout = buildImpactLayout(fixture, fixture.entities);

  assert.equal(layout.hops.get(fixture.reachability.sourceEntityId), 0);
  assert.equal(layout.hops.get("identity:svc-fin-reports"), 1);
  assert.equal(layout.hops.get("endpoint:app-srv-021"), 2);
  assert.equal(layout.hops.get("secret:ci-deploy-token"), 2);
  assert.equal(layout.hops.get("workload:billing-api"), 3);
  assert.equal(
    layout.positions.get("file:invoice-sync-helper")?.role,
    "context",
  );
  assert.deepEqual(
    layout.rings.map((ring) => ring.hop),
    [1, 2, 3],
  );
});

test("cloud reachability preserves shared prefixes without extra depth", () => {
  const fixture = cloudIdentityScenario;
  const layout = buildImpactLayout(fixture, fixture.entities);

  assert.equal(layout.hops.get("identity:jdoe"), 0);
  assert.equal(layout.hops.get("session:okta-921"), 1);
  assert.equal(layout.hops.get("role:prod-admin"), 2);
  assert.equal(layout.hops.get("secret:prod-db-primary"), 3);
  assert.equal(layout.hops.get("object:customer-export"), 3);
});

test("causal field lanes are stable and directional impact envelopes follow hops", () => {
  const fixture = endpointLateralScenario;
  const phasePlanes = buildCausalPhasePlanes(fixture);
  const envelope = buildDirectionalImpactEnvelope(
    buildImpactLayout(fixture, fixture.entities),
  );

  assert.deepEqual(
    phasePlanes.map((plane) => plane.lane),
    ["entry", "execution", "access", "lateral", "impact"],
  );
  assert.deepEqual(
    envelope.map((segment) => segment.hop),
    [1, 2, 3],
  );
  assert.ok(envelope.every((segment) => segment.path.includes("A ")));
});

test("causal visual state prioritizes verified control over modeled uncertainty", () => {
  assert.equal(
    getCausalVisualState({
      contained: true,
      disputed: true,
      modeled: true,
      prevented: true,
    }),
    "contained",
  );
  assert.equal(
    getCausalVisualState({
      contained: false,
      disputed: true,
      modeled: true,
      prevented: true,
    }),
    "prevented",
  );
  assert.equal(
    getCausalVisualState({
      contained: false,
      disputed: true,
      modeled: true,
      prevented: false,
    }),
    "disputed",
  );
});

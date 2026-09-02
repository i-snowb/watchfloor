import assert from "node:assert/strict";
import test from "node:test";
import { getSelectionContent } from "../components/case-inspector";
import { isVisibleEntity } from "../components/visible-selection";
import { createInitialCaseState } from "../domain/operations";
import { endpointLateralScenario } from "../domain/scenarios/endpoint-lateral";

test("priority risk route opens as an aggregate model record", () => {
  const fixture = endpointLateralScenario;
  const state = createInitialCaseState(fixture);
  const route = fixture.impact.threatOverlay!.priorityRoute;

  const active = getSelectionContent(fixture, state, {
    kind: "model",
    id: route.id,
  });

  assert.ok(active);
  assert.equal(active.title, "Highest potential consequence");
  assert.equal(active.relatedEntities.length, 4);
  assert.deepEqual(
    active.fields.find((field) => field.label === "Control state"),
    { label: "Control state", value: "Active" },
  );

  state.responseActions = state.responseActions.map((action) => ({
    ...action,
    status: [
      "contain_endpoint",
      "disable_service_identity",
      "rotate_deployment_credential",
    ].includes(action.actionId)
      ? "authorized_in_demo"
      : action.status,
  }));

  const controlled = getSelectionContent(fixture, state, {
    kind: "model",
    id: route.id,
  });
  assert.ok(controlled);
  assert.deepEqual(
    controlled.fields.find((field) => field.label === "Control state"),
    { label: "Control state", value: "Controlled in response model" },
  );
});

test("a staged entity selection remains non-fatal until its evidence is visible", () => {
  const fixture = endpointLateralScenario;
  const state = createInitialCaseState(fixture);

  assert.equal(
    getSelectionContent(fixture, state, {
      kind: "entity",
      id: "identity:svc-fin-reports",
    }),
    null,
  );
  assert.equal(
    isVisibleEntity(fixture, state, "identity:svc-fin-reports"),
    false,
  );

  state.attachedEnrichmentIds.push("ENR-LAT-IDENTITY-01");

  assert.equal(
    isVisibleEntity(fixture, state, "identity:svc-fin-reports"),
    true,
  );
  assert.ok(
    getSelectionContent(fixture, state, {
      kind: "entity",
      id: "identity:svc-fin-reports",
    }),
  );
});

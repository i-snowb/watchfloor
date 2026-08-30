import assert from "node:assert/strict";
import test from "node:test";
import { getSelectionContent } from "../components/case-inspector";
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
  assert.deepEqual(
    controlled.fields.find((field) => field.label === "Control state"),
    { label: "Control state", value: "Controlled in response model" },
  );
});

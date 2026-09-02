import assert from "node:assert/strict";
import test from "node:test";
import {
  getAllEvents,
  getVisibleEntities,
  getVisibleEvents,
  getVisibleGraphNodes,
  getVisibleJoins,
} from "../domain/incident-stream";
import { createInitialCaseState } from "../domain/operations";
import { endpointLateralScenario as fixture } from "../domain/scenarios";
import type { CaseState } from "../domain/types";

function visibleIds<T extends { id: string }>(items: readonly T[]): string[] {
  return items.map((item) => item.id).sort();
}

function visibleNodeEntityIds(
  items: readonly { entityId: string }[],
): string[] {
  return items.map((item) => item.entityId).sort();
}

function stateWith(
  change: Pick<
    CaseState,
    "attachedEnrichmentIds" | "releasedStreamStageIds" | "reachabilityAttached"
  >,
): CaseState {
  return { ...createInitialCaseState(fixture), ...change };
}

test("endpoint graph reveals only evidence-backed observed topology before modeled reachability", () => {
  const initial = createInitialCaseState(fixture);

  assert.deepEqual(visibleIds(getVisibleEntities(fixture, initial)), [
    "endpoint:fin-ws-044",
    "file:invoice-sync-helper",
    "indicator:203.0.113.91",
  ]);
  assert.deepEqual(
    visibleNodeEntityIds(getVisibleGraphNodes(fixture, initial)),
    [
      "endpoint:fin-ws-044",
      "file:invoice-sync-helper",
      "indicator:203.0.113.91",
    ],
  );
  assert.deepEqual(visibleIds(getVisibleEvents(fixture, initial)), [
    "EVT-EDR-0448-01",
    "EVT-EDR-0448-02",
    "EVT-EDR-0448-03",
    "EVT-EDR-0448-04",
  ]);
  assert.deepEqual(visibleIds(getVisibleJoins(fixture, initial)), [
    "JOIN-LAT-01",
    "JOIN-LAT-02",
  ]);

  const identityAttached = stateWith({
    attachedEnrichmentIds: ["ENR-LAT-IDENTITY-01"],
    releasedStreamStageIds: [],
    reachabilityAttached: false,
  });
  assert.deepEqual(visibleIds(getVisibleEntities(fixture, identityAttached)), [
    "endpoint:fin-ws-044",
    "file:invoice-sync-helper",
    "identity:svc-fin-reports",
    "indicator:203.0.113.91",
  ]);
  assert.deepEqual(visibleIds(getVisibleEvents(fixture, identityAttached)), [
    "EVT-EDR-0448-01",
    "EVT-EDR-0448-02",
    "EVT-EDR-0448-03",
    "EVT-EDR-0448-04",
    "EVT-EDR-0448-06",
  ]);
  assert.deepEqual(visibleIds(getVisibleJoins(fixture, identityAttached)), [
    "JOIN-LAT-01",
    "JOIN-LAT-02",
  ]);

  const stageOne = stateWith({
    attachedEnrichmentIds: ["ENR-LAT-IDENTITY-01"],
    releasedStreamStageIds: ["STREAM-LAT-01"],
    reachabilityAttached: false,
  });
  assert.deepEqual(visibleIds(getVisibleEntities(fixture, stageOne)), [
    "endpoint:app-srv-021",
    "endpoint:fin-reports-srv-010",
    "endpoint:fin-ws-044",
    "file:invoice-sync-helper",
    "identity:svc-fin-reports",
    "indicator:203.0.113.91",
    "secret:ci-deploy-token",
  ]);
  assert.equal(getVisibleEvents(fixture, stageOne).length, 11);
  assert.deepEqual(visibleIds(getVisibleJoins(fixture, stageOne)), [
    "JOIN-LAT-01",
    "JOIN-LAT-02",
    "JOIN-LAT-03",
    "JOIN-LAT-04",
    "JOIN-LAT-05",
    "JOIN-LAT-06",
    "JOIN-LAT-08",
  ]);

  const recoveryEvidence = stateWith({
    attachedEnrichmentIds: ["ENR-LAT-IDENTITY-01", "ENR-LAT-APP-01"],
    releasedStreamStageIds: ["STREAM-LAT-01", "STREAM-LAT-02"],
    reachabilityAttached: false,
  });
  assert.ok(
    visibleIds(getVisibleEntities(fixture, recoveryEvidence)).includes(
      "secret:ci-deploy-token",
    ),
  );
  assert.ok(
    !visibleIds(getVisibleEntities(fixture, recoveryEvidence)).includes(
      "workload:billing-api",
    ),
  );
  assert.ok(
    !visibleIds(getVisibleEvents(fixture, recoveryEvidence)).includes(
      "EVT-CLOUD-0448-11",
    ),
  );

  const reachable = { ...recoveryEvidence, reachabilityAttached: true };
  assert.ok(
    visibleIds(getVisibleEntities(fixture, reachable)).includes(
      "workload:billing-api",
    ),
  );
  assert.ok(
    visibleIds(getVisibleEvents(fixture, reachable)).includes(
      "EVT-CLOUD-0448-11",
    ),
  );
  assert.ok(
    visibleIds(getVisibleJoins(fixture, reachable)).includes("JOIN-LAT-07"),
  );
});

test("endpoint stream stages are not received before their included evidence", () => {
  for (const stage of fixture.stream.stages) {
    const artifacts = [...stage.events, ...stage.joins, ...stage.enrichments];
    const latestArtifactAt = Math.max(
      ...artifacts.map((artifact) => Date.parse(artifact.timestamp)),
    );
    assert.ok(
      Date.parse(stage.receivedAt) >= latestArtifactAt,
      `${stage.id} receipt precedes a constituent artifact`,
    );
  }
});

test("endpoint query records and case bounds retain source-event chronology", () => {
  const eventTimes = new Map(
    getAllEvents(fixture).map((event) => [event.id, event.timestamp]),
  );
  const recordTime = (queryId: string, recordId: string): string => {
    const query = fixture.investigationQueries.find(
      (candidate) => candidate.id === queryId,
    );
    assert.ok(query, `missing query ${queryId}`);
    const record = query.returnedRecords.find(
      (candidate) => candidate.id === recordId,
    );
    assert.ok(record, `missing returned record ${recordId}`);
    return record.timestamp;
  };

  assert.equal(
    recordTime("QRY-ENDPOINT-IDENTITY-03", "QRR-ENDPOINT-IDENTITY-01"),
    eventTimes.get("EVT-AUTH-0448-05"),
  );
  assert.equal(
    recordTime("QRY-ENDPOINT-EGRESS-04", "QRR-ENDPOINT-EGRESS-01"),
    eventTimes.get("EVT-EDR-0448-03"),
  );
  assert.equal(
    recordTime("QRY-ENDPOINT-EGRESS-04", "QRR-ENDPOINT-EGRESS-02"),
    eventTimes.get("EVT-EDR-0448-04"),
  );

  const latestEvidenceAt = Math.max(
    ...getAllEvents(fixture).map((event) => Date.parse(event.timestamp)),
    ...fixture.stream.stages.flatMap((stage) =>
      stage.enrichments.map((artifact) => Date.parse(artifact.timestamp)),
    ),
  );
  assert.ok(Date.parse(fixture.timeRange.end) >= latestEvidenceAt);
});

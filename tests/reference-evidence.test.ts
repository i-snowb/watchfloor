import assert from "node:assert/strict";
import test from "node:test";
import { getReferenceCases } from "../domain/reference-cases";
import { getReferenceQueryExecution } from "../domain/reference-evidence";

test("every evidence-brief query exposes canonical KQL and exact returned records", () => {
  for (const dossier of getReferenceCases()) {
    for (const query of dossier.queries) {
      const execution = getReferenceQueryExecution(query.id);
      assert.ok(execution, `${query.id} must have an execution contract`);
      assert.equal(execution.language, "KQL");
      assert.ok(execution.text.length >= 80);
      assert.equal(execution.records.length, query.returnedRecords);
      assert.ok(
        execution.records.every(
          (record) =>
            record.id.length > 0 &&
            Number.isFinite(Date.parse(record.timestamp)) &&
            query.sources.some((source) => source.label === record.source) &&
            record.recordType.length > 0 &&
            record.fields.length > 0,
        ),
      );
    }
  }
});

test("evidence-brief search scopes stay bounded for interactive review", () => {
  for (const dossier of getReferenceCases()) {
    for (const query of dossier.queries) {
      const scopedRecords = query.sources.reduce(
        (total, source) => total + source.records,
        0,
      );
      assert.ok(scopedRecords > 0);
      assert.ok(scopedRecords <= 100_000, `${query.id} scope is too broad`);
      assert.ok(query.matchedRecords <= scopedRecords);
      assert.ok(query.returnedRecords <= query.matchedRecords);
    }
  }
});

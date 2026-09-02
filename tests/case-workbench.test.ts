import assert from "node:assert/strict";
import test from "node:test";
import { shouldClearOperationError } from "../components/operation-error";

test("an operation error clears only after the case advances beyond its failing revision", () => {
  assert.equal(shouldClearOperationError(null, 8), false);
  assert.equal(shouldClearOperationError(8, 8), false);
  assert.equal(shouldClearOperationError(8, 9), true);
});

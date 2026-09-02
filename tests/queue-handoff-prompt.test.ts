import assert from "node:assert/strict";
import test from "node:test";
import { queueHandoffPrompt } from "../components/queue-handoff-prompt";

test("queue handoff starts from queue results and preserves case boundaries", () => {
  assert.match(queueHandoffPrompt, /list_case_queue first/);
  assert.match(
    queueHandoffPrompt,
    /Open only a case returned by the queue results/,
  );
  assert.match(queueHandoffPrompt, /wait for the case surface to register/);
  assert.match(queueHandoffPrompt, /get_case_context/);
  assert.match(queueHandoffPrompt, /nextAgentAction/);
  assert.match(queueHandoffPrompt, /analystGate/);
  assert.match(queueHandoffPrompt, /Do not invent case IDs.*revisions/s);
});

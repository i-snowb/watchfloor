import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const publicConfig = JSON.parse(
  await readFile(new URL("../wrangler.public.json", import.meta.url), "utf8"),
);
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

assert.equal(publicConfig.name, "watchfloor-sandbox");
assert.equal(publicConfig.main, "worker.public.mjs");
assert.deepEqual(publicConfig.rules, [
  {
    type: "ESModule",
    globs: ["dist/server/**/*.js", "server/public-retention.mjs"],
    fallthrough: false,
  },
  {
    type: "CompiledWasm",
    globs: ["dist/server/**/*.wasm"],
    fallthrough: false,
  },
  {
    type: "Text",
    globs: ["dist/server/**/*.txt"],
    fallthrough: false,
  },
  {
    type: "Data",
    globs: ["dist/server/**/*.bin"],
    fallthrough: false,
  },
]);
assert.equal(publicConfig.workers_dev, true);
assert.equal(publicConfig.preview_urls, false);
assert.deepEqual(publicConfig.triggers?.crons, ["*/15 * * * *"]);
assert.equal(Object.hasOwn(publicConfig, "route"), false);
assert.equal(Object.hasOwn(publicConfig, "routes"), false);
assert.equal(publicConfig.vars?.WATCHFLOOR_AUTH_MODE, "anonymous_sandbox");
assert.equal(publicConfig.version_metadata?.binding, "WATCHFLOOR_VERSION");
for (const releaseVariable of [
  "WATCHFLOOR_RELEASE_ID",
  "WATCHFLOOR_SOURCE_COMMIT",
  "WATCHFLOOR_SOURCE_REPOSITORY",
]) {
  assert.equal(
    Object.hasOwn(publicConfig.vars ?? {}, releaseVariable),
    false,
    `${releaseVariable} must be supplied per immutable public deployment, not committed to the sandbox config.`,
  );
}
for (const forbidden of [
  "WATCHFLOOR_ACCESS_TEAM_DOMAIN",
  "WATCHFLOOR_ACCESS_AUD",
  "WATCHFLOOR_ANALYST_EMAILS",
]) {
  assert.equal(Object.hasOwn(publicConfig.vars ?? {}, forbidden), false);
}
assert.equal(publicConfig.d1_databases?.length, 1);
const publicDatabase = publicConfig.d1_databases[0];
assert.equal(publicDatabase.binding, "DB");
assert.equal(publicDatabase.database_name, "watchfloor-sandbox");
assert.match(publicDatabase.database_id, uuid);

assert.equal(publicConfig.ratelimits?.length, 2);
assert.deepEqual(publicConfig.ratelimits.map((entry) => entry.name).sort(), [
  "WATCHFLOOR_IP_LIMITER",
  "WATCHFLOOR_SESSION_LIMITER",
]);
const namespaces = new Set();
for (const entry of publicConfig.ratelimits) {
  assert.match(entry.namespace_id, /^[1-9][0-9]*$/);
  assert.equal(namespaces.has(entry.namespace_id), false);
  namespaces.add(entry.namespace_id);
  assert.equal(entry.simple.period, 60);
  assert.equal(Number.isInteger(entry.simple.limit), true);
  assert.equal(entry.simple.limit > 0, true);
}
assert.equal(publicConfig.observability?.enabled, true);
assert.equal(publicConfig.observability?.logs?.enabled, true);
assert.equal(publicConfig.observability?.logs?.invocation_logs, false);
assert.equal(publicConfig.observability?.logs?.persist, true);
assert.equal(publicConfig.observability?.logs?.head_sampling_rate, 0.1);
assert.equal(publicConfig.observability?.traces?.enabled, true);
assert.equal(publicConfig.observability?.traces?.persist, true);
assert.equal(publicConfig.observability?.traces?.head_sampling_rate, 0.01);

console.log("Public Cloudflare sandbox profile is isolated and bounded.");

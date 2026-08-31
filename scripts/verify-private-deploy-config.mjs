import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const configUrl = new URL("../wrangler.deploy.json", import.meta.url);
const config = JSON.parse(await readFile(configUrl, "utf8"));

assert.equal(
  config.name,
  "watchfloor-private-review",
  "The review Worker must use its dedicated name.",
);
assert.equal(
  config.workers_dev,
  false,
  "workers_dev must be explicitly disabled.",
);
assert.equal(
  config.preview_urls,
  false,
  "preview_urls must be explicitly disabled.",
);
assert.equal(
  Object.hasOwn(config, "route"),
  false,
  "A private upload must not define route.",
);
assert.equal(
  Object.hasOwn(config, "routes"),
  false,
  "A private upload must not define routes.",
);
assert.equal(
  Object.hasOwn(config, "custom_domain"),
  false,
  "A private upload must not define a custom domain.",
);
assert.equal(
  config.d1_databases?.length,
  1,
  "The private review profile must bind exactly one D1 database.",
);
assert.equal(
  config.d1_databases?.[0]?.binding,
  "DB",
  "The private review database must use the DB binding.",
);
assert.equal(
  config.vars?.WATCHFLOOR_AUTH_MODE,
  "cloudflare_access",
  "The private review Worker must fail closed on Cloudflare Access identity.",
);
assert.equal(
  Object.hasOwn(config.vars ?? {}, "WATCHFLOOR_ALLOW_LOCAL_DEVELOPMENT"),
  false,
  "The deployment must not enable local-development authorization.",
);

console.log("Private Cloudflare profile is fail-closed.");

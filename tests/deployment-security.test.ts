import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the private Cloudflare profile has no reachable route", async () => {
  const config = JSON.parse(
    await readFile(new URL("../wrangler.deploy.json", import.meta.url), "utf8"),
  );
  assert.equal(config.name, "watchfloor-private-review");
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(Object.hasOwn(config, "route"), false);
  assert.equal(Object.hasOwn(config, "routes"), false);
  assert.equal(Object.hasOwn(config, "custom_domain"), false);
  assert.equal(config.d1_databases?.length, 1);
  assert.equal(config.vars?.WATCHFLOOR_AUTH_MODE, "cloudflare_access");
  assert.equal(
    Object.hasOwn(config.vars ?? {}, "WATCHFLOOR_ALLOW_LOCAL_DEVELOPMENT"),
    false,
  );
});

test("Cloudflare static assets receive the same browser hardening policy", async () => {
  const headers = await readFile(
    new URL("../public/_headers", import.meta.url),
    "utf8",
  );
  assert.match(headers, /^\/\*$/m);
  assert.match(headers, /Content-Security-Policy: frame-ancestors 'none'/);
  assert.match(headers, /X-Frame-Options: DENY/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /Referrer-Policy: no-referrer/);
  assert.match(headers, /Permissions-Policy: .*camera=\(\)/);
});

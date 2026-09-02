import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname } from "node:path";

const clientRoot = new URL("../dist/client/", import.meta.url);
const forbiddenSentinels = [
  "QRR-ENDPOINT-APP-04",
  "QRR-ENDPOINT-IDENTITY-03",
  "EVT-CLOUD-0448-11",
  "billing-api:v2026.08.27.7",
  "Remote service start blocked",
  "Recovery scope confirmed",
];
const textExtensions = new Set([".css", ".html", ".js", ".json", ".txt"]);

const files = await walk(clientRoot);
assert.equal(files.length > 0, true, "The client build is missing.");

for (const file of files) {
  if (!textExtensions.has(extname(file.pathname))) continue;
  const source = await readFile(file, "utf8");
  for (const sentinel of forbiddenSentinels) {
    assert.equal(
      source.includes(sentinel),
      false,
      `Unreleased scenario content ${JSON.stringify(sentinel)} entered ${file.pathname}.`,
    );
  }
}

console.log(
  "Client build excludes unreleased scenario records and graph content.",
);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = new URL(entry.name, ensureDirectoryUrl(directory));
    if (entry.isDirectory()) {
      files.push(...(await walk(target)));
    } else if (entry.isFile()) {
      files.push(target);
    }
  }
  return files;
}

function ensureDirectoryUrl(value) {
  return new URL(
    value.pathname.endsWith("/") ? value.pathname : `${value.pathname}/`,
    value,
  );
}

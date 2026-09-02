import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const inspectorPath = fileURLToPath(
  new URL("../components/case-inspector.tsx", import.meta.url),
);
const reportPath = fileURLToPath(
  new URL("../components/case-report-panel.tsx", import.meta.url),
);
const drawerPath = fileURLToPath(
  new URL("../components/investigation-drawer.tsx", import.meta.url),
);
const stylesPath = fileURLToPath(
  new URL("../app/graph-readability.css", import.meta.url),
);

test("lineage entry points stay contextual and use the existing drawer", async () => {
  const [inspector, report, drawer] = await Promise.all([
    readFile(inspectorPath, "utf8"),
    readFile(reportPath, "utf8"),
    readFile(drawerPath, "utf8"),
  ]);

  assert.match(inspector, /className="inspector-provenance-action"/);
  assert.match(inspector, /View relationship provenance/);
  assert.match(inspector, /selection\.kind === "event"/);
  assert.match(report, /className="report-evidence-provenance"/);
  assert.match(report, /targetType: "report_finding"/);
  assert.match(
    drawer,
    /className="findings-context-disclosure provenance-disclosure"/,
  );
  assert.match(drawer, /<ProvenanceDetails/);
  assert.match(drawer, /Approved investigation skills/);
  assert.match(drawer, /syntheticRecordCount/);
  assert.match(drawer, /receipt\.requestId/);
  assert.match(drawer, /receipt\.id/);
});

test("lineage content remains bounded in the existing responsive drawer", async () => {
  const styles = await readFile(stylesPath, "utf8");

  assert.match(styles, /\.provenance-disclosure-body \{[\s\S]*padding: 12px;/);
  assert.match(
    styles,
    /\.provenance-record dl \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
  );
  assert.match(
    styles,
    /@media \(max-width: 700px\) \{[\s\S]*\.provenance-record dl \{[\s\S]*grid-template-columns: minmax\(0, 1fr\);/,
  );
  assert.doesNotMatch(
    styles,
    /\.provenance-disclosure\s*\{[\s\S]*position:\s*(fixed|absolute)/,
  );
  assert.match(
    styles,
    /\.provenance-receipt code \{[\s\S]*word-break: break-word;/,
  );
});

test("desktop drawer overlay remains above the timeline and scrolls its details", async () => {
  const [styles, drawer] = await Promise.all([
    readFile(stylesPath, "utf8"),
    readFile(drawerPath, "utf8"),
  ]);

  assert.match(
    styles,
    /\.case-view \.case-investigation-drawer \{[\s\S]*position: relative;[\s\S]*z-index: 60;/,
  );
  assert.match(
    styles,
    /\.case-view \.case-investigation-drawer\[open\] > \.investigation-drawer-body \{[\s\S]*overflow: auto !important;[\s\S]*position: absolute !important;[\s\S]*z-index: 60;/,
  );
  assert.match(
    drawer,
    /<div className="investigation-drawer-body findings-tray-body">[\s\S]*\{selectionDetails \? \(/,
  );
});

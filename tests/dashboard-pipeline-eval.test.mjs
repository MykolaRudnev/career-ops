import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

test("processed A-F lines keep the report score instead of being parsed as a URL", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-eval-"));
  const filesPath = new URL("../server/fileAccess.ts", import.meta.url).href;
  try {
    const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `
      import fs from "node:fs";
      import { parsePipeline } from ${JSON.stringify(filesPath)};
      fs.mkdirSync("data", { recursive: true });
      fs.writeFileSync("data/pipeline.md", \`# Pipeline

## Pending
- [ ] https://example.test/react | B3 | Senior React Developer | Anywhere | posted: 2026-09-06

## Processed
- [x] #014 | https://nofluffjobs.com/pl/job/senior-react-developer-ework | Ework Group | Senior React Developer | 4.8/5 | PDF ❌
- [x] #-- | https://example.test/skip | Bling | Full Stack Product Engineer | skipped (german)
- [x] https://example.test/applied | Acme | Senior Developer | Warsaw | status: applied
\`);
      const parsed = parsePipeline();
      console.log(JSON.stringify({
        pending: parsed.pending.map(j => ({ url: j.url, title: j.title })),
        processed: parsed.processed.map(j => ({ url: j.url, company: j.company, title: j.title, score: j.pipelineScore, report: j.reportNumber, status: j.status, fit: j.fitScore }))
      }));
    `], { cwd: dir, encoding: "utf8" }));

    assert.equal(result.pending[0].title, "Senior React Developer");
    const ework = result.processed.find(j => j.company === "Ework Group");
    assert.equal(ework.url, "https://nofluffjobs.com/pl/job/senior-react-developer-ework");
    assert.equal(ework.title, "Senior React Developer");
    assert.equal(ework.score, 4.8);
    assert.equal(ework.report, "014");
    assert.equal(ework.fit, 4.8);
    assert.equal(ework.status, "reviewed");
    assert.equal(result.processed.find(j => j.company === "Bling").status, "skipped");
    assert.equal(result.processed.find(j => j.company === "Acme").status, "applied");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

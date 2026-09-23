import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

test("updateJobBid persists proposed rate/bid to pipeline.md, manual-jobs.json, and applications.md", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bid-test-"));
  const filesPath = new URL("../server/fileAccess.ts", import.meta.url).href;
  try {
    const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `
      import fs from "node:fs";
      import path from "node:path";
      import { updateJobBid, parsePipeline } from ${JSON.stringify(filesPath)};

      fs.mkdirSync("data", { recursive: true });
      const pipelineContent = "# Pipeline — Pending URLs\\n\\n## Pending\\n\\n## Processed\\n- [x] https://example.test/job1 | Acme Corp | Senior Developer | Warsaw | status: applied\\n";
      fs.writeFileSync("data/pipeline.md", pipelineContent, "utf8");

      const manualJobs = [{
        id: "manual-job-1",
        url: "https://example.test/job1",
        company: "Acme Corp",
        title: "Senior Developer",
        status: "applied",
        bid: ""
      }];
      fs.writeFileSync("data/manual-jobs.json", JSON.stringify(manualJobs, null, 2), "utf8");

      const trackerContent = "# Applications Tracker\\n\\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\\n|---|------|---------|------|-------|--------|-----|--------|-------|\\n| 1 | 2026-09-08 | Acme Corp | Senior Developer | 4.8/5 | Applied | ❌ | — | Source: Manual; manual-id: manual-job-1; URL: https://example.test/job1 |\\n";
      fs.writeFileSync("data/applications.md", trackerContent, "utf8");

      await updateJobBid("https://example.test/job1", "250 PLN/h", "manual-job-1");

      const updatedPipeline = fs.readFileSync("data/pipeline.md", "utf8");
      const updatedManual = JSON.parse(fs.readFileSync("data/manual-jobs.json", "utf8"));
      const updatedTracker = fs.readFileSync("data/applications.md", "utf8");
      const parsed = parsePipeline();

      console.log(JSON.stringify({
        updatedPipeline,
        updatedManualBid: updatedManual[0].bid,
        updatedTracker,
        parsedBid: parsed.processed[0]?.bid
      }));
    `], { cwd: dir, encoding: "utf8" }));

    assert.equal(result.updatedManualBid, "250 PLN/h");
    assert.match(result.updatedPipeline, /bid:\s*250 PLN\/h/);
    assert.match(result.updatedTracker, /Rate \/ Bid:\s*250 PLN\/h/);
    assert.equal(result.parsedBid, "250 PLN/h");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("tailored CVs format display names as Company / Vacancy and provide folderPath", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cv-display-test-"));
  const filesPath = new URL("../server/fileAccess.ts", import.meta.url).href;
  try {
    const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `
      import fs from "node:fs";
      import path from "node:path";
      import { getTailoredCvs } from ${JSON.stringify(filesPath)};

      const cvDir = path.join("outputs", "tech-corp", "lead-frontend-engineer");
      fs.mkdirSync(cvDir, { recursive: true });
      fs.writeFileSync(path.join(cvDir, "Mykola_Rudnev_Frontend_Tech_Lead.pdf"), "dummy-pdf");
      fs.writeFileSync(path.join(cvDir, "metadata.json"), JSON.stringify({
        company: "Tech Corp",
        role: "Lead Frontend Engineer",
        pdfPath: path.resolve(cvDir, "Mykola_Rudnev_Frontend_Tech_Lead.pdf")
      }));

      const cvs = getTailoredCvs();
      console.log(JSON.stringify(cvs));
    `], { cwd: dir, encoding: "utf8" }));

    assert.equal(result.length, 1);
    assert.equal(result[0].company, "Tech Corp");
    assert.equal(result[0].role, "Lead Frontend Engineer");
    assert.equal(result[0].displayName, "Tech Corp / Lead Frontend Engineer");
    assert.match(result[0].folderPath, /outputs\/tech-corp\/lead-frontend-engineer/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("restructureLegacyArtifactDirs migrates flat legacy folders to Company/Vacancy format", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "restructure-test-"));
  const artifactsPath = new URL("../server/jobArtifacts.ts", import.meta.url).href;
  try {
    const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `
      import fs from "node:fs";
      import path from "node:path";
      import { restructureLegacyArtifactDirs } from ${JSON.stringify(artifactsPath)};

      const legacyDir = path.join("outputs", "legacy-firm-senior-react-dev");
      fs.mkdirSync(legacyDir, { recursive: true });
      fs.writeFileSync(path.join(legacyDir, "tailored-cv.pdf"), "sample");
      fs.writeFileSync(path.join(legacyDir, "metadata.json"), JSON.stringify({
        company: "Legacy Firm",
        role: "Senior React Developer"
      }));

      restructureLegacyArtifactDirs(path.resolve("outputs"));

      const targetDir = path.join("outputs", "legacy-firm", "senior-react-developer");
      const targetExists = fs.existsSync(targetDir);
      const legacyStillExists = fs.existsSync(legacyDir);
      const targetHasPdf = fs.existsSync(path.join(targetDir, "tailored-cv.pdf"));

      console.log(JSON.stringify({ targetExists, legacyStillExists, targetHasPdf }));
    `], { cwd: dir, encoding: "utf8" }));

    assert.equal(result.targetExists, true);
    assert.equal(result.legacyStillExists, false);
    assert.equal(result.targetHasPdf, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("details artifacts resolve the latest CV for the exact vacancy and exclude cover PDFs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "job-artifacts-"));
  const moduleUrl = new URL("../server/fileAccess.ts", import.meta.url).href;
  try {
    const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `
      import fs from 'node:fs';
      import path from 'node:path';
      import {getJobArtifacts} from ${JSON.stringify(moduleUrl)};
      const job = {company:'Example', title:'React Developer', url:'https://example.test/current'};
      for (const [name,url] of [['react','https://example.test/other'],['react-2',job.url]]) {
        const folder = path.join('outputs','example',name);
        fs.mkdirSync(folder,{recursive:true});
        fs.writeFileSync(path.join(folder,'artifact-job.json'),JSON.stringify({...job,url}));
        fs.writeFileSync(path.join(folder,'candidate.pdf'),'pdf');
        fs.writeFileSync(path.join(folder,'cover-letter.pdf'),'pdf');
      }
      const folder = path.join('outputs','example','react-2');
      fs.utimesSync(path.join(folder,'candidate.pdf'),new Date(1000),new Date(1000));
      fs.writeFileSync(path.join(folder,'latest.pdf'),'new pdf');
      console.log(JSON.stringify({current:getJobArtifacts(job), missing:getJobArtifacts({...job,url:'https://example.test/missing'})}));
    `], { cwd: dir, encoding: "utf8" }));
    assert.match(result.current.pdfPath, /react-2\/latest.pdf$/);
    assert.match(result.current.folderPath, /react-2$/);
    assert.equal(result.missing.pdfPath, null);
    assert.equal(result.missing.folderPath, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

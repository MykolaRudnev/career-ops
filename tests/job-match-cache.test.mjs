import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

test("new local JD replaces a summary; reranking retains full-JD evidence; policy invalidates cache", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontend-cache-"));
  fs.mkdirSync(path.join(dir, "config"));
  fs.copyFileSync(new URL("../config/profile.yml", import.meta.url), path.join(dir, "config/profile.yml"));
  const moduleUrl = new URL("../server/careerOps.ts", import.meta.url).href;
  const fixture = fs.readFileSync(new URL("./fixtures/co-brick-frontend.md", import.meta.url), "utf8");
  const code = `
    import fs from 'node:fs';
    import { careerOps } from ${JSON.stringify(moduleUrl)};
    const job = { title: 'Frontend Developer', company: 'co.brick', location: 'Poland', url: 'https://fixture.test/frontend' };
    const before = careerOps.getEvaluationForDisplay(job);
    fs.mkdirSync('outputs/fixture', {recursive:true});
    fs.writeFileSync('outputs/fixture/metadata.json', JSON.stringify({...job, role:job.title}));
    fs.writeFileSync('outputs/fixture/job-description.md', ${JSON.stringify(fixture)});
    const after = careerOps.getEvaluationForDisplay(job);
    const reranked = await careerOps.rerankJobs([job], 0);
    fs.unlinkSync('outputs/fixture/job-description.md');
    const retained = careerOps.getEvaluationForDisplay(job);
    const file = 'config/profile.yml';
    fs.writeFileSync(file, fs.readFileSync(file,'utf8').replace('pureFrontend: 98', 'pureFrontend: 90'));
    const updated = careerOps.getEvaluationForDisplay(job);
    console.log(JSON.stringify({before,after,retained,updated,reranked:reranked.ranked[0].evaluation}));
  `;
  try {
    const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code], { cwd: dir, env: { ...process.env, CAREER_OPS_ROOT: dir }, encoding: "utf8" }));
    assert.equal(result.before.evaluatedFrom, "pipeline-summary");
    assert.equal(result.after.matchClassification, "BEST MATCH");
    assert.equal(result.after.evaluatedFrom, "full-jd");
    assert.equal(result.retained.compatibilityPercent, result.after.compatibilityPercent);
    assert.equal(result.reranked.compatibilityPercent, result.after.compatibilityPercent);
    assert.equal(result.updated.compatibilityPercent, 90);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

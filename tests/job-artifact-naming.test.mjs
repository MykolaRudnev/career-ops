import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { tailoredPdfFilename, normalizedCvRole } from "../server/jobArtifacts.ts";

test("CV filenames contain only candidate and normalized role", () => {
  assert.equal(tailoredPdfFilename("Mykola Rudnev", "Senior Frontend Developer (React + Typescript + Next.js) / Travel"), "Mykola_Rudnev_Senior_Frontend_Developer.pdf");
  assert.equal(normalizedCvRole("Full-stack Developer (React / Node.js / TypeScript)"), "Fullstack Engineer");
  assert.equal(normalizedCvRole("Lead Frontend Engineer – Product Platform"), "Frontend Tech Lead");
});

test("same-company vacancies stay isolated and nested PDFs resolve through dashboard metadata", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cv-naming-"));
  const artifacts = new URL("../server/jobArtifacts.ts", import.meta.url).href;
  const files = new URL("../server/fileAccess.ts", import.meta.url).href;
  try {
    const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `
      import fs from 'node:fs'; import path from 'node:path';
      import {jobArtifactDir, tailoredPdfFilename} from ${JSON.stringify(artifacts)};
      import {getTailoredCvs, parsePipeline, getTailoringDiff} from ${JSON.stringify(files)};
      const a={company:'Edge One Solutions Sp. z o.o.',title:'Senior Frontend Developer (React + Next.js)',url:'https://example.test/a'};
      const b={...a,url:'https://example.test/b'};
      const first=jobArtifactDir(a,{create:true}), second=jobArtifactDir(b,{create:true});
      const pdfPath=path.join(first,tailoredPdfFilename('Mykola Rudnev',a.title));
      fs.writeFileSync(pdfPath,'fixture');
      fs.writeFileSync(path.join(first,'metadata.json'),JSON.stringify({...a,role:a.title,pdfPath,generatedAt:'2026-09-06'}));
      fs.mkdirSync('data');fs.writeFileSync('data/pipeline.md','## Pending\\n- [ ] '+a.url+' | '+a.company+' | '+a.title+' | Poland\\n');
      console.log(JSON.stringify({first,second,again:jobArtifactDir(a),cvs:getTailoredCvs(),job:parsePipeline().pending[0],meta:getTailoringDiff(a.company,a.title)}));
    `], { cwd: dir, encoding: "utf8" }));
    assert.match(result.first, /outputs\/edge-one-solutions\/senior-frontend-developer$/);
    assert.match(result.second, /senior-frontend-developer-2$/);
    assert.equal(result.again, result.first);
    assert.equal(result.cvs.length, 1);
    assert.equal(result.job.tailoredPdfPath, result.meta.pdfPath);
    assert.equal(result.job.hasTailoredCv, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("existing legacy artifact folders still resolve", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cv-legacy-"));
  try {
    const result = execFileSync(process.execPath, ["--input-type=module", "-e", `
      import fs from 'node:fs';
      import {jobArtifactDir,jobArtifactSlug} from ${JSON.stringify(new URL("../server/jobArtifacts.ts", import.meta.url).href)};
      const job={company:'Legacy Co',title:'React Developer'};
      fs.mkdirSync('outputs/'+jobArtifactSlug(job.company,job.title),{recursive:true});
      console.log(jobArtifactDir(job));
    `], { cwd: dir, encoding: "utf8" });
    assert.match(result.trim(), /outputs\/legacy-co-react-developer$/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { analyzeJobMatch } from "../server/jobMatch.mjs";

const jd = fs.readFileSync(new URL("./fixtures/co-brick-frontend.md", import.meta.url), "utf8");
const run = (title, description = jd) => analyzeJobMatch({ title }, description);

test("co.brick is a primary frontend APPLY, with integration and no backend ownership", () => {
  const r = run("Frontend Developer");
  assert.match(r.matchClassification, /^(BEST|STRONG) MATCH$/);
  assert.ok(r.compatibilityPercent >= 85 && r.compatibilityPercent <= 95);
  assert.ok(r.fitScore >= 4.4 && r.fitScore <= 4.8);
  assert.equal(r.recommendation, "APPLY");
  assert.deepEqual(r.responsibilitySplit, { frontend: "dominant", backend: "collaboration/integration only", platform: "web" });
  assert.equal(r.backendOwnershipSignals.length, 0);
});

test("pure frontend outranks frontend-heavy and balanced fullstack with the same stack", () => {
  const primary = run("Senior Frontend Engineer");
  const heavy = run("Senior Fullstack React Node.js Engineer", jd + "\nPrimarily frontend-focused. Maintain light Node.js APIs.");
  const balanced = run("Senior Fullstack React Node.js Engineer", "50% frontend / 50% backend. Build React TypeScript components. Build Node.js APIs.");
  assert.ok(primary.compatibilityPercent > heavy.compatibilityPercent);
  assert.equal(heavy.matchClassification, "STRONG MATCH");
  assert.ok(heavy.compatibilityPercent > balanced.compatibilityPercent);
  assert.notEqual(balanced.matchClassification, "BEST MATCH");
  assert.ok(balanced.compatibilityPercent >= 65 && balanced.compatibilityPercent <= 82);
});

test("frontend titles cannot establish dominance without JD evidence", () => {
  const r = run("Senior Fullstack React Node.js Engineer", "");
  assert.notEqual(r.matchClassification, "BEST MATCH");
  assert.equal(r.frontendDominance, false);
  assert.notEqual(run("Frontend Developer", "Join our team.").matchClassification, "BEST MATCH");
});

for (const phrase of ["REST API integration", "GraphQL integration", "OAuth/JWT integration", "Work with backend engineers", "Collaborate with backend team", "Integrate with microservices", "Consume backend services", "Connect client-side applications to backend APIs"]) {
  test(`${phrase} is not backend ownership`, () => {
    const r = run("Frontend Developer", `${jd}\n${phrase}.`);
    assert.equal(r.backendOwnershipSignals.length, 0);
    assert.equal(r.rankingCategory, "pure-frontend");
  });
}

test("collaboration cannot hide a separate mandatory backend action", () => {
  const r = run("Frontend Developer", jd + "\nRequirements:\nCollaborate with backend engineers and build Python backend services. Python is required.");
  assert.ok(r.backendOwnershipSignals.length > 0);
  assert.notEqual(r.matchClassification, "BEST MATCH");
});

test("mobile, backend ownership and mandatory languages override an ideal frontend stack", () => {
  for (const extra of ["React Native is mandatory. Build iOS and Android apps.", "Build Java backend services. Java is mandatory.", "Fluent German is mandatory.", "Own Node.js backend architecture and distributed microservices."]) {
    const r = run("Fullstack Engineer", jd + "\nRequirements:\n" + extra);
    assert.notEqual(r.matchClassification, "BEST MATCH");
  }
});

test("Mid frontend remains competitive and Node keywords earn no bonus", () => {
  const mid = run("Mid Frontend Developer");
  assert.ok(mid.compatibilityPercent >= 85);
  assert.ok(run("Senior Frontend Developer").compatibilityPercent - mid.compatibilityPercent <= 2);
  assert.equal(run("Mid Frontend Developer", jd + "\nNode.js is optional.").compatibilityPercent, mid.compatibilityPercent);
});

test("score components reconcile to the displayed percentage", () => {
  const r = run("Frontend Developer");
  const b = r.scoreBreakdown;
  assert.equal(b.primaryRole.weight, 30);
  assert.equal(b.primaryRole.earned, 30);
  assert.equal(b.rawScore + b.adjustment, r.compatibilityPercent);
});

test("flattened fullstack requirements are not swallowed by collaboration or nice-to-have", () => {
  for (const stack of ["Java", "Kotlin"]) {
    const r = run(`Senior Fullstack ${stack} React Engineer`, `ResponsibilitiesDevelop and maintain backend services using ${stack}, in collaboration with data science teams.Build React components.RequirementsStrong backend expertise with ${stack}Experience building APIsNice to haveFamiliarity with AWS`);
    assert.equal(r.matchClassification, "LOW MATCH");
    assert.ok(r.missingMandatorySkills.length > 0);
  }
});

test("optional sections survive flattened headings and end at responsibilities", () => {
  const r = run("Senior Frontend React Engineer", "RequirementsReact and TypeScript. Build accessible frontend applications.Nice to haveExperience with Python and DjangoResponsibilitiesBuild frontend component libraries and design systems.");
  assert.equal(r.missingMandatorySkills.length, 0);
  assert.equal(r.backendOwnershipSignals.length, 0);
  assert.equal(r.frontendDominance, true);
});

test("explicit Apex implementation is a mandatory mismatch without the word required", () => {
  const r = run("Salesforce Engineer with frontend skills", "Build React and TypeScript components. Develop server-side logic with Apex. Design frontend architecture and improve performance.");
  assert.equal(r.matchClassification, "LOW MATCH");
  assert.ok(r.missingMandatorySkills.includes("Salesforce/Apex"));
});

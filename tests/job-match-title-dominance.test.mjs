import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(ROOT, "tests", "fixtures");
const loadFixture = (name) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

function resolveRankingProfileSource() {
  const userProfile = join(ROOT, "config", "profile.yml");
  if (existsSync(userProfile)) return userProfile;
  return join(FIXTURES, "profile-ranking-policy.yml");
}

const dataRoot = mkdtempSync(join(ROOT, ".tmp-job-match-policy-"));
mkdirSync(join(dataRoot, "config"), { recursive: true });
writeFileSync(join(dataRoot, "config", "profile.yml"), readFileSync(resolveRankingProfileSource(), "utf8"));
process.env.CAREER_OPS_ROOT = dataRoot;

const { analyzeJobMatch, inferBoardPrimaryRole, jobPrimaryTechnologies } = await import(`../server/jobMatch.mjs?policy=${Date.now()}`);

test.after(() => {
  delete process.env.CAREER_OPS_ROOT;
  rmSync(dataRoot, { recursive: true, force: true });
});

test("Harvey Nash UI/UX Developer stays STRONG/BEST with React primary stack", () => {
  const job = loadFixture("justjoin-harvey-nash-ui-ux.json");
  assert.equal(inferBoardPrimaryRole(job.title, job.category), "frontend-ui-dev");
  const result = analyzeJobMatch(job, "");
  assert.match(result.matchClassification, /^(BEST|STRONG) MATCH$/);
  assert.ok(result.fitScore >= 4, `expected fit >= 4, got ${result.fitScore} (${result.reason})`);
  assert.equal(result.recommendation, "APPLY");
});

test("Sii Kotlin Developer stays LOW — nice-to-have React must not confirm frontend", () => {
  const job = loadFixture("justjoin-sii-kotlin.json");
  assert.equal(inferBoardPrimaryRole(job.title, job.category), "backend");
  assert.deepEqual(jobPrimaryTechnologies(job), ["Kotlin", "AWS", "Microservices", "Kubernetes", "English"]);
  const result = analyzeJobMatch(job, "");
  assert.ok(result.fitScore < 3.5, `expected fit < 3.5, got ${result.fitScore} (${result.matchClassification}: ${result.reason})`);
  assert.match(result.matchClassification, /^(LOW|SKIP) MATCH$/);
});

test("false-positive samples: backend/QA titles with incidental React tag", () => {
  const samples = [
    { title: "Starszy Programista/Starsza Programistka Java", category: "Java", technologies: ["Kafka", "React"] },
    { title: "Senior Software Engineer Java, Kotlin (All Genders)", category: "Java", technologies: ["React", "Kubernetes"] },
    { title: "Senior Software Quality Engineer, Test Automation", category: "Testing", technologies: ["Python", "React"] },
    { title: "Senior Power Platform Developer", category: "Other", technologies: ["Power BI", "React"] },
    { title: "Senior Software Engineer (Python/React)", category: "Python", technologies: ["React"] },
  ];
  for (const sample of samples) {
    const job = { company: "X", url: `https://example.test/${encodeURIComponent(sample.title)}`, ...sample,
      requiredTechnologies: sample.technologies.map((name) => ({ name, level: "regular" })) };
    const result = analyzeJobMatch(job, "");
    assert.ok(result.fitScore < 4, `${sample.title} should be < 4.0, got ${result.fitScore} (${result.matchClassification})`);
  }
});

test("mixed fullstack titles cap at POSSIBLE with profile ranking enabled", () => {
  const result = analyzeJobMatch({
    title: "Senior Product Engineer (React + TypeScript; .NET)",
    company: "Publink",
    technologies: ["React", "TypeScript", "Azure"],
    requiredTechnologies: [{ name: "React" }, { name: "TypeScript" }, { name: "Azure" }],
  }, "");
  assert.ok(result.fitScore < 3.6, `mixed product engineer should stay <= 3.5, got ${result.fitScore}`);
  assert.equal(result.matchClassification, "POSSIBLE MATCH");
});

test("true positives remain strong", () => {
  const redstone = loadFixture("justjoin-redstone.json");
  const attomy = loadFixture("justjoin-attomy-shopify.json");
  for (const job of [redstone, attomy]) {
    const result = analyzeJobMatch(job, "");
    assert.ok(result.fitScore >= 4, `${job.title} should stay >= 4, got ${result.fitScore}`);
    assert.match(result.matchClassification, /^(BEST|STRONG) MATCH$/);
  }
  const fullstack = analyzeJobMatch({
    title: "Fullstack Developer (React & Node.js)",
    company: "Co",
    technologies: ["React", "Node.js", "TypeScript"],
    requiredTechnologies: [{ name: "React" }, { name: "Node.js" }, { name: "TypeScript" }],
  }, "Frontend-heavy React and Next.js delivery with a small Node.js API layer.");
  assert.ok(fullstack.fitScore >= 4);
  assert.match(fullstack.matchClassification, /^(BEST|STRONG) MATCH$/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeJobMatch, composeMatchDescription } from "../server/jobMatch.mjs";
import { buildTitleFilter } from "../title-keywords.mjs";
import { parseJustJoinResponse, syntheticDescriptionFromSkills } from "../providers/justjoin.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const loadFixture = (name) => JSON.parse(readFileSync(join(ROOT, "tests/fixtures", name), "utf8"));

const mikkiTitleFilter = buildTitleFilter({
  positive: [
    "Frontend", "Front-end", "React", "Next.js", "TypeScript", "JavaScript",
    "Shopify", "Magento", "Hyvä", "Liquid", "Developer", "Engineer", "E-commerce"
  ],
  negative: ["Blockchain", "Web3", "Crypto", ".NET", "Java ", "PHP", "Ruby"]
});

test("RedStone JustJoin stack-only pipeline summary scores as strong frontend match", () => {
  const job = loadFixture("justjoin-redstone.json");
  const result = analyzeJobMatch(job, "");
  assert.ok(result.fitScore >= 4, `expected fit >= 4, got ${result.fitScore}`);
  assert.match(result.matchClassification, /^(BEST|STRONG) MATCH$/);
  assert.equal(result.recommendation, "APPLY");
  assert.equal(result.responsibilitySplit.frontend, "dominant");
  assert.ok(result.strengths.some((s) => /React|Next/i.test(s)));
});

test("Attomy Shopify Developer passes title filter via provider tech stack", () => {
  const job = loadFixture("justjoin-attomy-shopify.json");
  assert.equal(mikkiTitleFilter(job), true);
  const result = analyzeJobMatch(job, "");
  assert.ok(result.fitScore >= 4, `expected fit >= 4, got ${result.fitScore}`);
  assert.equal(result.matchClassification, "BEST MATCH");
  assert.equal(result.recommendation, "APPLY");
});

test("JustJoin parser maps requiredSkills to technologies and synthetic description", () => {
  const parsed = parseJustJoinResponse({
    data: [{
      slug: "attomy-sp-z-o-o--shopify-developer-rzeszow-html-05afe0ba",
      title: "Shopify Developer",
      companyName: "Attomy Sp. z o.o.",
      workplaceType: "remote",
      publishedAt: "2026-10-20T08:00:00.000Z",
      requiredSkills: [{ name: "Shopify" }, { name: "Liquid" }]
    }]
  });
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0].technologies, ["Shopify", "Liquid"]);
  assert.equal(parsed[0].description, syntheticDescriptionFromSkills(["Shopify", "Liquid"]));
});

test("composeMatchDescription merges stack lines for thin postings", () => {
  const job = loadFixture("justjoin-redstone.json");
  const composed = composeMatchDescription(job, "");
  assert.match(composed, /React/);
  assert.match(composed, /Next\.js/);
});

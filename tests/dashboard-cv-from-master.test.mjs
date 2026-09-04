import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import {
  toContactLink,
  parseCvMarkdown,
  buildMasterCvPayload,
  buildSimpleTailorResult
} from "../server/cvFromMaster.mjs";

test("toContactLink turns a profile URL string into url/display objects", () => {
  assert.deepEqual(toContactLink("https://github.com/MykolaRudnev"), {
    url: "https://github.com/MykolaRudnev",
    display: "github.com/MykolaRudnev"
  });
  assert.equal(toContactLink(""), undefined);
  assert.deepEqual(toContactLink({ url: "https://mrudnev.com/", display: "mrudnev.com" }), {
    url: "https://mrudnev.com/",
    display: "mrudnev.com"
  });
});

test("parseCvMarkdown reads the real cv.md ground truth", () => {
  const parsed = parseCvMarkdown(readFileSync(new URL("../cv.md", import.meta.url), "utf8"));
  assert.equal(parsed.experience.length, 6);
  assert.equal(parsed.experience[0].company, "HUBER SE");
  assert.ok(parsed.experience.every((job) => job.role && job.dates && job.bullets.length > 0));
  assert.ok(parsed.skills.length >= 6);
  assert.ok(parsed.projects.length >= 4);
  assert.equal(parsed.education[0].title.includes("Computer Science"), true);
  assert.ok(parsed.languages.some((line) => line.startsWith("Polish")));
  assert.ok(parsed.summary.includes("6+ years"));
});

test("master payload keeps LinkedIn, GitHub, and portfolio as clickable links", () => {
  const payload = buildMasterCvPayload();
  assert.equal(payload.candidate.linkedin.url, "https://linkedin.com/in/mykola-r-1525a5145/");
  assert.equal(payload.candidate.github.url, "https://github.com/MykolaRudnev");
  assert.equal(payload.candidate.portfolio.url, "https://mrudnev.com/");
  assert.equal(payload.experience.length, 6);
  assert.ok(payload.skills.length > 0);
});

test("simple fallback result is a complete un-tailored CV from cv.md", () => {
  const result = buildSimpleTailorResult({ title: "Senior Frontend Developer" });
  assert.equal(result.headline, "Senior Frontend Developer");
  assert.equal(result._fallbackUsed, true);
  assert.equal(result.experience.length, 6);
  assert.ok(result.projects.length >= 2 && result.projects.length <= 4);
  assert.match(result.tailoring_diff.summary_focus, /cv\.md/);
});

test("simple fallback for a Shopify vacancy uses the Shopify project whitelist", () => {
  const result = buildSimpleTailorResult({ title: "Shopify Developer", company: "Attomy" });
  assert.equal(result.primary_domain, "SHOPIFY");
  const names = result.projects.map((p) => p.name);
  assert.ok(names.filter((n) => /glasy|ascent|warmsome|pixel25|berg|diamandia/i.test(n)).length >= 3);
  assert.equal(names.filter((n) => /ponadczasowi|copernicspace|pmicareers|learningspace|carneoo|hrk/i.test(n)).length, 0);
});

test("build-cv-html renders contact links from the master payload", () => {
  const payload = buildMasterCvPayload();
  const dir = mkdtempSync(join(tmpdir(), "cv-master-"));
  const jsonPath = join(dir, "cv.json");
  const htmlPath = join(dir, "cv.html");
  writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  try {
    execFileSync("node", ["build-cv-html.mjs", jsonPath, htmlPath], {
      cwd: join(dirname(fileURLToPath(import.meta.url)), ".."),
      stdio: "pipe"
    });
    const html = readFileSync(htmlPath, "utf8");
    assert.match(html, /href="https:\/\/linkedin.com\/in\/mykola-r-1525a5145\/"/);
    assert.match(html, /href="https:\/\/github.com\/MykolaRudnev"/);
    assert.match(html, /href="https:\/\/mrudnev.com\/"/);
    assert.match(html, /Technical Skills/);
    assert.match(html, /HUBER SE/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildAnalyticsIndex, cooccurrence, extractTechnologies, findAnalyticsJob, getTechnologyTrend, technologyCounts } from "../server/marketAnalytics.mjs";

const job = (id, description, extra = {}) => ({
  id, url: `https://example.com/jobs/${id}`, canonicalUrl: `https://example.com/jobs/${id}`,
  title: "Backend Developer", company: "Example", location: "Warsaw, Poland", description, ...extra
});

test("technology aliases normalize and one job counts once", () => {
  const technologies = extractTechnologies(job("aliases", "NestJS Nest.js nestjs NestJS NestJS"));
  assert.deepEqual(technologies, ["NestJS"]);
  assert.deepEqual(technologyCounts([{ technologies }]), [{ technology: "NestJS", count: 1 }]);
});

test("expired jobs are excluded from the active index", () => {
  const jobs = buildAnalyticsIndex([
    job("active", "NestJS", { expiresAt: "2099-01-01" }),
    job("expired", "NestJS", { expiresAt: "2020-01-01" }),
    job("closed", "NestJS", { status: "closed" }),
  ], [], {}, Date.parse("2026-10-05"));
  assert.equal(jobs.length, 1);
});

test("Node framework counts are exact and per-job", () => {
  const raw = [];
  for (let index = 0; index < 50; index++) raw.push(job(`nest-${index}`, "Node.js NestJS NestJS"));
  for (let index = 0; index < 35; index++) raw.push(job(`express-${index}`, "Node.js Express"));
  for (let index = 0; index < 12; index++) raw.push(job(`fastify-${index}`, "Node.js Fastify"));
  const result = Object.fromEntries(technologyCounts(buildAnalyticsIndex(raw)).map(row => [row.technology, row.count]));
  assert.equal(result.NestJS, 50);
  assert.equal(result.Express, 35);
  assert.equal(result.Fastify, 12);
});

test("co-occurrence uses jobs containing A and B divided by jobs containing A", () => {
  const raw = Array.from({ length: 100 }, (_, index) => job(`co-${index}`, index < 60 ? "NestJS PostgreSQL" : "NestJS"));
  const postgres = cooccurrence(buildAnalyticsIndex(raw), "NestJS").find(row => row.technology === "PostgreSQL");
  assert.deepEqual(postgres, { technology: "PostgreSQL", count: 60, percentage: 60 });
});

test("phantom technologies after Similar Offers are not indexed", () => {
  const technologies = extractTechnologies(job("phantom", "Required: Node.js and PostgreSQL. Similar Offers: Fastify, React, Ruby on Rails"));
  assert.equal(technologies.includes("Node.js"), true);
  assert.equal(technologies.includes("PostgreSQL"), true);
  assert.equal(technologies.includes("Fastify"), false);
  assert.equal(technologies.includes("React"), false);
  assert.equal(technologies.includes("Ruby"), false);
});

test("exact duplicate URLs contribute one job", () => {
  const first = job("duplicate", "Node.js NestJS");
  const second = { ...first, id: "other", description: "Node.js NestJS PostgreSQL" };
  assert.equal(buildAnalyticsIndex([first, second]).length, 1);
});

test("analytics lookup matches any pipeline URL alias", () => {
  const indexed = buildAnalyticsIndex([job("canonical", "React")]);
  const index = { jobs: indexed };
  assert.equal(findAnalyticsJob(index, { sourceAliases: [{ url: "https://example.com/jobs/canonical/" }] })?.jobId, "canonical");
  assert.equal(findAnalyticsJob(index, { url: "https://example.com/jobs/missing" }), null);
});

const trendJob = (id, technology, publishedAt, extra = {}) => ({
  jobId: id, title: "Backend Developer", company: "Example", location: "Poland",
  technologies: [technology], countries: ["Poland"], workModel: "Remote", roleFamily: "Backend",
  publishedAt, active: true, ...extra
});

test("weekly trend values use real posting dates", () => {
  const jobs = [];
  for (const [technology, counts] of [["NestJS", [10, 12, 18]], ["Express", [15, 14, 13]]]) {
    ["2026-09-21", "2026-09-28", "2026-10-05"].forEach((date, week) => {
      for (let index = 0; index < counts[week]; index++) jobs.push(trendJob(`${technology}-${week}-${index}`, technology, date));
    });
  }
  const result = getTechnologyTrend(jobs, { technologies: ["NestJS", "Express"], rangeDays: 90, now: Date.parse("2026-10-05T23:59:59Z") });
  assert.deepEqual(result.data.slice(-3).map(row => row.NestJS), [10, 12, 18]);
  assert.deepEqual(result.data.slice(-3).map(row => row.Express), [15, 14, 13]);
});

test("trend respects country and work-model filters", () => {
  const jobs = [
    trendJob("pl-remote", "NestJS", "2026-10-01"),
    trendJob("pl-office", "NestJS", "2026-10-02", { workModel: "Office" }),
    trendJob("de-remote", "NestJS", "2026-10-03", { countries: ["Germany"], location: "Germany" }),
  ];
  const global = getTechnologyTrend(jobs, { technologies: ["NestJS"], rangeDays: 30, now: Date.parse("2026-10-05") });
  const polishRemote = getTechnologyTrend(jobs, { technologies: ["NestJS"], filters: { country: "Poland", workModel: "Remote" }, rangeDays: 30, now: Date.parse("2026-10-05") });
  assert.equal(global.summaries[0].current, 3);
  assert.equal(polishRemote.summaries[0].current, 1);
});

test("trend does not invent change without previous-period history", () => {
  const jobs = Array.from({ length: 5 }, (_, index) => trendJob(`current-${index}`, "NestJS", `2026-10-0${index + 1}`));
  const result = getTechnologyTrend(jobs, { technologies: ["NestJS"], rangeDays: 30, now: Date.parse("2026-10-05") });
  assert.equal(result.summaries[0].previous, 0);
  assert.equal(result.summaries[0].changePercent, null);
  assert.match(result.warning, /materially different source coverage/);
});

test("trend percentage compares equally covered periods", () => {
  const jobs = [
    ...Array.from({ length: 12 }, (_, index) => trendJob(`current-nest-${index}`, "NestJS", "2026-10-01")),
    ...Array.from({ length: 8 }, (_, index) => trendJob(`current-other-${index}`, "React", "2026-10-01")),
    ...Array.from({ length: 10 }, (_, index) => trendJob(`previous-nest-${index}`, "NestJS", "2026-09-01")),
    ...Array.from({ length: 10 }, (_, index) => trendJob(`previous-other-${index}`, "React", "2026-09-01")),
  ];
  const result = getTechnologyTrend(jobs, { technologies: ["NestJS"], rangeDays: 30, now: Date.parse("2026-10-05") });
  assert.equal(result.summaries[0].changePercent, 20);
});

test("expired jobs do not enter active trend data", () => {
  const indexed = buildAnalyticsIndex([
    job("trend-active", "NestJS", { publishedAt: "2026-10-01", expiresAt: "2099-01-01" }),
    job("trend-expired", "NestJS", { publishedAt: "2026-10-02", expiresAt: "2020-01-01" }),
  ], [], {}, Date.parse("2026-10-05"));
  const result = getTechnologyTrend(indexed, { technologies: ["NestJS"], rangeDays: 30, now: Date.parse("2026-10-05") });
  assert.equal(result.summaries[0].current, 1);
});

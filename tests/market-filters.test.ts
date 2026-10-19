import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { activeFilterChips, EMPTY_MARKET_FILTERS, filterJobsByTechnologies, filterMarketJobs, groupLocationVariants, groupedTechnologyOptions, isNodeBackendJob, locationLabels, pipelineDrilldown, pipelineRelevanceScore, presetTechnologies, selectChartTechnologies, sortFilteredOffers, sortJobPreviews, visibleTechnologyOptions, type MarketJob, type TechnologyDemand } from "../ui/src/marketFilters.ts";

const jobs: MarketJob[] = [
  { url: "1", title: "Backend", company: "A", countries: ["Poland"], workModel: "Remote", technologies: ["Node.js", "NestJS"], roleFamily: "Backend", active: true },
  { url: "2", title: "Backend", company: "B", countries: ["Poland"], workModel: "Office", technologies: ["Node.js", "Express"], roleFamily: "Backend", active: true },
  { url: "3", title: "Backend", company: "C", countries: ["Germany"], workModel: "Remote", technologies: ["Node.js", "Fastify"], roleFamily: "Backend", active: true },
  { url: "4", title: "Backend", company: "D", countries: ["Poland"], workModel: "Remote", technologies: ["Node.js", "NestJS"], roleFamily: "Backend", active: false },
];

test("country and work-model facets recalculate active Node counts", () => {
  assert.equal(filterMarketJobs(jobs, { technology: "Node.js" }).length, 3);
  assert.equal(filterMarketJobs(jobs, { country: "Poland", technology: "Node.js" }).length, 2);
  assert.equal(filterMarketJobs(jobs, { country: "Poland", workModel: "Remote", technology: "Node.js" }).length, 1);
});

test("same company, role, and date collapse into one row with merged locations", () => {
  const grouped = groupLocationVariants([
    { id: "remote", url: "https://example.com/remote", title: "React Developer", company: "Acme", date: "2026-10-18", location: "Remote, Warsaw" },
    { id: "poznan", url: "https://example.com/poznan", title: "React Developer", company: "Acme", date: "2026-10-18", location: "Poznan, Remote" },
    { id: "repost", url: "https://example.com/repost", title: "React Developer", company: "Acme", date: "2026-10-19", location: "Krakow" },
  ]);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].locationVariants?.length, 2);
  assert.deepEqual(locationLabels(grouped[0]), ["Remote", "Poznan", "Warsaw"]);
  assert.equal(grouped[1].locationVariants, undefined);
});

test("pending jobs rank target and accepted adjacent roles above foreign backend stacks", () => {
  const score = (title: string) => pipelineRelevanceScore({ title, company: "Acme" });
  for (const title of ["Java Developer", "Python Developer", "Senior .NET Engineer", "React + Java Fullstack Developer"]) {
    assert.ok(score("React Developer") > score(title), title);
    assert.ok(score("Node.js Developer") > score(title), title);
    assert.ok(score("CMS Administrator") > score(title), title);
    assert.ok(score("Technical Project Manager") > score(title), title);
  }
  assert.equal(pipelineRelevanceScore({ title: "Evaluated Java Developer", company: "Acme", compatibilityPercent: 0 }), 0);
});

test("Node preset requires Node.js in Backend or Fullstack jobs", () => {
  assert.equal(jobs.filter(isNodeBackendJob).length, 4);
  assert.equal(isNodeBackendJob({ ...jobs[0], roleFamily: "Frontend" }), false);
});

test("technology click-through preserves compatible Pipeline filters", () => {
  assert.deepEqual(pipelineDrilldown("NestJS", { country: "Poland", workModel: "Remote", minimumScore: 3.5 }), {
    technology: "NestJS", country: "Poland", workModel: "Remote", minimumScore: 3.5
  });
});

test("active filter chips show country, work model, and seniority", () => {
  const chips = activeFilterChips({ ...EMPTY_MARKET_FILTERS, country: "Poland", workModel: "Remote", seniority: "Senior" });
  assert.deepEqual(chips.map(chip => chip.label), ["Poland", "Remote", "Senior"]);
});

test("offer previews are relevant and ordered by match, score, then date", () => {
  const previews = sortJobPreviews([
    ...jobs,
    { url: "5", title: "Backend", company: "E", countries: ["Poland"], workModel: "Remote", technologies: ["NestJS"], roleFamily: "Backend", active: true, matchClassification: "STRONG MATCH", fitScore: 4.8 },
    { url: "6", title: "Backend", company: "F", countries: ["Poland"], workModel: "Remote", technologies: ["NestJS"], roleFamily: "Backend", active: true, matchClassification: "BEST MATCH", fitScore: 4.2 },
    { url: "7", title: "Backend", company: "G", countries: ["Poland"], workModel: "Remote", technologies: ["NestJS"], roleFamily: "Backend", active: true, matchClassification: "BEST MATCH", fitScore: 4.7 },
  ].filter(job => job.active !== false && job.technologies?.includes("NestJS"))).slice(0, 5);
  assert.equal(previews.length, 4);
  assert.deepEqual(previews.slice(0, 2).map(job => job.url), ["7", "6"]);
  assert.equal(previews.every(job => job.technologies?.includes("NestJS")), true);
});

test("analytics preview uses the shared App drawer without changing tabs", () => {
  const app = readFileSync(new URL("../ui/src/App.tsx", import.meta.url), "utf8");
  const analytics = readFileSync(new URL("../ui/src/MarketAnalytics.tsx", import.meta.url), "utf8");
  assert.match(app, /onOpenJob=\{handleSelectJob\}/);
  assert.match(analytics, /onOpen=\{onOpenJob\}/);
  assert.match(app, /job-details-overlay" onClick=\{\(\) => setSelectedJob\(null\)\}/);
});

const demand: TechnologyDemand[] = [
  "React", "Next.js", "TypeScript", "Vue.js", "Angular", "Node.js", "NestJS", "Express", "Fastify",
  "PostgreSQL", "Docker", "MongoDB", "Redis", "AWS", "Kubernetes", "Shopify",
].map((technology, index) => ({ technology, count: 100 - index }));

test("technology context groups prioritize relevant available technologies", () => {
  const backend = visibleTechnologyOptions(groupedTechnologyOptions(demand, "Backend")).map(row => row.technology);
  assert.equal(["NestJS", "Express", "Fastify", "PostgreSQL", "Docker"].every(technology => backend.includes(technology)), true);
  assert.equal(backend.includes("React"), false);
  const frontend = visibleTechnologyOptions(groupedTechnologyOptions(demand, "Frontend")).map(row => row.technology);
  assert.equal(["React", "Next.js", "TypeScript", "Vue.js", "Angular"].every(technology => frontend.includes(technology)), true);
});

test("technology counts recalculate after country and work-model filters", () => {
  const filtered = filterMarketJobs(jobs, { country: "Poland", workModel: "Remote" });
  const nodeCount = filtered.filter(job => job.technologies?.includes("Node.js")).length;
  const nestCount = filtered.filter(job => job.technologies?.includes("NestJS")).length;
  assert.deepEqual({ nodeCount, nestCount }, { nodeCount: 1, nestCount: 1 });
});

test("chart selection keeps requested technologies and caps at ten", () => {
  assert.deepEqual(selectChartTechnologies(["NestJS", "Express", "Fastify", "Docker"], demand), ["NestJS", "Express", "Fastify", "Docker"]);
  assert.equal(selectChartTechnologies(demand.map(row => row.technology), demand).length, 10);
});

test("Fullstack TS preset uses the requested stack and hides zero-count technologies", () => {
  assert.deepEqual(presetTechnologies("Fullstack TS", demand), ["React", "Next.js", "TypeScript", "Node.js", "NestJS", "PostgreSQL"]);
  const withoutFastify = groupedTechnologyOptions(demand.map(row => row.technology === "Fastify" ? { ...row, count: 0 } : row), "Backend");
  assert.equal(visibleTechnologyOptions(withoutFastify).some(row => row.technology === "Fastify"), false);
});

test("filtered offers combine normal filters with ANY and ALL technology matching", () => {
  const offers: MarketJob[] = [
    ...jobs,
    { url: "5", title: "Backend", company: "E", countries: ["Poland"], workModel: "Remote", technologies: ["PostgreSQL"], roleFamily: "Backend", active: true },
    { url: "6", title: "Backend", company: "F", countries: ["Poland"], workModel: "Remote", technologies: ["NestJS", "PostgreSQL"], roleFamily: "Backend", active: true },
    { url: "7", title: "Backend", company: "G", countries: ["Germany"], workModel: "Remote", technologies: ["NestJS", "PostgreSQL"], roleFamily: "Backend", active: true },
    { url: "8", title: "Backend", company: "H", countries: ["Poland"], workModel: "Remote", technologies: ["NestJS"], roleFamily: "Backend", status: "expired" },
  ];
  const polandBackend = filterMarketJobs(offers, { country: "Poland", roleFamily: "Backend" });
  assert.deepEqual(filterJobsByTechnologies(polandBackend, ["NestJS"], "ANY").map(job => job.url), ["1", "6"]);
  assert.deepEqual(filterJobsByTechnologies(polandBackend, ["NestJS", "PostgreSQL"], "ANY").map(job => job.url), ["1", "5", "6"]);
  assert.deepEqual(filterJobsByTechnologies(polandBackend, ["NestJS", "PostgreSQL"], "ALL").map(job => job.url), ["6"]);
  assert.equal(filterJobsByTechnologies(polandBackend, [], "ANY").length, polandBackend.length);
  assert.equal(filterJobsByTechnologies(filterMarketJobs(offers, { country: "Germany" }), ["NestJS"], "ANY").length, 1);
  assert.equal(polandBackend.some(job => job.url === "8"), false);
});

test("filtered offer sorting supports score and technology match count", () => {
  const offers: MarketJob[] = [
    { url: "1", title: "A", company: "A", technologies: ["NestJS"], fitScore: 4.8, publishedAt: "2026-10-01" },
    { url: "2", title: "B", company: "B", technologies: ["NestJS", "PostgreSQL"], fitScore: 4.5, publishedAt: "2026-10-02" },
  ];
  assert.deepEqual(sortFilteredOffers(offers, ["NestJS", "PostgreSQL"], "score").map(job => job.url), ["1", "2"]);
  assert.deepEqual(sortFilteredOffers(offers, ["NestJS", "PostgreSQL"], "technology").map(job => job.url), ["2", "1"]);
});

test("Filtered Offers reuses drawer and Apply while opening job URLs directly", () => {
  const app = readFileSync(new URL("../ui/src/App.tsx", import.meta.url), "utf8");
  const analytics = readFileSync(new URL("../ui/src/MarketAnalytics.tsx", import.meta.url), "utf8");
  assert.match(app, /onOpenJob=\{handleSelectJob\}/);
  assert.match(app, /renderApply=\{\(job\) => automation\.button\(job\)\}/);
  assert.match(analytics, /href=\{job\.url\} target="_blank" rel="noreferrer"/);
  assert.doesNotMatch(app, /onOpenOriginal=/);
  assert.doesNotMatch(app, /handleOpen\("url"/);
  assert.match(app, /href=\{selectedJob\.url\}[\s\S]*?Open Original Job/);
  assert.match(analytics, /setLowerView\("demand"\)/);
  assert.match(analytics, /setLowerView\("offers"\)/);
});

// Recompute derived dashboard scores only. Never edits pipeline/tracker rows.
import fs from "node:fs";
import path from "node:path";
import { parsePipeline } from "../server/fileAccess.ts";
import { careerOps } from "../server/careerOps.ts";

const jobs = parsePipeline().pending.filter(job => !["applied", "skipped"].includes(job.status));
const beforePath = process.argv.find(a => a.startsWith("--before="))?.slice(9);
const before = beforePath ? JSON.parse(fs.readFileSync(beforePath, "utf8")) : {};
const limit = Number(process.argv.find(a => a.startsWith("--fetch="))?.slice(8) || 0);
const result = await careerOps.rerankJobs(jobs, limit);
const rows = result.ranked.map(({ job, evaluation }) => ({
  company: job.company, title: job.title, url: job.url,
  before: before[job.url] ? { score: before[job.url].fitScore, percent: before[job.url].compatibilityPercent, classification: before[job.url].matchClassification } : null,
  score: evaluation.fitScore, percent: evaluation.compatibilityPercent,
  classification: evaluation.matchClassification, category: evaluation.rankingCategory,
  evidence: evaluation.evaluatedFrom, stack: evaluation.primaryStack,
  split: evaluation.responsibilitySplit, reason: evaluation.reason, components: evaluation.scoreBreakdown
}));
const distribution = subset => ({
  total: subset.length,
  pureFrontend: subset.filter(r => r.category === "pure-frontend").length,
  reactNextTs: subset.filter(r => r.stack.some(s => ["React", "Next.js", "TypeScript"].includes(s))).length,
  frontendHeavyFullstack: subset.filter(r => r.category === "frontend-heavy-fullstack").length,
  balancedFullstack: subset.filter(r => r.category === "balanced-fullstack").length,
  backendHeavyFullstack: subset.filter(r => r.category === "backend-heavy" && /full[ -]?stack/i.test(r.title)).length,
  fullstackTitles: subset.filter(r => /full[ -]?stack/i.test(r.title)).length,
  reactNative: subset.filter(r => /react[ -]?native/i.test(r.title) || r.category === "mobile").length,
  unconfirmed: subset.filter(r => r.category === "unconfirmed").length,
  fullJd: subset.filter(r => r.evidence === "full-jd").length
});
const summary = { total: rows.length, bestMatches: distribution(rows.filter(r => r.classification === "BEST MATCH")), top50: distribution(rows.slice(0, 50)),
  regressions: rows.filter(r => /co\.brick|edge one/i.test(r.company) && /frontend/i.test(r.title)),
  demotedBest: rows.filter(r => r.before?.classification === "BEST MATCH" && r.classification !== "BEST MATCH").length };
const dir = path.resolve("reports");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "frontend-ranking-audit.json"), JSON.stringify({ summary, top50: rows.slice(0, 50), allActive: rows }, null, 2));
const table = rows.slice(0, 50).map((r, i) => `| ${i + 1} | ${r.company.replaceAll("|", "/")} | [${r.title.replaceAll("|", "/")}](${r.url}) | ${r.percent}% | ${r.score} | ${r.classification} | ${r.category} | ${r.evidence} |`).join("\n");
fs.writeFileSync(path.join(dir, "frontend-ranking-audit.md"), `# Frontend ranking audit\n\nRecomputed ${rows.length} active jobs. Scores are matching estimates, not hiring probabilities. Full-JD means saved or extracted text, not a fresh liveness check.\n\nTop 50: ${JSON.stringify(summary.top50)}\n\nBest Matches: ${JSON.stringify(summary.bestMatches)}\n\nReact/Next/TS is an overlapping stack count; the responsibility categories are separate.\n\n| # | Company | Role | Compatibility | Fit / 5 | Classification | Scope | Evidence |\n|---|---|---|---|---|---|---|---|\n${table}\n`);
console.log(JSON.stringify(summary, null, 2));

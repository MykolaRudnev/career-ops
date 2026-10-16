import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { inferJobCountries } from "./jobCountry.mjs";
import { sanitizeJobDescription } from "./jobMatch.mjs";

export const TECHNOLOGY_ALIASES_VERSION = 2;

export const TECHNOLOGY_GROUPS = {
  Frameworks: ["NestJS", "Express", "Fastify", "Koa", "Hapi", "AdonisJS", "FeathersJS", "LoopBack"],
  Databases: ["PostgreSQL", "MongoDB", "MySQL", "Redis"],
  "ORM / Data": ["Prisma", "TypeORM", "Sequelize", "Drizzle"],
  API: ["REST", "GraphQL", "tRPC"],
  Infrastructure: ["Docker", "Kubernetes", "AWS", "Azure", "GCP"],
  Architecture: ["Microservices", "Event-driven", "Kafka", "RabbitMQ"],
};

const DEFINITIONS = [
  ["Node.js", ["node", "nodejs", "node.js"], [/\bnode\.?js\b/i, /\bNode\b/]],
  ["NestJS", ["nest", "nestjs", "nest.js"], [/\bnest\.?js\b/i, /\bNest\b/]],
  ["Express", ["express", "expressjs", "express.js"], [/\bexpress\.?js\b/i, /\bExpress\b/]],
  ["Fastify", ["fastify"], [/\bfastify\b/i]],
  ["Koa", ["koa", "koa.js"], [/\bkoa(?:\.js)?\b/i]],
  ["Hapi", ["hapi", "hapi.js"], [/\bhapi(?:\.js)?\b/i]],
  ["AdonisJS", ["adonis", "adonisjs", "adonis.js"], [/\badonis(?:\.js|js)?\b/i]],
  ["FeathersJS", ["feathers", "feathersjs", "feathers.js"], [/\bfeathers(?:\.js|js)?\b/i]],
  ["LoopBack", ["loopback", "loop back"], [/\bloop\s?back\b/i]],
  ["React", ["react", "reactjs", "react.js"], [/\breact\.?js\b/i, /\bReact\b/]],
  ["Next.js", ["next", "nextjs", "next.js"], [/\bnext\.?js\b/i]],
  ["TypeScript", ["typescript", "ts"], [/\btypescript\b/i]],
  ["JavaScript", ["javascript", "js"], [/\bjavascript\b/i]],
  ["PostgreSQL", ["postgres", "postgresql"], [/\bpostgres(?:ql)?\b/i]],
  ["MongoDB", ["mongo", "mongodb"], [/\bmongo(?:db)?\b/i]],
  ["MySQL", ["mysql"], [/\bmysql\b/i]],
  ["Redis", ["redis"], [/\bredis\b/i]],
  ["Prisma", ["prisma"], [/\bprisma\b/i]],
  ["TypeORM", ["typeorm"], [/\btypeorm\b/i]],
  ["Sequelize", ["sequelize"], [/\bsequelize\b/i]],
  ["Drizzle", ["drizzle", "drizzle orm"], [/\bdrizzle\s+orm\b/i, /\bDrizzle\b/]],
  ["GraphQL", ["graphql"], [/\bgraphql\b/i]],
  ["REST", ["rest", "rest api", "restful"], [/\bREST(?:ful)?(?:\s+APIs?)?\b/, /\brestful\s+APIs?\b/i]],
  ["tRPC", ["trpc"], [/\btrpc\b/i]],
  ["Kafka", ["kafka", "apache kafka"], [/\bkafka\b/i]],
  ["RabbitMQ", ["rabbitmq", "rabbit mq"], [/\brabbit\s?mq\b/i]],
  ["Docker", ["docker"], [/\bdocker\b/i]],
  ["Kubernetes", ["kubernetes", "k8s"], [/\bkubernetes\b/i, /\bk8s\b/i]],
  ["AWS", ["aws", "amazon web services"], [/\baws\b/i, /\bamazon web services\b/i]],
  ["Azure", ["azure", "microsoft azure"], [/\b(?:microsoft\s+)?azure\b/i]],
  ["GCP", ["gcp", "google cloud", "google cloud platform"], [/\bgcp\b/i, /\bgoogle cloud(?: platform)?\b/i]],
  ["Microservices", ["microservices", "microservice"], [/\bmicroservices?\b/i]],
  ["Event-driven", ["event-driven", "event driven"], [/\bevent[ -]driven\b/i]],
  ["Angular", ["angular", "angularjs"], [/\bangular(?:js)?\b/i]],
  ["Vue.js", ["vue", "vuejs", "vue.js"], [/\bvue\.?js\b/i, /\bVue\b/]],
  ["Nuxt", ["nuxt", "nuxtjs", "nuxt.js"], [/\bnuxt(?:\.?js)?\b/i]],
  ["Svelte", ["svelte", "sveltekit"], [/\bsvelte(?:kit)?\b/i]],
  ["Tailwind CSS", ["tailwind", "tailwind css", "tailwindcss"], [/\btailwind(?:\s*css)?\b/i]],
  ["Styled Components", ["styled components", "styled-components"], [/\bstyled[ -]components\b/i]],
  ["HTML", ["html", "html5"], [/\bhtml5?\b/i]],
  ["CSS", ["css", "css3"], [/\bcss3?\b/i]],
  ["Storybook", ["storybook"], [/\bstorybook\b/i]],
  ["Terraform", ["terraform"], [/\bterraform\b/i]],
  ["CI/CD", ["ci/cd", "cicd", "continuous integration"], [/\bci\s*\/\s*cd\b/i, /\bcontinuous integration\b/i]],
  ["Elasticsearch", ["elasticsearch", "elastic search"], [/\belastic\s?search\b/i]],
  ["Shopify", ["shopify", "shopify plus"], [/\bshopify(?: plus)?\b/i]],
  ["Magento", ["magento", "magento 2"], [/\bmagento(?:\s*2)?\b/i]],
  ["Adobe Commerce", ["adobe commerce"], [/\badobe commerce\b/i]],
  ["Hyvä", ["hyva", "hyvä"], [/\bhyv[äa]\b/i]],
  ["Liquid", ["liquid", "shopify liquid"], [/\b(?:shopify\s+)?liquid\b/i]],
  ["WooCommerce", ["woocommerce", "woo commerce"], [/\bwoo\s?commerce\b/i]],
];

const EXACT_ALIASES = new Map(DEFINITIONS.flatMap(([name, aliases]) => aliases.map(alias => [fold(alias), name])));

function fold(value) {
  return String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").trim().toLowerCase();
}

function fieldText(value) {
  if (Array.isArray(value)) return value.join("\n");
  return typeof value === "string" ? value : "";
}

export function extractTechnologies(job) {
  const found = new Set();
  const structured = [job.technologies, job.techStack, job.requiredSkills, job.preferredSkills].flatMap(value => Array.isArray(value) ? value : []);
  for (const raw of structured) {
    const exact = EXACT_ALIASES.get(fold(raw));
    if (exact) found.add(exact);
  }
  const description = sanitizeJobDescription(fieldText(job.description), job.url || job.canonicalUrl || "");
  const text = [job.title, structured.join("\n"), description, fieldText(job.responsibilities), fieldText(job.requiredSkills), fieldText(job.preferredSkills)].filter(Boolean).join("\n");
  for (const [name, , patterns] of DEFINITIONS) {
    if (patterns.some(pattern => pattern.test(text))) found.add(name);
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

const COUNTRY_NAMES = {
  PL: "Poland", DE: "Germany", NL: "Netherlands", SE: "Sweden", FI: "Finland", DK: "Denmark", NO: "Norway",
  CZ: "Czechia", SK: "Slovakia", LT: "Lithuania", LV: "Latvia", EE: "Estonia", AT: "Austria", CH: "Switzerland",
  IE: "Ireland", GB: "United Kingdom", UK: "United Kingdom", FR: "France", BE: "Belgium", LU: "Luxembourg", PT: "Portugal",
  ES: "Spain", IT: "Italy", RO: "Romania", HU: "Hungary", HR: "Croatia", SI: "Slovenia", BG: "Bulgaria", GR: "Greece",
  CY: "Cyprus", MT: "Malta", IS: "Iceland", US: "United States", CA: "Canada", AU: "Australia", NZ: "New Zealand",
};

function countriesFor(job) {
  const eligibility = String(job.eligibility || job.remoteEligibility || "");
  const broadEligibility = /WORLDWIDE|EUROPE|EMEA/i.test(eligibility);
  const values = [job.country, ...(job.countries || []), ...(!broadEligibility ? job.eligibleCountries || [] : [])]
    .map(value => COUNTRY_NAMES[String(value || "").toUpperCase()] || String(value || "").trim())
    .filter(value => value && !/^remote$/i.test(value));
  if (/WORLDWIDE/i.test(eligibility)) values.push("Worldwide");
  if (/EUROPE|EMEA/i.test(eligibility)) values.push("Europe / EMEA");
  const inferred = inferJobCountries(job.location || job.locationRaw || "").filter(value => value !== "Unknown");
  return [...new Set([...values, ...inferred])].length ? [...new Set([...values, ...inferred])] : ["Unknown"];
}

function workModelFor(job) {
  const value = fold(job.workModel || job.remoteType);
  if (value.includes("hybrid")) return "Hybrid";
  if (value.includes("remote") || value.includes("zdal")) return "Remote";
  const location = fold(`${job.location || ""} ${job.locationRaw || ""}`);
  if (location.includes("hybrid") || location.includes("hybryd")) return "Hybrid";
  if (location.includes("remote") || location.includes("zdal") || location.includes("anywhere")) return "Remote";
  return "Office";
}

function seniorityFor(job) {
  const value = fold(`${job.seniority || ""} ${job.title || ""}`);
  if (/\b(?:lead|principal|staff|head|manager)\b/.test(value)) return "Lead";
  if (/\b(?:senior|sr\.?|starszy)\b/.test(value)) return "Senior";
  if (/\b(?:junior|jr\.?|entry|intern|graduate)\b/.test(value)) return "Junior";
  return "Mid";
}

function roleFamilyFor(job, technologies) {
  const title = fold(job.title);
  if (/full[ -]?stack/.test(title)) return "Fullstack";
  if (/front[ -]?end|\breact\b|\bnext\.?js\b|\bui engineer/.test(title)) return "Frontend";
  if (/back[ -]?end|server[ -]?side|api engineer/.test(title)) return "Backend";
  if (/mobile|android|ios|react native|flutter/.test(title)) return "Mobile";
  if (/devops|site reliability|\bsre\b|platform engineer|cloud engineer/.test(title)) return "DevOps";
  if (/data engineer|data scientist|machine learning|\bml engineer|analytics engineer/.test(title)) return "Data";
  if (/product|project manager|designer|sales|marketing|recruit/.test(title)) return "Product/Other";
  if (technologies.includes("Node.js")) return technologies.some(tech => tech === "React" || tech === "Next.js") ? "Fullstack" : "Backend";
  return "Product/Other";
}

function isoDate(value) {
  const date = typeof value === "number" ? new Date(value) : new Date(String(value || ""));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function normalizeJobUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return String(value || "").trim().replace(/\/$/, "").toLowerCase();
  }
}

function sourceFor(job) {
  if (job.source) return job.source;
  if (job.sourceName) return job.sourceName;
  try { return new URL(job.url).hostname.replace(/^www\./, ""); } catch { return "Direct"; }
}

function statusIsActive(job, now) {
  if (/expired|closed|archived|invalid/i.test(String(job.status || ""))) return false;
  const expires = Date.parse(job.expiresAt || "");
  return !Number.isFinite(expires) || expires >= now;
}

export function normalizeAnalyticsJob(job, evaluation = {}, now = Date.now()) {
  const technologies = extractTechnologies(job);
  const url = job.canonicalUrl || job.url || job.applyUrl || "";
  const score = Number(job.pipelineScore ?? job.fitScore ?? evaluation.fitScore);
  return {
    jobId: String(job.id || createHash("sha1").update(`${url}\n${job.company}\n${job.title}`).digest("hex").slice(0, 16)),
    url: job.url || job.canonicalUrl || job.applyUrl || "",
    canonicalUrl: normalizeJobUrl(url),
    title: String(job.title || ""),
    company: String(job.company || ""),
    source: sourceFor(job),
    technologies,
    roleFamily: roleFamilyFor(job, technologies),
    countries: countriesFor(job),
    location: String(job.location || job.locationRaw || ""),
    workModel: workModelFor(job),
    seniority: seniorityFor(job),
    matchTier: job.matchClassification || evaluation.matchClassification || null,
    matchScore: Number.isFinite(score) ? score : null,
    publishedAt: isoDate(job.publishedAt ?? job.postedAt ?? job.date),
    discoveredAt: isoDate(job.discoveredAt ?? job.addedAt),
    active: statusIsActive(job, now),
  };
}

function aliasesFor(job) {
  return [job.url, job.canonicalUrl, job.applyUrl, ...(job.sourceAliases || []).flatMap(alias => [alias.url, alias.applyUrl])]
    .map(normalizeJobUrl).filter(Boolean);
}

export function buildAnalyticsIndex(normalizedJobs, pipelineJobs = [], evaluations = {}, now = Date.now()) {
  const pipelineByUrl = new Map();
  for (const job of pipelineJobs) for (const key of aliasesFor(job)) pipelineByUrl.set(key, job);
  const candidates = [];
  for (const raw of normalizedJobs || []) {
    const overlay = aliasesFor(raw).map(key => pipelineByUrl.get(key)).find(Boolean);
    const evaluation = evaluations[raw.url] || evaluations[raw.canonicalUrl] || evaluations[overlay?.url] || {};
    const description = raw.description || evaluation.matchDescription || overlay?.description || "";
    candidates.push({
      ...overlay,
      ...raw,
      description,
      technologies: raw.technologies?.length ? raw.technologies : overlay?.technologies,
      pipelineScore: overlay?.pipelineScore ?? raw.pipelineScore,
      fitScore: overlay?.fitScore ?? raw.fitScore,
      matchClassification: overlay?.matchClassification ?? raw.matchClassification,
      status: overlay?.status ?? raw.status,
    });
  }
  const covered = new Set(candidates.flatMap(aliasesFor));
  for (const job of pipelineJobs) {
    if (aliasesFor(job).some(key => covered.has(key))) continue;
    const evaluation = evaluations[job.url] || {};
    candidates.push({ ...job, description: job.description || evaluation.matchDescription || "" });
  }

  const deduped = new Map();
  for (const job of candidates) {
    const evaluation = evaluations[job.url] || evaluations[job.canonicalUrl] || {};
    const normalized = normalizeAnalyticsJob(job, evaluation, now);
    if (!normalized.active || !normalized.title || !normalized.canonicalUrl) continue;
    const existing = deduped.get(normalized.canonicalUrl);
    if (!existing || normalized.technologies.length > existing.technologies.length) deduped.set(normalized.canonicalUrl, normalized);
  }
  return [...deduped.values()];
}

let cache = null;
const lookupCache = new WeakMap();

function fileStamp(file) {
  try { const stat = fs.statSync(file); return `${stat.mtimeMs}:${stat.size}`; } catch { return "missing"; }
}

export function getMarketAnalyticsIndex(workspaceRoot, pipelineJobs = []) {
  const latestPath = path.join(workspaceRoot, "data", "discovery-latest.json");
  const pipelinePath = path.join(workspaceRoot, "data", "pipeline.md");
  const evaluationPath = path.join(workspaceRoot, "scratch", "dashboard_eval_cache.json");
  const key = [TECHNOLOGY_ALIASES_VERSION, fileStamp(latestPath), fileStamp(pipelinePath), fileStamp(evaluationPath)].join(":");
  if (cache?.key === key) return cache.value;
  const latest = fs.existsSync(latestPath) ? JSON.parse(fs.readFileSync(latestPath, "utf8")) : { jobs: [] };
  const evaluations = fs.existsSync(evaluationPath) ? JSON.parse(fs.readFileSync(evaluationPath, "utf8")) : {};
  const jobs = buildAnalyticsIndex(latest.jobs || [], pipelineJobs, evaluations);
  const value = { version: TECHNOLOGY_ALIASES_VERSION, generatedAt: new Date().toISOString(), sourceGeneratedAt: latest.generatedAt || null, jobs };
  cache = { key, value };
  return value;
}

export function findAnalyticsJob(index, job) {
  let byUrl = lookupCache.get(index);
  if (!byUrl) {
    byUrl = new Map(index.jobs.map(row => [row.canonicalUrl, row]));
    lookupCache.set(index, byUrl);
  }
  return aliasesFor(job).map(key => byUrl.get(key)).find(Boolean) || null;
}

export function technologyCounts(jobs) {
  const counts = new Map();
  for (const job of jobs) for (const technology of new Set(job.technologies || [])) counts.set(technology, (counts.get(technology) || 0) + 1);
  return [...counts.entries()].map(([technology, count]) => ({ technology, count })).sort((a, b) => b.count - a.count || a.technology.localeCompare(b.technology));
}

export function cooccurrence(jobs, selectedTechnology) {
  const selected = jobs.filter(job => job.technologies?.includes(selectedTechnology));
  if (!selected.length) return [];
  return technologyCounts(selected).filter(row => row.technology !== selectedTechnology)
    .map(row => ({ ...row, percentage: Math.round(row.count * 1000 / selected.length) / 10 }));
}

export function filterAnalyticsJobs(jobs, filters = {}) {
  const search = String(filters.search || "").trim().toLowerCase();
  return jobs.filter(job => {
    if (job.active === false) return false;
    if (filters.country && filters.country !== "ALL" && !job.countries?.includes(filters.country)) return false;
    if (filters.workModel && filters.workModel !== "ALL" && job.workModel !== filters.workModel) return false;
    if (filters.seniority && filters.seniority !== "ALL" && job.seniority !== filters.seniority) return false;
    if (filters.roleFamily && filters.roleFamily !== "ALL" && job.roleFamily !== filters.roleFamily) return false;
    if (filters.source && filters.source !== "ALL" && job.source !== filters.source) return false;
    if (filters.matchTier && filters.matchTier !== "ALL" && job.matchTier !== filters.matchTier) return false;
    if ((Number(filters.minimumScore) || 0) > Number(job.matchScore || 0)) return false;
    if (filters.technology && !job.technologies?.includes(filters.technology)) return false;
    if (search && !`${job.title} ${job.company} ${job.location}`.toLowerCase().includes(search)) return false;
    return true;
  });
}

function usableTrendDate(job, now) {
  const published = Date.parse(job.publishedAt || "");
  if (Number.isFinite(published) && published <= now) return { date: published, source: "publishedAt" };
  const discovered = Date.parse(job.discoveredAt || "");
  if (Number.isFinite(discovered) && discovered <= now) return { date: discovered, source: "discoveredAt" };
  return null;
}

export function getTechnologyTrend(jobs, { technologies = [], filters = {}, rangeDays = 90, nodePreset = false, now = Date.now() } = {}) {
  const selected = [...new Set(technologies)].filter(Boolean).slice(0, 10);
  const range = [30, 90, 180].includes(Number(rangeDays)) ? Number(rangeDays) : 90;
  const filtered = filterAnalyticsJobs(jobs, { ...filters, days: 0 })
    .filter(job => !nodePreset || (job.technologies?.includes("Node.js") && ["Backend", "Fullstack"].includes(job.roleFamily)));
  const coverage = { publishedAt: 0, discoveredAtFallback: 0, missingDate: 0 };
  const dated = filtered.map(job => {
    const usable = usableTrendDate(job, now);
    if (!usable) coverage.missingDate++;
    else if (usable.source === "publishedAt") coverage.publishedAt++;
    else coverage.discoveredAtFallback++;
    return usable ? { job, date: usable.date } : null;
  }).filter(Boolean);

  const day = 86_400_000;
  const bucketDays = range === 30 ? 1 : 7;
  const step = bucketDays * day;
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  let start = today - (range - 1) * day;
  if (bucketDays === 7) start -= (new Date(start).getUTCDay() + 6) % 7 * day;
  const bucketCount = Math.floor((today - start) / step) + 1;
  const format = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = start + index * step;
    return { bucket: new Date(bucketStart).toISOString(), label: format.format(bucketStart), ...Object.fromEntries(selected.map(technology => [technology, 0])) };
  });
  for (const { job, date } of dated) {
    if (date < start || date > now) continue;
    const bucket = buckets[Math.min(buckets.length - 1, Math.floor((date - start) / step))];
    if (!bucket) continue;
    for (const technology of selected) if (job.technologies?.includes(technology)) bucket[technology]++;
  }

  const currentStart = now - range * day;
  const previousStart = now - range * 2 * day;
  const currentPeriodJobs = dated.filter(({ date }) => date >= currentStart && date <= now).length;
  const previousPeriodJobs = dated.filter(({ date }) => date >= previousStart && date < currentStart).length;
  const coverageRatio = previousPeriodJobs ? currentPeriodJobs / previousPeriodJobs : Infinity;
  const periodsComparable = currentPeriodJobs >= 10 && previousPeriodJobs >= 10 && coverageRatio >= 0.25 && coverageRatio <= 4;
  const summaries = selected.map(technology => {
    let current = 0;
    let previous = 0;
    for (const { job, date } of dated) {
      if (!job.technologies?.includes(technology)) continue;
      if (date >= currentStart && date <= now) current++;
      else if (date >= previousStart && date < currentStart) previous++;
    }
    return {
      technology,
      current,
      previous,
      changePercent: periodsComparable && current >= 3 && previous >= 3 ? Math.round((current - previous) * 1000 / previous) / 10 : null,
    };
  });
  const populatedBuckets = buckets.filter(bucket => selected.some(technology => Number(bucket[technology]) > 0)).length;
  const currentMentions = summaries.reduce((sum, row) => sum + row.current, 0);
  return {
    rangeDays: range,
    bucket: bucketDays === 1 ? "day" : "week",
    technologies: selected,
    data: buckets,
    summaries,
    coverage,
    filteredJobs: filtered.length,
    hasEnoughHistory: currentMentions >= 5 && populatedBuckets >= 2,
    warning: periodsComparable
      ? "Trend uses available Career-Ops posting history and may reflect source coverage changes."
      : "Trend percentages are unavailable because the comparable periods have materially different source coverage.",
  };
}

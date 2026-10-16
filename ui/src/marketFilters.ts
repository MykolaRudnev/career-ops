export type MarketJob = {
  jobId?: string;
  id?: string;
  url?: string;
  title: string;
  company: string;
  source?: string;
  technologies?: string[];
  roleFamily?: string;
  countries?: string[];
  location?: string;
  workModel?: string;
  seniority?: string;
  matchTier?: string | null;
  matchClassification?: string;
  matchScore?: number | null;
  fitScore?: number;
  publishedAt?: string | null;
  discoveredAt?: string | null;
  date?: string;
  active?: boolean;
  status?: string;
};

export type MarketFilters = {
  country: string;
  workModel: string;
  seniority: string;
  roleFamily: string;
  source: string;
  matchTier: string;
  minimumScore: number;
  technology: string;
  days: number;
  search?: string;
};

export const EMPTY_MARKET_FILTERS: MarketFilters = {
  country: "ALL", workModel: "ALL", seniority: "ALL", roleFamily: "ALL", source: "ALL",
  matchTier: "ALL", minimumScore: 0, technology: "", days: 0, search: ""
};

export type TechnologyContext = "All" | "Frontend" | "Backend" | "Fullstack" | "DevOps / Cloud" | "Data" | "E-commerce";

export const TECHNOLOGY_CONTEXTS: TechnologyContext[] = ["All", "Frontend", "Backend", "Fullstack", "DevOps / Cloud", "Data", "E-commerce"];

const FRONTEND = ["React", "Next.js", "TypeScript", "JavaScript", "Vue.js", "Nuxt", "Angular", "Svelte", "Tailwind CSS", "Styled Components", "GraphQL", "REST", "HTML", "CSS", "Storybook"];
const DEVOPS = ["Docker", "Kubernetes", "AWS", "Azure", "GCP", "Terraform", "CI/CD"];
const DATA = ["PostgreSQL", "MySQL", "MongoDB", "Redis", "Kafka", "Elasticsearch"];
const BACKEND_CORE = ["Node.js", "NestJS", "Express", "Fastify", "Koa", "Hapi", "AdonisJS", "FeathersJS", "LoopBack", "TypeScript", "Prisma", "TypeORM", "Sequelize", "Drizzle", "GraphQL", "REST", "tRPC", "RabbitMQ", "Microservices"];
const BACKEND = [...BACKEND_CORE, ...DATA, ...DEVOPS];
const ECOMMERCE = ["Magento", "Hyvä", "Adobe Commerce", "Shopify", "Liquid", "WooCommerce"];

export const TECHNOLOGY_PRESETS = {
  Frontend: { context: "Frontend", technologies: ["React", "Next.js", "TypeScript", "JavaScript", "Tailwind CSS"] },
  "Node Backend": { context: "Backend", technologies: ["Node.js", "NestJS", "Express", "Fastify", "PostgreSQL", "Docker"] },
  "Fullstack TS": { context: "Fullstack", technologies: ["React", "Next.js", "TypeScript", "Node.js", "NestJS", "PostgreSQL"] },
  Cloud: { context: "DevOps / Cloud", technologies: ["Docker", "Kubernetes", "AWS", "Azure", "GCP"] },
  "E-commerce": { context: "E-commerce", technologies: ["Magento", "Hyvä", "Shopify", "Liquid", "WooCommerce"] },
} as const;

export type TechnologyDemand = { technology: string; count: number };
export type TechnologyOptionGroup = { label: string; technologies: TechnologyDemand[] };

const SEARCH_ALIASES: Record<string, string> = {
  "Node.js": "node nodejs", NestJS: "nest nestjs", Express: "expressjs", "Next.js": "next nextjs",
  PostgreSQL: "postgres", MongoDB: "mongo", AWS: "amazon web services", GCP: "google cloud platform",
  Kubernetes: "k8s", Magento: "magento 2", Hyvä: "hyva", "CI/CD": "cicd continuous integration",
};

function searchKey(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function groupedTechnologyOptions(demand: TechnologyDemand[], context: TechnologyContext, search = ""): TechnologyOptionGroup[] {
  const available = new Map(demand.filter(row => row.count > 0).map(row => [row.technology, row.count]));
  const definitions: Array<[string, readonly string[]]> = context === "All" ? [
    ["Frontend", FRONTEND], ["Backend", BACKEND], ["DevOps / Cloud", DEVOPS], ["Data", DATA], ["E-commerce", ECOMMERCE],
  ] : context === "Fullstack" ? [
    ["Frontend", FRONTEND], ["Backend", BACKEND_CORE], ["Data", DATA], ["Infrastructure", DEVOPS],
  ] : [[context, context === "Frontend" ? FRONTEND : context === "Backend" ? BACKEND : context === "DevOps / Cloud" ? DEVOPS : context === "Data" ? DATA : ECOMMERCE]];
  const query = searchKey(search);
  const matches = (technology: string) => !query || searchKey(`${technology} ${SEARCH_ALIASES[technology] || ""}`).includes(query);
  const seen = new Set<string>();
  const groups = definitions.map(([label, names]) => ({
    label,
    technologies: names.filter(name => available.has(name) && !seen.has(name) && matches(name)).map(technology => {
      seen.add(technology);
      return { technology, count: available.get(technology)! };
    }).sort((a, b) => b.count - a.count || a.technology.localeCompare(b.technology)),
  })).filter(group => group.technologies.length);
  if (context === "All") {
    const other = demand.filter(row => row.count > 0 && !seen.has(row.technology) && matches(row.technology));
    if (other.length) groups.push({ label: "Other", technologies: other });
  }
  return groups;
}

export function visibleTechnologyOptions(groups: TechnologyOptionGroup[]) {
  return groups.flatMap(group => group.technologies).sort((a, b) => b.count - a.count || a.technology.localeCompare(b.technology));
}

export function presetTechnologies(preset: keyof typeof TECHNOLOGY_PRESETS, demand: TechnologyDemand[]) {
  const available = new Set(demand.filter(row => row.count > 0).map(row => row.technology));
  return TECHNOLOGY_PRESETS[preset].technologies.filter(technology => available.has(technology));
}

export function selectChartTechnologies(technologies: string[], demand: TechnologyDemand[], limit = 10) {
  const available = new Set(demand.filter(row => row.count > 0).map(row => row.technology));
  return [...new Set(technologies)].filter(technology => available.has(technology)).slice(0, limit);
}

export function isNodeBackendJob(job: MarketJob): boolean {
  return Boolean(job.technologies?.includes("Node.js") && ["Backend", "Fullstack"].includes(job.roleFamily || ""));
}

export function filterMarketJobs<T extends MarketJob>(jobs: T[], filters: Partial<MarketFilters>, now = Date.now()): T[] {
  const search = (filters.search || "").trim().toLowerCase();
  return jobs.filter(job => {
    if (job.active === false || ["expired", "closed", "archived"].includes(String(job.status || "").toLowerCase())) return false;
    if (filters.country && filters.country !== "ALL" && !job.countries?.includes(filters.country)) return false;
    if (filters.workModel && filters.workModel !== "ALL" && job.workModel !== filters.workModel) return false;
    if (filters.seniority && filters.seniority !== "ALL" && job.seniority !== filters.seniority) return false;
    if (filters.roleFamily && filters.roleFamily !== "ALL" && job.roleFamily !== filters.roleFamily) return false;
    if (filters.source && filters.source !== "ALL" && job.source !== filters.source) return false;
    if (filters.matchTier && filters.matchTier !== "ALL" && (job.matchTier || job.matchClassification) !== filters.matchTier) return false;
    if ((filters.minimumScore || 0) > Number(job.matchScore ?? job.fitScore ?? 0)) return false;
    if (filters.technology && !job.technologies?.includes(filters.technology)) return false;
    if (filters.days) {
      const date = Date.parse(job.publishedAt || job.discoveredAt || "");
      if (!Number.isFinite(date) || date < now - filters.days * 86_400_000) return false;
    }
    if (search && !`${job.title} ${job.company} ${job.location || ""}`.toLowerCase().includes(search)) return false;
    return true;
  });
}

export type TechnologyMatchMode = "ANY" | "ALL";
export type OfferSort = "best" | "newest" | "score" | "technology";

export function filterJobsByTechnologies<T extends MarketJob>(jobs: T[], technologies: string[], mode: TechnologyMatchMode): T[] {
  if (!technologies.length) return jobs;
  return jobs.filter(job => mode === "ALL"
    ? technologies.every(technology => job.technologies?.includes(technology))
    : technologies.some(technology => job.technologies?.includes(technology)));
}

export function sortFilteredOffers<T extends MarketJob>(jobs: T[], technologies: string[], sort: OfferSort): T[] {
  const tier = (job: T) => ({ "BEST MATCH": 4, "STRONG MATCH": 3, "POSSIBLE MATCH": 2, "LOW MATCH": 1 } as Record<string, number>)[job.matchClassification || job.matchTier || ""] || 0;
  const score = (job: T) => Number(job.fitScore ?? job.matchScore ?? 0);
  const date = (job: T) => Date.parse(job.publishedAt || job.discoveredAt || job.date || "") || 0;
  const matches = (job: T) => technologies.filter(technology => job.technologies?.includes(technology)).length;
  return [...jobs].sort((a, b) => sort === "newest" ? date(b) - date(a)
    : sort === "technology" ? matches(b) - matches(a) || score(b) - score(a) || date(b) - date(a)
    : sort === "best" ? tier(b) - tier(a) || score(b) - score(a) || date(b) - date(a)
    : score(b) - score(a) || date(b) - date(a));
}

export function pipelineDrilldown(technology: string, filters: Partial<MarketFilters>) {
  return {
    technology,
    country: filters.country || "ALL",
    workModel: filters.workModel || "ALL",
    minimumScore: filters.minimumScore || 0,
  };
}

export function activeFilterChips(filters: MarketFilters, nodePreset = false) {
  return [
    filters.country !== "ALL" ? { key: "country", label: filters.country } : null,
    filters.workModel !== "ALL" ? { key: "workModel", label: filters.workModel } : null,
    filters.seniority !== "ALL" ? { key: "seniority", label: filters.seniority } : null,
    filters.roleFamily !== "ALL" ? { key: "roleFamily", label: filters.roleFamily } : null,
    filters.source !== "ALL" ? { key: "source", label: filters.source } : null,
    filters.matchTier !== "ALL" ? { key: "matchTier", label: filters.matchTier } : null,
    filters.minimumScore ? { key: "minimumScore", label: `Score ${filters.minimumScore}+` } : null,
    filters.technology ? { key: "technology", label: filters.technology } : null,
    filters.days ? { key: "days", label: `Last ${filters.days} days` } : null,
    filters.search ? { key: "search", label: `“${filters.search}”` } : null,
    nodePreset ? { key: "nodePreset", label: "Node.js Backend" } : null,
  ].filter(Boolean) as Array<{ key: keyof MarketFilters | "nodePreset"; label: string }>;
}

export function sortJobPreviews<T extends MarketJob>(jobs: T[]): T[] {
  const rank = (job: T) => ({ "BEST MATCH": 4, "STRONG MATCH": 3, "POSSIBLE MATCH": 2, "LOW MATCH": 1 } as Record<string, number>)[job.matchClassification || job.matchTier || ""] || 0;
  const date = (job: T) => Date.parse(job.publishedAt || job.discoveredAt || job.date || "") || 0;
  return [...jobs].sort((a, b) => rank(b) - rank(a) || Number(b.fitScore ?? b.matchScore ?? 0) - Number(a.fitScore ?? a.matchScore ?? 0) || date(b) - date(a));
}

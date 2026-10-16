import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchTechnologyTrend, type AnalyticsIndex, type PipelineJob, type TechnologyTrend } from "./api";
import { activeFilterChips, EMPTY_MARKET_FILTERS, filterJobsByTechnologies, filterMarketJobs, groupedTechnologyOptions, isNodeBackendJob, presetTechnologies, selectChartTechnologies, sortFilteredOffers, sortJobPreviews, TECHNOLOGY_CONTEXTS, TECHNOLOGY_PRESETS, visibleTechnologyOptions, type MarketFilters, type MarketJob, type OfferSort, type TechnologyContext, type TechnologyMatchMode } from "./marketFilters";

const GROUPS = {
  Frameworks: ["NestJS", "Express", "Fastify", "Koa", "Hapi", "AdonisJS", "FeathersJS", "LoopBack"],
  Databases: ["PostgreSQL", "MongoDB", "MySQL", "Redis"],
  "ORM / Data": ["Prisma", "TypeORM", "Sequelize", "Drizzle"],
  API: ["REST", "GraphQL", "tRPC"],
  Infrastructure: ["Docker", "Kubernetes", "AWS", "Azure", "GCP"],
  Architecture: ["Microservices", "Event-driven", "Kafka", "RabbitMQ"],
} as const;

const GENERAL_TRENDS = ["React", "Next.js", "TypeScript"];
const TREND_COLORS = ["#7dd3fc", "#34d399", "#fbbf24", "#c084fc", "#fb7185", "#60a5fa", "#a3e635", "#f97316", "#e879f9", "#2dd4bf"];

function technologyColor(technology: string) {
  let hash = 0;
  for (const character of technology) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return TREND_COLORS[hash % TREND_COLORS.length];
}

function counts(jobs: MarketJob[]) {
  const map = new Map<string, number>();
  for (const job of jobs) for (const technology of new Set(job.technologies || [])) map.set(technology, (map.get(technology) || 0) + 1);
  return [...map].map(([technology, count]) => ({ technology, count })).sort((a, b) => b.count - a.count || a.technology.localeCompare(b.technology));
}

function topInGroup(jobs: MarketJob[], group: readonly string[]) {
  return counts(jobs).find(row => group.includes(row.technology))?.technology || "—";
}

function options(jobs: MarketJob[], field: "source" | "roleFamily" | "seniority" | "workModel") {
  return [...new Set(jobs.map(job => job[field]).filter(Boolean) as string[])].sort();
}

function postedAgo(job: PipelineJob) {
  const posted = Date.parse(job.publishedAt || job.discoveredAt || job.date || "");
  if (!Number.isFinite(posted)) return "—";
  const days = Math.max(0, Math.floor((Date.now() - posted) / 86_400_000));
  return days === 0 ? "Today" : `${days}d ago`;
}

function compactTechnologies(job: PipelineJob, selected: string[]) {
  const technologies = [...new Set(job.technologies || [])];
  const ordered = [...selected.filter(technology => technologies.includes(technology)), ...technologies.filter(technology => !selected.includes(technology))];
  return { visible: ordered.slice(0, 4), more: Math.max(0, ordered.length - 4) };
}

function OfferPreview({ jobs, limit, onMore, onOpen }: { jobs: PipelineJob[]; limit: number; onMore: () => void; onOpen: (job: PipelineJob) => void }) {
  if (!jobs.length) return <div className="offer-preview-empty">No actionable Pipeline offers match these filters.</div>;
  return <div className="offer-preview-list">
    <div className="offer-preview-heading">Recent / relevant offers</div>
    {jobs.slice(0, limit).map(job => <button className="offer-preview-card" key={job.url} onClick={() => onOpen(job)}>
      <span><strong>{job.title}</strong><small>{job.company}</small></span>
      <span><small>{job.location || "Location unknown"} · {job.workModel} · {job.seniority || "Mid"}</small><small>{job.source || job.sourceName || "Direct"}{job.publishedAt || job.date ? ` · ${new Date(job.publishedAt || job.date).toLocaleDateString()}` : ""}</small></span>
      <span className="offer-preview-score">{job.fitScore ? job.fitScore.toFixed(1) : "—"}<small>{job.matchClassification || "Not evaluated"}</small></span>
    </button>)}
    {jobs.length > limit && <button className="btn btn-outline btn-sm offer-preview-more" onClick={onMore}>Show more</button>}
  </div>;
}

type Props = {
  index: AnalyticsIndex | null;
  pipelineJobs: PipelineJob[];
  onOpenPipeline: (technology: string, filters: MarketFilters) => void;
  onOpenJob: (job: PipelineJob) => void;
  renderApply: (job: PipelineJob) => ReactNode;
};

export function MarketAnalytics({ index, pipelineJobs, onOpenPipeline, onOpenJob, renderApply }: Props) {
  const jobs = index?.jobs || [];
  const [filters, setFilters] = useState<MarketFilters>({ ...EMPTY_MARKET_FILTERS });
  const [technologyContext, setTechnologyContext] = useState<TechnologyContext>("All");
  const [activePreset, setActivePreset] = useState<keyof typeof TECHNOLOGY_PRESETS | "">("");
  const [technologySearch, setTechnologySearch] = useState("");
  const [technologySelectorSearch, setTechnologySelectorSearch] = useState("");
  const [selectionWarning, setSelectionWarning] = useState("");
  const [trendRange, setTrendRange] = useState<30 | 90 | 180>(90);
  const [trendTechnologies, setTrendTechnologies] = useState(GENERAL_TRENDS);
  const [hiddenTrendTechnologies, setHiddenTrendTechnologies] = useState<string[]>([]);
  const [trend, setTrend] = useState<TechnologyTrend | null>(null);
  const [trendError, setTrendError] = useState("");
  const [preview, setPreview] = useState<{ technology: string; placement: "detail" | "table" } | null>(null);
  const [previewLimit, setPreviewLimit] = useState(5);
  const [lowerView, setLowerView] = useState<"demand" | "offers">("demand");
  const [technologyMatch, setTechnologyMatch] = useState<TechnologyMatchMode>("ANY");
  const [offerSort, setOfferSort] = useState<OfferSort>("score");
  const [offerSearch, setOfferSearch] = useState("");
  const [offerPage, setOfferPage] = useState(1);
  const [offerPageSize, setOfferPageSize] = useState<25 | 50 | 100>(25);
  const set = (key: keyof MarketFilters, value: string | number) => {
    setFilters(current => ({ ...current, [key]: value }));
    setOfferPage(1);
  };
  const nodePreset = activePreset === "Node Backend";

  const baseFilters = { ...filters, technology: "" };
  const baseJobs = useMemo(() => filterMarketJobs(jobs, baseFilters), [jobs, filters.country, filters.workModel, filters.seniority, filters.roleFamily, filters.source, filters.matchTier, filters.minimumScore, filters.days, filters.search]);
  const filtered = useMemo(() => filterMarketJobs(baseJobs, { technology: filters.technology }), [baseJobs, filters.technology]);
  const technologyDemand = useMemo(() => counts(filtered).filter(row => row.technology.toLowerCase().includes(technologySearch.toLowerCase())), [filtered, technologySearch]);
  const selectorDemand = useMemo(() => counts(baseJobs), [baseJobs]);
  const selectorGroups = useMemo(() => groupedTechnologyOptions(selectorDemand, technologyContext, technologySelectorSearch), [selectorDemand, technologyContext, technologySelectorSearch]);
  const fullstackGroups = useMemo(() => groupedTechnologyOptions(selectorDemand, "Fullstack"), [selectorDemand]);
  const visibleTechnologies = useMemo(() => visibleTechnologyOptions(selectorGroups), [selectorGroups]);
  const selectedTrendTechnologies = useMemo(() => selectChartTechnologies(trendTechnologies, selectorDemand), [trendTechnologies, selectorDemand]);
  const normallyFilteredOffers = useMemo(() => filterMarketJobs(pipelineJobs, filters), [pipelineJobs, filters.country, filters.workModel, filters.seniority, filters.roleFamily, filters.source, filters.matchTier, filters.minimumScore, filters.technology, filters.days, filters.search]);
  const selectedTechnologyKey = selectedTrendTechnologies.join("|");
  const offerMatchCounts = useMemo(() => ({
    any: filterJobsByTechnologies(normallyFilteredOffers, selectedTrendTechnologies, "ANY").length,
    all: filterJobsByTechnologies(normallyFilteredOffers, selectedTrendTechnologies, "ALL").length,
  }), [normallyFilteredOffers, selectedTechnologyKey]);
  const filteredOffers = useMemo(() => {
    const query = offerSearch.trim().toLowerCase();
    const matches = filterJobsByTechnologies(normallyFilteredOffers, selectedTrendTechnologies, technologyMatch)
      .filter(job => !query || `${job.title} ${job.company} ${(job.technologies || []).join(" ")}`.toLowerCase().includes(query));
    return sortFilteredOffers(matches, selectedTrendTechnologies, offerSort);
  }, [normallyFilteredOffers, selectedTechnologyKey, technologyMatch, offerSearch, offerSort]);
  const offerPageCount = Math.max(1, Math.ceil(filteredOffers.length / offerPageSize));
  const currentOfferPage = Math.min(offerPage, offerPageCount);
  const visibleOffers = filteredOffers.slice((currentOfferPage - 1) * offerPageSize, currentOfferPage * offerPageSize);
  const nodeJobs = useMemo(() => baseJobs.filter(isNodeBackendJob), [baseJobs]);
  const frameworkCounts = counts(nodeJobs).filter(row => GROUPS.Frameworks.includes(row.technology as typeof GROUPS.Frameworks[number]));
  const selectedTechnology = filters.technology || (nodePreset ? "Node.js" : "");
  const selectedJobs = baseJobs.filter(job => job.technologies?.includes(selectedTechnology));
  const paired = counts(selectedJobs).filter(row => row.technology !== selectedTechnology).slice(0, 10);
  const maxFramework = Math.max(1, frameworkCounts[0]?.count || 0);
  const countryOptions = [...new Set(jobs.flatMap(job => job.countries || []))].sort();
  const trendKey = JSON.stringify({ filters, trendRange, selectedTrendTechnologies });
  const currentTrend = trend?.technologies.join("|") === selectedTrendTechnologies.join("|") ? trend : null;

  useEffect(() => {
    if (!index || selectedTrendTechnologies.length === 0) return;
    const controller = new AbortController();
    setTrendError("");
    void fetchTechnologyTrend({ technologies: selectedTrendTechnologies, filters, rangeDays: trendRange, nodePreset: false }, controller.signal)
      .then(setTrend)
      .catch(error => { if (error.name !== "AbortError") setTrendError(error.message); });
    return () => controller.abort();
  }, [index?.generatedAt, trendKey]);

  const comparison = ["NestJS", "Express", "Fastify"].map(technology => {
    const frameworkJobs = nodeJobs.filter(job => job.technologies?.includes(technology));
    return {
      technology,
      jobs: frameworkJobs.length,
      share: nodeJobs.length ? Math.round(frameworkJobs.length * 1000 / nodeJobs.length) / 10 : 0,
      poland: frameworkJobs.filter(job => job.countries?.includes("Poland")).length,
      remote: frameworkJobs.filter(job => job.workModel === "Remote").length,
      senior: frameworkJobs.filter(job => ["Senior", "Lead"].includes(job.seniority || "")).length,
      database: topInGroup(frameworkJobs, GROUPS.Databases),
      cloud: topInGroup(frameworkJobs, ["AWS", "Azure", "GCP"]),
      paired: counts(frameworkJobs).filter(row => row.technology !== technology).slice(0, 3).map(row => row.technology).join(", ") || "—"
    };
  });

  const previewJobs = (technology: string) => sortJobPreviews(filterMarketJobs(pipelineJobs, { ...filters, technology })
  );

  const chooseTechnologies = (technologies: string[], warning = "") => {
    setTrendTechnologies(selectChartTechnologies(technologies, selectorDemand));
    setHiddenTrendTechnologies([]);
    setSelectionWarning(warning);
    setOfferPage(1);
  };

  const applyPreset = (preset: keyof typeof TECHNOLOGY_PRESETS) => {
    setTechnologyContext(TECHNOLOGY_PRESETS[preset].context);
    setActivePreset(preset);
    chooseTechnologies(presetTechnologies(preset, selectorDemand));
  };

  const toggleTrendTechnology = (technology: string) => {
    setActivePreset("");
    setSelectionWarning("");
    if (trendTechnologies.includes(technology)) chooseTechnologies(trendTechnologies.filter(item => item !== technology));
    else if (selectedTrendTechnologies.length < 10) chooseTechnologies([...selectedTrendTechnologies, technology]);
    else setSelectionWarning("Too many technologies selected for a readable chart. Maximum 10.");
  };

  const openPreview = (technology: string, placement: "detail" | "table") => {
    setPreview(current => current?.technology === technology && current.placement === placement ? null : { technology, placement });
    setPreviewLimit(5);
  };

  const reset = () => {
    setFilters({ ...EMPTY_MARKET_FILTERS });
    setTechnologyContext("All");
    setActivePreset("");
    setTechnologySearch("");
    setTechnologySelectorSearch("");
    chooseTechnologies(GENERAL_TRENDS);
  };

  const activeFilters = activeFilterChips(filters);

  if (!index) return <section className="card"><div className="card-title">Market Analytics</div><p className="analytics-muted">Building the local deterministic index…</p></section>;

  return <section className="market-analytics">
    <div className="analytics-heading">
      <div><h2>Market Analytics</h2><p>{filtered.length.toLocaleString()} active jobs in the current view · zero AI calls</p></div>
    </div>

    <div className="analytics-filters">
      <label>Keyword<input value={filters.search || ""} onChange={event => set("search", event.target.value)} placeholder="Title, company, location" /></label>
      <label>Country<select value={filters.country} onChange={event => set("country", event.target.value)}><option value="ALL">All</option>{countryOptions.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Work model<select value={filters.workModel} onChange={event => set("workModel", event.target.value)}><option value="ALL">All</option>{options(jobs, "workModel").map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Seniority<select value={filters.seniority} onChange={event => set("seniority", event.target.value)}><option value="ALL">All</option>{options(jobs, "seniority").map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Role family<select value={filters.roleFamily} onChange={event => set("roleFamily", event.target.value)}><option value="ALL">All</option>{options(jobs, "roleFamily").map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Source<select value={filters.source} onChange={event => set("source", event.target.value)}><option value="ALL">All</option>{options(jobs, "source").map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Match tier<select value={filters.matchTier} onChange={event => set("matchTier", event.target.value)}><option value="ALL">All</option>{["BEST MATCH", "STRONG MATCH", "POSSIBLE MATCH", "LOW MATCH"].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Minimum score<select value={filters.minimumScore} onChange={event => set("minimumScore", Number(event.target.value))}>{[0, 3, 3.5, 4, 4.5].map(value => <option key={value} value={value}>{value || "Any"}</option>)}</select></label>
      <label>Posted<select value={filters.days} onChange={event => set("days", Number(event.target.value))}><option value={0}>Active</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></label>
      <button className="btn btn-outline" onClick={reset}>Reset</button>
    </div>

    <div className="active-filter-strip">
      <strong>{filtered.length.toLocaleString()} jobs match current filters</strong>
      <div>{activeFilters.map(filter => <button key={filter.key} onClick={() => filter.key !== "nodePreset" && set(filter.key, EMPTY_MARKET_FILTERS[filter.key] ?? "")}>{filter.label} ×</button>)}</div>
      {activeFilters.length > 0 && <button className="clear-filter-btn" onClick={reset}>Clear all</button>}
    </div>

    <div className="analytics-summary">
      <div><span>Active Jobs</span><strong>{filtered.length.toLocaleString()}</strong></div>
      <div><span>Frontend Jobs</span><strong>{filtered.filter(job => job.roleFamily === "Frontend").length.toLocaleString()}</strong></div>
      <div><span>Node.js Jobs</span><strong>{filtered.filter(isNodeBackendJob).length.toLocaleString()}</strong></div>
      <div><span>Remote Jobs</span><strong>{filtered.filter(job => job.workModel === "Remote").length.toLocaleString()}</strong></div>
      <div><span>Senior Jobs</span><strong>{filtered.filter(job => ["Senior", "Lead"].includes(job.seniority || "")).length.toLocaleString()}</strong></div>
    </div>

    <section className="card analytics-card trend-card">
      <div className="card-header">
        <div><div className="card-title">Technology Trends — Last {trendRange === 180 ? "6 months" : `${trendRange} days`}</div><p className="analytics-muted">Absolute active-posting count per {trend?.bucket || (trendRange === 30 ? "day" : "week")}</p></div>
        <div className="trend-range">{([30, 90, 180] as const).map(range => <button key={range} className={`btn btn-sm ${trendRange === range ? "btn-secondary" : "btn-outline"}`} onClick={() => setTrendRange(range)}>{range === 180 ? "6 months" : `${range} days`}</button>)}</div>
      </div>
      <div className="technology-controls">
        <div className="technology-control-row"><strong>Technology context:</strong><div className="trend-tech-picker">{TECHNOLOGY_CONTEXTS.map(context => <button key={context} className={technologyContext === context ? "active" : ""} onClick={() => { setTechnologyContext(context); setActivePreset(""); setTechnologySelectorSearch(""); }}>{context}</button>)}</div></div>
        <div className="technology-control-row"><strong>Quick presets:</strong><div className="trend-tech-picker">{(Object.keys(TECHNOLOGY_PRESETS) as Array<keyof typeof TECHNOLOGY_PRESETS>).map(preset => <button key={preset} className={activePreset === preset ? "active" : ""} onClick={() => applyPreset(preset)}>{preset}</button>)}</div></div>
        <div className="technology-selector-row">
          <details className="technology-select"><summary>Choose technologies… <span>{visibleTechnologies.length}</span></summary><div className="technology-select-menu"><input value={technologySelectorSearch} onChange={event => setTechnologySelectorSearch(event.target.value)} placeholder="Search technology..." />{selectorGroups.map(group => <div className="technology-option-group" key={group.label}><strong>{group.label}</strong>{group.technologies.map(row => <label key={row.technology}><input type="checkbox" checked={selectedTrendTechnologies.includes(row.technology)} onChange={() => toggleTrendTechnology(row.technology)} /><span>{row.technology}</span><small>{row.count}</small></label>)}</div>)}{selectorGroups.length === 0 && <p>No technologies match the current filters.</p>}</div></details>
          <div className="technology-quick-actions"><button onClick={() => chooseTechnologies(visibleTechnologies.slice(0, 5).map(row => row.technology))}>Select top 5</button><button onClick={() => chooseTechnologies(visibleTechnologies.slice(0, 10).map(row => row.technology))}>Select top 10</button><button onClick={() => chooseTechnologies(visibleTechnologies.slice(0, 10).map(row => row.technology), visibleTechnologies.length > 10 ? "Too many technologies selected for a readable chart. Showing top 10 by demand." : "")}>Select all visible</button><button onClick={() => chooseTechnologies([])}>Clear</button></div>
        </div>
        <div className="selected-technologies"><strong>Selected:</strong>{selectedTrendTechnologies.length ? selectedTrendTechnologies.map(technology => <button key={technology} onClick={() => toggleTrendTechnology(technology)}>{technology} ×</button>) : <span>None</span>}</div>
        <div className="technology-offer-shortcuts"><strong>Technology match:</strong><div className="trend-tech-picker">{(["ANY", "ALL"] as const).map(mode => <button key={mode} className={technologyMatch === mode ? "active" : ""} onClick={() => { setTechnologyMatch(mode); setOfferPage(1); }}>{mode}</button>)}</div><span>ANY: {offerMatchCounts.any.toLocaleString()} · ALL: {offerMatchCounts.all.toLocaleString()}</span><button className="btn btn-secondary btn-sm" onClick={() => setLowerView("offers")}>Show matching offers</button></div>
        {selectionWarning && <p className="technology-selection-warning">{selectionWarning}</p>}
      </div>
      <div className="trend-summaries">{currentTrend?.summaries.map(row => <div key={row.technology}><span>{row.technology}</span><strong className={row.changePercent == null ? "neutral" : row.changePercent >= 0 ? "positive" : "negative"}>{row.changePercent == null ? "N/A" : `${row.changePercent > 0 ? "+" : ""}${row.changePercent}%`}</strong><small>vs previous period</small></div>)}</div>
      {selectedTrendTechnologies.length === 0 ? <div className="trend-empty">Choose at least one technology</div> : trendError ? <div className="trend-empty">{trendError}</div> : !currentTrend?.hasEnoughHistory ? <div className="trend-empty">Not enough historical data yet</div> : <div className="trend-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={currentTrend.data} margin={{ top: 8, right: 18, left: -18, bottom: 0 }}><CartesianGrid stroke="rgba(148,163,184,.14)" vertical={false} /><XAxis dataKey="label" stroke="#8b98a9" minTickGap={28} /><YAxis allowDecimals={false} stroke="#8b98a9" /><Tooltip contentStyle={{ background: "#151b20", border: "1px solid #33404a", borderRadius: 6 }} /><Legend wrapperStyle={{ cursor: "pointer" }} onClick={entry => setHiddenTrendTechnologies(current => current.includes(String(entry.dataKey)) ? current.filter(item => item !== entry.dataKey) : [...current, String(entry.dataKey)])} />{currentTrend.technologies.map(technology => <Line key={technology} type="monotone" dataKey={technology} stroke={technologyColor(technology)} strokeWidth={2} dot={false} activeDot={{ r: 4 }} hide={hiddenTrendTechnologies.includes(technology)} isAnimationActive={false} />)}</LineChart></ResponsiveContainer></div>}
      <p className="trend-warning">{currentTrend?.warning || "Trend uses available Career-Ops posting history and may reflect source coverage changes."}{currentTrend ? ` Dates: ${currentTrend.coverage.publishedAt.toLocaleString()} published · ${currentTrend.coverage.discoveredAtFallback.toLocaleString()} discovered fallback · ${currentTrend.coverage.missingDate.toLocaleString()} unknown.` : ""}</p>
    </section>

    {technologyContext === "Fullstack" && <section className="card analytics-card fullstack-summary"><div className="card-title">Fullstack Stack View</div><div className="stack-groups">{fullstackGroups.map(group => <div key={group.label}><h4>{group.label}</h4>{group.technologies.slice(0, 6).map(row => <button key={row.technology} onClick={() => toggleTrendTechnology(row.technology)}><span>{row.technology}</span><strong>{row.count}</strong></button>)}</div>)}</div></section>}

    {nodePreset && <>
      <section className="card analytics-card">
        <div className="card-title">Node.js Frameworks <span className="analytics-muted">{nodeJobs.length.toLocaleString()} backend / fullstack Node jobs</span></div>
        <div className="analytics-bars">{GROUPS.Frameworks.map(technology => {
          const count = frameworkCounts.find(row => row.technology === technology)?.count || 0;
          return <button key={technology} onClick={() => onOpenPipeline(technology, filters)}><span>{technology}</span><i><b style={{ width: `${count * 100 / maxFramework}%` }} /></i><strong>{count}</strong></button>;
        })}</div>
      </section>

      <section className="card analytics-card"><div className="card-title">Backend Stack</div><div className="stack-groups">{Object.entries(GROUPS).filter(([name]) => name !== "Frameworks").map(([name, technologies]) => <div key={name}><h4>{name}</h4>{technologies.map(technology => <button key={technology} onClick={() => set("technology", technology)}><span>{technology}</span><strong>{nodeJobs.filter(job => job.technologies?.includes(technology)).length}</strong></button>)}</div>)}</div></section>

      <section className="card analytics-card"><div className="card-title">NestJS vs Express vs Fastify</div><div className="table-container"><table className="jobs-table analytics-comparison"><thead><tr><th>Metric</th>{comparison.map(row => <th key={row.technology}>{row.technology}</th>)}</tr></thead><tbody>
        <tr><td>Jobs</td>{comparison.map(row => <td key={row.technology}>{row.jobs}</td>)}</tr>
        <tr><td>% of Node jobs</td>{comparison.map(row => <td key={row.technology}>{row.share}%</td>)}</tr>
        <tr><td>Poland</td>{comparison.map(row => <td key={row.technology}>{row.poland}</td>)}</tr>
        <tr><td>Remote</td>{comparison.map(row => <td key={row.technology}>{row.remote}</td>)}</tr>
        <tr><td>Senior / Lead</td>{comparison.map(row => <td key={row.technology}>{row.senior}</td>)}</tr>
        <tr><td>Top database</td>{comparison.map(row => <td key={row.technology}>{row.database}</td>)}</tr>
        <tr><td>Top cloud</td>{comparison.map(row => <td key={row.technology}>{row.cloud}</td>)}</tr>
        <tr><td>Top paired</td>{comparison.map(row => <td key={row.technology}>{row.paired}</td>)}</tr>
      </tbody></table></div></section>
    </>}

    {selectedTechnology && <section className="card analytics-card technology-detail">
      <div className="card-header"><div><div className="card-title">{selectedTechnology}</div><p className="analytics-muted">{selectedJobs.length.toLocaleString()} jobs · {baseJobs.length ? Math.round(selectedJobs.length * 1000 / baseJobs.length) / 10 : 0}% of the filtered dataset</p></div><div className="technology-detail-actions"><button className="btn btn-outline btn-sm" onClick={() => openPreview(selectedTechnology, "detail")}>Preview offers</button><button className="btn btn-secondary btn-sm" onClick={() => onOpenPipeline(selectedTechnology, filters)}>View all {selectedJobs.length.toLocaleString()} jobs</button></div></div>
      <div className="technology-detail-grid"><div><span>Trend</span><strong>{currentTrend?.summaries.find(row => row.technology === selectedTechnology)?.changePercent == null ? "N/A" : `${Number(currentTrend?.summaries.find(row => row.technology === selectedTechnology)?.changePercent) > 0 ? "+" : ""}${currentTrend?.summaries.find(row => row.technology === selectedTechnology)?.changePercent}%`}</strong></div>{paired.slice(0, 6).map(row => <button key={row.technology} onClick={() => set("technology", row.technology)}><span>{row.technology}</span><strong>{selectedJobs.length ? Math.round(row.count * 1000 / selectedJobs.length) / 10 : 0}%</strong></button>)}</div>
      {preview?.technology === selectedTechnology && preview.placement === "detail" && <OfferPreview jobs={previewJobs(selectedTechnology)} limit={previewLimit} onMore={() => setPreviewLimit(limit => limit + 5)} onOpen={onOpenJob} />}
    </section>}

    <section className="card analytics-card analytics-lower-section">
      <div className="analytics-lower-tabs" role="tablist"><button role="tab" aria-selected={lowerView === "demand"} className={lowerView === "demand" ? "active" : ""} onClick={() => setLowerView("demand")}>Technology Demand</button><button role="tab" aria-selected={lowerView === "offers"} className={lowerView === "offers" ? "active" : ""} onClick={() => setLowerView("offers")}>Filtered Offers ({filteredOffers.length.toLocaleString()})</button></div>
      {lowerView === "demand" ? <>
        <div className="card-header"><div className="card-title">Technology Demand</div><input className="search-input" placeholder="Search technology..." value={technologySearch} onChange={event => setTechnologySearch(event.target.value)} /></div>
        <div className="table-container"><table className="jobs-table analytics-tech-table"><thead><tr><th>Technology</th><th>Jobs</th><th>Share of filtered jobs</th><th>Actions</th></tr></thead><tbody>{technologyDemand.map(row => <Fragment key={row.technology}><tr><td><button onClick={() => set("technology", row.technology)}>{row.technology}</button></td><td>{row.count}</td><td>{filtered.length ? Math.round(row.count * 1000 / filtered.length) / 10 : 0}%</td><td><div className="analytics-row-actions"><button className="btn btn-outline btn-sm" onClick={() => openPreview(row.technology, "table")}>Preview offers</button><button className="btn btn-outline btn-sm" onClick={() => onOpenPipeline(row.technology, filters)}>View all jobs</button></div></td></tr>{preview?.technology === row.technology && preview.placement === "table" && <tr className="offer-preview-row"><td colSpan={4}><OfferPreview jobs={previewJobs(row.technology)} limit={previewLimit} onMore={() => setPreviewLimit(limit => limit + 5)} onOpen={onOpenJob} /></td></tr>}</Fragment>)}</tbody></table></div>
      </> : <>
        <div className="filtered-offers-heading"><div><div className="card-title">Filtered Offers — {filteredOffers.length.toLocaleString()} jobs</div><div className="filtered-offer-chips">{activeFilters.map(filter => <button key={filter.key} onClick={() => filter.key !== "nodePreset" && set(filter.key, EMPTY_MARKET_FILTERS[filter.key] ?? "")}>{filter.label} ×</button>)}{selectedTrendTechnologies.map(technology => <button key={technology} onClick={() => toggleTrendTechnology(technology)}>{technology} ×</button>)}<span>Match: {technologyMatch}</span>{selectedTrendTechnologies.length > 0 && <button className="clear-filter-btn" onClick={() => { chooseTechnologies([]); set("technology", ""); }}>Clear technology filters</button>}</div></div>
          <div className="filtered-offer-controls"><input className="search-input" placeholder="Search filtered offers..." value={offerSearch} onChange={event => { setOfferSearch(event.target.value); setOfferPage(1); }} /><label>Sort<select value={offerSort} onChange={event => { setOfferSort(event.target.value as OfferSort); setOfferPage(1); }}><option value="score">Highest Score</option><option value="best">Best Match</option><option value="newest">Newest</option><option value="technology">Technology Match Count</option></select></label></div>
        </div>
        <div className="table-container"><table className="jobs-table filtered-offers-table"><thead><tr><th>Job Title</th><th>Company</th><th>Location</th><th>Model</th><th>Seniority</th><th>Technologies</th><th>Fit</th><th>Source</th><th>Posted</th><th>Actions</th></tr></thead><tbody>{visibleOffers.map(job => {
          const technologies = compactTechnologies(job, selectedTrendTechnologies);
          return <tr key={job.url}><td><button className="offer-title-button" onClick={() => onOpenJob(job)}>{job.title}</button></td><td>{job.company}</td><td>{job.location || "—"}</td><td>{job.workModel || "—"}</td><td>{job.seniority || "—"}</td><td><div className="offer-technologies">{technologies.visible.map(technology => <span key={technology} className={selectedTrendTechnologies.includes(technology) ? "matched" : ""}>{technology}{selectedTrendTechnologies.includes(technology) ? " ✓" : ""}</span>)}{technologies.more > 0 && <small>+{technologies.more} more</small>}</div></td><td><strong>{job.fitScore?.toFixed(1) || "—"}</strong><small>{job.matchClassification || ""}</small></td><td>{job.sourceName || job.source || "Direct"}</td><td>{postedAgo(job)}</td><td><div className="analytics-row-actions"><button className="btn btn-outline btn-sm" onClick={() => onOpenJob(job)}>Preview</button>{job.url.startsWith("http") && <a className="btn btn-outline btn-sm" href={job.url} target="_blank" rel="noreferrer">Open Job</a>}{renderApply(job)}</div></td></tr>;
        })}{visibleOffers.length === 0 && <tr><td colSpan={10} className="empty-cell">No active jobs match these filters.</td></tr>}</tbody></table></div>
        <div className="filtered-offer-pagination"><span>Page {currentOfferPage} of {offerPageCount}</span><button className="btn btn-outline btn-sm" disabled={currentOfferPage === 1} onClick={() => setOfferPage(currentOfferPage - 1)}>Previous</button><button className="btn btn-outline btn-sm" disabled={currentOfferPage === offerPageCount} onClick={() => setOfferPage(currentOfferPage + 1)}>Next</button><label>Rows<select value={offerPageSize} onChange={event => { setOfferPageSize(Number(event.target.value) as 25 | 50 | 100); setOfferPage(1); }}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label></div>
      </>}
    </section>
  </section>;
}

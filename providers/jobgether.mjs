// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { fetchJsonWithRetry } from './_http.mjs';

const API = 'https://jobgether.com/api/v1/jobs';
const MAX_PAGES = 10;

const text = (v) => typeof v === 'string' ? v.trim() : '';
const epoch = (v) => { const n = Date.parse(v); return Number.isNaN(n) ? undefined : n; };

export function parseJobgetherResponse(json) {
  if (!json || !Array.isArray(json.jobs)) return [];
  return json.jobs.map((j) => {
    let url = '';
    try { const u = new URL(text(j?.url)); if (u.protocol === 'https:' && /(^|\.)jobgether\.com$/.test(u.hostname)) url = u.href; } catch {}
    if (!text(j?.title) || !url) return null;
    return {
      title: text(j.title), url, company: text(j.company), location: text(j.location),
      postedAt: epoch(j.postedAt), sourceJobId: text(j.id), sourceType: 'aggregator',
      remoteType: text(j.remote), employmentType: text(j.contractType), seniority: text(j.experience),
      salary: text(j.salaryRange), technologies: Array.isArray(j.jobFunctions) ? j.jobFunctions.filter(x => typeof x === 'string') : [],
    };
  }).filter(Boolean);
}

/** @type {Provider} */
export default {
  id: 'jobgether',
  detect: (entry) => entry?.provider === 'jobgether' ? { url: API } : null,
  async fetch(entry, ctx) {
    const cfg = entry?.jobgether || {};
    const queries = Array.isArray(cfg.queries) && cfg.queries.length ? cfg.queries : [cfg.keyword || ''];
    const maxPages = Math.min(Number(ctx?.maxPages) || Number(entry?.max_pages) || 2, MAX_PAGES);
    const out = [], seen = new Set();
    for (const query of queries.slice(0, 20)) {
      for (let page = 1; page <= maxPages; page++) {
        const u = new URL(API);
        if (query) u.searchParams.set('keyword', String(query));
        if (cfg.locations) u.searchParams.set('locations', Array.isArray(cfg.locations) ? cfg.locations.join(',') : String(cfg.locations));
        if (cfg.remoteType) u.searchParams.set('remoteType', String(cfg.remoteType));
        if (cfg.includeHybrid != null) u.searchParams.set('includeHybrid', String(Boolean(cfg.includeHybrid)));
        u.searchParams.set('sort', 'date'); u.searchParams.set('limit', '25'); u.searchParams.set('page', String(page));
        const json = await fetchJsonWithRetry(ctx, u.href, { redirect: 'error' });
        const rows = parseJobgetherResponse(json);
        for (const row of rows) if (!seen.has(row.url)) { seen.add(row.url); out.push(row); }
        if (!json?.pagination?.hasMore || rows.length === 0) break;
      }
    }
    return out;
  },
};

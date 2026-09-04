// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { fetchJsonWithRetry, sleep } from './_http.mjs';

const API = 'https://jobsearch.api.jobtechdev.se/search';
const MAX_PAGES = 10;
const text = (v) => typeof v === 'string' ? v.trim() : '';
const epoch = (v) => { const n = Date.parse(v); return Number.isNaN(n) ? undefined : n; };

export function parseJobtechResponse(json) {
  if (!json || !Array.isArray(json.hits)) return [];
  return json.hits.map((j) => {
    const apply = text(j?.application_details?.url);
    const listing = text(j?.webpage_url);
    let url = '';
    for (const candidate of [apply, listing]) { try { const u = new URL(candidate); if (u.protocol === 'https:') { url = u.href; break; } } catch {} }
    if (!text(j?.headline) || !url) return null;
    const a = j.workplace_address || {};
    return {
      title: text(j.headline), url, company: text(j?.employer?.name),
      location: [text(a.city), text(a.region), text(a.country)].filter(Boolean).join(', '),
      description: text(j?.description?.text), postedAt: epoch(j.publication_date), expiresAt: epoch(j.application_deadline),
      sourceJobId: text(j.id), employmentType: text(j?.employment_type?.label),
      remoteType: text(j?.workplace_model?.label), technologies: [...(j?.must_have?.skills || []), ...(j?.nice_to_have?.skills || [])].map(x => text(x?.label)).filter(Boolean),
    };
  }).filter(Boolean);
}

/** @type {Provider} */
export default {
  id: 'jobtech-sweden',
  detect: (entry) => entry?.provider === 'jobtech-sweden' ? { url: API } : null,
  async fetch(entry, ctx) {
    const cfg = entry?.jobtech || {};
    const queries = Array.isArray(cfg.queries) && cfg.queries.length ? cfg.queries : ['frontend', 'React', 'TypeScript'];
    const maxPages = Math.min(Number(ctx?.maxPages) || Number(entry?.max_pages) || 2, MAX_PAGES);
    const headers = { accept: 'application/json', ...(process.env.JOBTECH_API_KEY ? { 'api-key': process.env.JOBTECH_API_KEY } : {}) };
    const out = [], seen = new Set();
    for (const q of queries.slice(0, 20)) {
      for (let page = 0; page < maxPages; page++) {
        const u = new URL(API); u.searchParams.set('q', String(q)); u.searchParams.set('limit', '100'); u.searchParams.set('offset', String(page * 100));
        const json = await fetchJsonWithRetry(ctx, u.href, { headers, redirect: 'error' });
        const rows = parseJobtechResponse(json);
        for (const row of rows) if (!seen.has(row.sourceJobId || row.url)) { seen.add(row.sourceJobId || row.url); out.push(row); }
        if (rows.length < 100) break;
        await sleep(350, ctx);
      }
    }
    return out;
  },
};

// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Himalayas provider - board-wide remote jobs API
// (https://himalayas.app/jobs/api?limit=20). Returns { jobs: [...] }. The
// full feed is fetched so scan.mjs's title_filter / location_filter can do
// the local gating consistently with other zero-token board providers.
//
// Wire in via a `job_boards:` entry with `provider: himalayas`.

const FEED_URL = 'https://himalayas.app/jobs/api?limit=20';
const TRUSTED_HOST = 'himalayas.app';

/** @param {string} url */
function assertHimalayasUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`himalayas: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`himalayas: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`himalayas: untrusted hostname "${parsed.hostname}" - must be ${TRUSTED_HOST}`);
  }
  return url;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanHimalayasUrl(value) {
  const raw = cleanText(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    const trusted = host === TRUSTED_HOST || host.endsWith(`.${TRUSTED_HOST}`);
    return parsed.protocol === 'https:' && trusted ? parsed.href : '';
  } catch {
    return '';
  }
}

function locationText(value) {
  if (!Array.isArray(value)) return '';
  return value
    .filter(v => typeof v === 'string' && v.trim())
    .map(v => v.trim())
    .join(', ');
}

// Himalayas pubDate is currently epoch seconds. Accept milliseconds and
// parseable date strings too so the parser survives small API shape changes.
function toEpochMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

/** @type {Provider} */
export default {
  id: 'himalayas',

  detect(entry) {
    return entry?.provider === 'himalayas' ? { url: FEED_URL } : null;
  },

  /**
   * Fetches and normalizes postings from the Himalayas public feed.
   * @param {{ provider?: string }} entry - The job_boards entry being processed.
   * @param {{ fetchJson: (url: string, opts?: { redirect?: 'error'|'follow'|'manual' }) => Promise<any> }} ctx - HTTP context.
   * @returns {Promise<Array<{title: string, url: string, company: string, location: string, postedAt?: number}>>}
   */
  async fetch(entry, ctx) {
    const jobs = [], seen = new Set();
    let cursor;
    for (let page = 0; page < (entry.max_pages || 100); page++) {
      const url = new URL(FEED_URL);
      if (cursor) url.searchParams.set('cursor', cursor);
      const json = await ctx.fetchJson(assertHimalayasUrl(url.href), { redirect:'error' });
      if (!Array.isArray(json?.jobs)) throw new Error('himalayas: unexpected API response');
      jobs.push(...parseHimalayasResponse(json));
      if (!json.nextCursor || seen.has(json.nextCursor) || !json.jobs.length) return jobs;
      cursor = json.nextCursor; seen.add(cursor);
    }
    ctx.markPartial?.('Himalayas browse page budget reached; feed is not exhaustive');
    return jobs;
  },
};

/**
 * Parse Himalayas' public jobs API response. Exported for unit tests.
 *
 * Shape: `{ jobs: [...] }`, where each job currently carries `title`,
 * `companyName`, `locationRestrictions`, `applicationLink`, `guid`,
 * `pubDate`, and `companySlug`. `applicationLink` is preferred over `guid`
 * and used as the dedup key after HTTPS + host validation.
 *
 * @param {unknown} json - raw parsed API response
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseHimalayasResponse(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.jobs)) return [];

  const jobs = [];
  for (const item of json.jobs) {
    if (!item || typeof item !== 'object') continue;

    const title = cleanText(item.title);
    if (!title) continue;

    const url = cleanHimalayasUrl(item.applicationLink) || cleanHimalayasUrl(item.guid);
    if (!url) continue;

    jobs.push({
      title,
      url,
      company: cleanText(item.companyName),
      location: locationText((item.locationRestrictions || []).map(v => typeof v === 'string' ? v : v.name || v.alpha2)),
      eligibleCountries:(item.locationRestrictions || []).map(v => typeof v === 'string' ? v : v.alpha2 || v.name),
      timezoneRestrictions:item.timezoneRestrictions || [], workModel:'REMOTE',
      worldwide: Array.isArray(item.locationRestrictions) && item.locationRestrictions.length === 0 && !(item.timezoneRestrictions || []).length,
      applyUrl:item.applicationLink, description:item.description, sourceJobId:item.guid,
      salaryMin:item.minSalary, salaryMax:item.maxSalary, salaryCurrency:item.currency, salaryPeriod:item.salaryPeriod,
      seniority:item.seniority, employmentType:item.employmentType, technologies:item.categories || [], expiresAt:toEpochMs(item.expiryDate),
      postedAt: toEpochMs(item.pubDate),
    });
  }

  return jobs;
}

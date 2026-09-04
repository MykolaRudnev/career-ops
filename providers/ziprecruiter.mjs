// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// ZipRecruiter board provider. There is no unauthenticated public candidate-side
// search API suitable for this scanner; the documented API is partner/publisher
// access. This adapter therefore reads public pages, preferring JobPosting
// JSON-LD and falling back to semantic DOM text. It never attempts to solve or
// bypass CAPTCHA, Cloudflare, login walls, or other access controls.

import { createHash } from 'crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { dirname, isAbsolute, join, resolve } from 'path';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { classifyEligibility } from '../discovery/eligibility.mjs';
import { decodeEntities } from './_html-entities.mjs';
import { DEFAULT_USER_AGENT } from '../user-agent.mjs';

const SEARCH_URL = 'https://www.ziprecruiter.com/jobs-search';
const CACHE_PATH = join(getCareerOpsRoot(), 'scratch', 'ziprecruiter-cache.json');
const HEALTH_PATH = join(getCareerOpsRoot(), 'scratch', 'provider-health', 'ziprecruiter.json');
const SEARCH_TTL_MS = 6 * 60 * 60 * 1000;
const DETAIL_TTL_MS = 18 * 60 * 60 * 1000;
const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 4;
const DEFAULT_DETAIL_LIMIT = 20;
const MAX_DETAIL_LIMIT = 60;
const DEFAULT_QUERY_LIMIT = 17;
const NAVIGATION_TIMEOUT_MS = 18_000;
const BETWEEN_PAGES_MS = 900;
const CHALLENGE_SETTLE_MS = 3_500;
const ZIPRECRUITER_HOST_RE = /(^|\.)ziprecruiter\.(?:com|ie)$/i;
const PROFILE_SESSION_PATHS = Object.freeze([
  'Preferences', 'Secure Preferences', 'Cookies', 'Cookies-journal',
  'Local Storage', 'Session Storage',
]);

export const DEFAULT_QUERIES = Object.freeze([
  'Senior Frontend Developer', 'Frontend Engineer', 'React Developer',
  'React TypeScript', 'React Next.js', 'Next.js Developer', 'TypeScript Frontend',
  'Frontend Tech Lead', 'Product Engineer React', 'React Node.js',
  'Fullstack TypeScript', 'Magento 2', 'Magento Frontend', 'Hyvä Developer',
  'Shopify Developer', 'Shopify Liquid', 'Shopify Frontend Developer',
]);

export const DEFAULT_LOCATIONS = Object.freeze(['Remote', 'United States', 'Canada']);

export class ZipRecruiterBlockedError extends Error {
  constructor(reason) {
    super(`ziprecruiter: blocked — ${reason}`);
    this.name = 'ZipRecruiterBlockedError';
    this.code = 'EZIPRECRUITER_BLOCKED';
  }
}

export function assertZipRecruiterUrl(raw) {
  let url;
  try { url = new URL(String(raw || '')); }
  catch { throw new Error('ziprecruiter: invalid careers_url'); }
  if (url.protocol !== 'https:' || !ZIPRECRUITER_HOST_RE.test(url.hostname)) {
    throw new Error('ziprecruiter: careers_url must use https and an approved ZipRecruiter host');
  }
  return url.href;
}

const clean = (value) => String(value ?? '').replace(/[\t\u00a0 ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
const epoch = (value) => {
  if (!value) return undefined;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? undefined : parsed;
};
const hash = (value) => createHash('sha256').update(String(value || '')).digest('hex');

export function normalizeZipRecruiterUrl(raw, base = SEARCH_URL) {
  try {
    const url = new URL(String(raw || ''), base);
    if (url.protocol !== 'https:' || !ZIPRECRUITER_HOST_RE.test(url.hostname)) return '';
    if (/\/jobs?(?:-search|\/search)\/?$/i.test(url.pathname)) return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|ref|source|tsid|mid|widget|zrclid)$/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return '';
  }
}

export function buildZipRecruiterSearchUrl(base, query, location, page = 1) {
  const url = new URL(assertZipRecruiterUrl(base));
  url.hash = '';
  url.search = '';
  const pageNum = Number(page) || 1;
  if (/\.ie$/i.test(url.hostname)) {
    url.pathname = '/jobs/search';
    url.searchParams.set('q', query);
    url.searchParams.set('l', location);
    if (pageNum > 1) url.searchParams.set('page', String(pageNum));
  } else {
    url.searchParams.set('search', query);
    url.searchParams.set('location', location);
    if (pageNum > 1) url.searchParams.set('page', String(pageNum));
  }
  return url.href;
}

function expandHome(value) {
  const path = clean(value);
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return isAbsolute(path) ? path : resolve(getCareerOpsRoot(), path);
}

export function resolveBrowserProfileConfig(value) {
  if (!value || typeof value !== 'object' || !clean(value.userDataDir)) return null;
  const profileDirectory = clean(value.profileDirectory || 'Default');
  if (!/^(?:Default|Profile \d+)$/.test(profileDirectory)) {
    throw new Error('ziprecruiter: browserProfile.profileDirectory must be Default or Profile N');
  }
  const channel = clean(value.channel || 'chrome');
  if (!['chrome', 'chromium', 'msedge'].includes(channel)) {
    throw new Error('ziprecruiter: browserProfile.channel must be chrome, chromium, or msedge');
  }
  return {
    userDataDir: expandHome(value.userDataDir), profileDirectory, channel,
    headless: value.headless !== false, copySession: value.copySession !== false,
  };
}

function copyBrowserSession(profile) {
  const destination = mkdtempSync(join(tmpdir(), 'career-ops-ziprecruiter-'));
  const sourceProfile = join(profile.userDataDir, profile.profileDirectory);
  const destinationProfile = join(destination, profile.profileDirectory);
  mkdirSync(destinationProfile, { recursive: true });
  const localState = join(profile.userDataDir, 'Local State');
  if (existsSync(localState)) cpSync(localState, join(destination, 'Local State'));
  for (const relativePath of PROFILE_SESSION_PATHS) {
    const source = join(sourceProfile, relativePath);
    if (existsSync(source)) cpSync(source, join(destinationProfile, relativePath), { recursive: true });
  }
  return destination;
}

async function launchBrowserContext(chromium, cfg) {
  const profile = resolveBrowserProfileConfig(cfg?.browserProfile);
  if (!profile) {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ userAgent: DEFAULT_USER_AGENT, javaScriptEnabled: true });
    return { browser, context, cleanup: () => {} };
  }
  if (!existsSync(join(profile.userDataDir, profile.profileDirectory))) {
    throw new Error(`ziprecruiter: browser profile not found: ${join(profile.userDataDir, profile.profileDirectory)}`);
  }
  const userDataDir = profile.copySession ? copyBrowserSession(profile) : profile.userDataDir;
  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: profile.channel, headless: profile.headless, javaScriptEnabled: true,
      viewport: null, args: [`--profile-directory=${profile.profileDirectory}`],
      // Let the system browser use the same OS-backed cookie encryption as the source profile.
      ignoreDefaultArgs: ['--password-store=basic', '--use-mock-keychain'],
    });
    return {
      browser: context.browser(), context,
      cleanup: () => { if (profile.copySession) rmSync(userDataDir, { recursive: true, force: true }); },
    };
  } catch (error) {
    if (profile.copySession) rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }
}

export function sourceJobIdFromUrl(raw) {
  try {
    const url = new URL(raw);
    for (const key of ['job_id', 'jobId', 'jid', 'lvk']) {
      const value = clean(url.searchParams.get(key));
      if (value) return value;
    }
    const parts = url.pathname.split('/').filter(Boolean);
    return clean(parts.at(-1));
  } catch {
    return '';
  }
}

export function blockedReason(title, body) {
  const heading = String(title || '').toLowerCase();
  const text = String(body || '').toLowerCase();
  if (/just a moment|attention required|verify you are human/.test(heading)) return 'Cloudflare or bot challenge';
  if (/(?:cf-chl|cloudflare ray id)/.test(text)
    && /verify you are human|checking your browser|enable javascript and cookies/.test(text)) {
    return 'Cloudflare or bot challenge';
  }
  if (/captcha/.test(heading) || /unusual traffic|(?:complete|solve) (?:the )?captcha/.test(text)) return 'CAPTCHA';
  if (/access denied|forbidden|temporarily blocked/.test(heading)) return 'access denied';
  if (/sign in (?:or|to) continue|login required/.test(text)) return 'login required';
  if (/too many requests|rate limit/.test(text)) return 'rate limited';
  return '';
}

function htmlToText(value) {
  return clean(decodeEntities(String(value || ''))
    .replace(/<(script|style|nav|header|footer|aside)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(?:p|div|section|article|ul|ol|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' '));
}

function jsonLdNodes(value) {
  if (Array.isArray(value)) return value.flatMap(jsonLdNodes);
  if (!value || typeof value !== 'object') return [];
  const nested = Array.isArray(value['@graph']) ? value['@graph'].flatMap(jsonLdNodes) : [];
  return [value, ...nested];
}

function orgName(value) {
  return clean(typeof value === 'string' ? value : value?.name);
}

function locationText(node) {
  const locations = Array.isArray(node?.jobLocation) ? node.jobLocation : node?.jobLocation ? [node.jobLocation] : [];
  const values = locations.map((item) => {
    const address = item?.address || item;
    return clean([address?.addressLocality, address?.addressRegion, address?.addressCountry?.name || address?.addressCountry].filter(Boolean).join(', '));
  }).filter(Boolean);
  if (/telecommute/i.test(String(node?.jobLocationType || ''))) values.unshift('Remote');
  return [...new Set(values)].join(' | ');
}

function applicantLocations(node) {
  const items = Array.isArray(node?.applicantLocationRequirements)
    ? node.applicantLocationRequirements : node?.applicantLocationRequirements ? [node.applicantLocationRequirements] : [];
  return items.map((item) => clean(item?.name || item?.address?.addressCountry || item)).filter(Boolean);
}

function salaryText(value) {
  if (typeof value === 'string' || typeof value === 'number') return clean(value);
  if (!value || typeof value !== 'object') return '';
  const inner = value.value || value;
  const range = inner.minValue != null || inner.maxValue != null
    ? [inner.minValue, inner.maxValue].filter((v) => v != null).join('–')
    : inner.value != null ? String(inner.value) : '';
  return clean([value.currency || inner.currency, range, inner.unitText].filter(Boolean).join(' '));
}

export function parseJobPostingJsonLd(scripts, fallbackUrl = '') {
  for (const script of Array.isArray(scripts) ? scripts : []) {
    let parsed;
    try { parsed = typeof script === 'string' ? JSON.parse(script) : script; } catch { continue; }
    for (const node of jsonLdNodes(parsed)) {
      const types = Array.isArray(node?.['@type']) ? node['@type'] : [node?.['@type']];
      if (!types.some((type) => String(type).toLowerCase() === 'jobposting')) continue;
      const url = normalizeZipRecruiterUrl(node.url || fallbackUrl, fallbackUrl || SEARCH_URL) || normalizeZipRecruiterUrl(fallbackUrl);
      const description = htmlToText(node.description);
      const location = locationText(node);
      const eligibleCountries = applicantLocations(node);
      const eligibility = classifyEligibility({ location, description, eligibleCountries });
      return {
        title: clean(node.title), company: orgName(node.hiringOrganization), description,
        location, remoteType: /remote/i.test(`${node.jobLocationType || ''} ${location}`) ? 'REMOTE' : '',
        salary: salaryText(node.baseSalary), employmentType: clean(Array.isArray(node.employmentType) ? node.employmentType.join(', ') : node.employmentType),
        postedAt: epoch(node.datePosted), validThrough: epoch(node.validThrough),
        eligibleCountries, eligibility, url, sourceJobId: clean(node.identifier?.value || node.identifier || sourceJobIdFromUrl(url)),
        extractionMethod: 'JSON_LD',
      };
    }
  }
  return null;
}

export function mergeDetailFallback(structured, dom, fallbackUrl) {
  const base = structured || {};
  const description = clean(base.description || dom?.description || '');
  const location = clean(base.location || dom?.location || '');
  const eligibleCountries = Array.isArray(base.eligibleCountries) ? base.eligibleCountries : [];
  const sourceUrl = normalizeZipRecruiterUrl(base.url || fallbackUrl) || normalizeZipRecruiterUrl(fallbackUrl);
  let applicationUrl = '';
  try {
    const candidate = new URL(clean(dom?.applicationUrl));
    if (candidate.protocol === 'https:' && !ZIPRECRUITER_HOST_RE.test(candidate.hostname)) applicationUrl = candidate.href;
  } catch {}
  const url = applicationUrl || sourceUrl;
  return {
    title: clean(base.title || dom?.title), company: clean(base.company || dom?.company),
    description, location, salary: clean(base.salary || dom?.salary),
    employmentType: clean(base.employmentType || dom?.employmentType),
    remoteType: clean(base.remoteType || dom?.remoteType), postedAt: base.postedAt || epoch(dom?.datePosted),
    eligibleCountries, eligibility: base.eligibility || classifyEligibility({ location, description, eligibleCountries }),
    url, sourceUrl, applicationUrl, sourceJobId: clean(base.sourceJobId || sourceJobIdFromUrl(sourceUrl)),
    extractionMethod: structured ? 'JSON_LD' : 'DOM',
  };
}

function readCache() {
  try {
    const value = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
    return value && typeof value === 'object' ? value : { searches: {}, details: {} };
  } catch { return { searches: {}, details: {} }; }
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

async function withWorkers(items, concurrency, worker, signal) {
  let cursor = 0;
  const results = [];
  async function run() {
    while (cursor < items.length && !signal?.aborted) {
      const index = cursor++;
      try { results[index] = await worker(items[index], index); }
      catch (error) { results[index] = { error }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

async function readPageState(page) {
  const title = await page.title().catch(() => '');
  const body = await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '');
  return { title, body, reason: blockedReason(title, body.slice(0, 4_000)) };
}

async function pageState(page) {
  let state = await readPageState(page);
  if (state.reason) {
    await page.waitForTimeout(CHALLENGE_SETTLE_MS);
    state = await readPageState(page);
  }
  if (state.reason) throw new ZipRecruiterBlockedError(state.reason);
  return { title: state.title, body: state.body };
}

async function extractSearchPage(page) {
  return page.evaluate(() => {
    const out = [];
    const roots = Array.from(document.querySelectorAll('article, li, [data-testid*="job" i], [class*="job_result" i], [class*="job-card" i]'));
    const candidates = roots.length ? roots : Array.from(document.querySelectorAll('a[href]')).map((a) => a.parentElement || a);
    for (const root of candidates) {
      const anchor = root.matches?.('a[href]') ? root : root.querySelector?.('a[href*="/jobs/"], a[href*="/job/"], a[href*="/c/"]');
      if (!anchor) continue;
      const href = anchor.href || anchor.getAttribute('href') || '';
      const pathname = new URL(href, location.href).pathname;
      if (!/ziprecruiter\.(?:com|ie)/i.test(href) || !/(?:\/jobs?\/|\/c\/)/i.test(pathname) || /\/jobs(?:-search|\/search)\/?$/i.test(pathname)) continue;
      const title = (root.querySelector?.('h2,h3,[data-testid*="title" i]')?.textContent || anchor.textContent || '').trim();
      if (!title || title.length < 3 || /^(?:search|next|previous|filter)$/i.test(title)) continue;
      const company = (root.querySelector?.('[data-testid*="company" i],[class*="company" i]')?.textContent || '').trim();
      const locationText = (root.querySelector?.('[data-testid*="location" i],[class*="location" i]')?.textContent || '').trim();
      const salary = (root.querySelector?.('[data-testid*="salary" i],[class*="salary" i]')?.textContent || '').trim();
      const snippet = (root.querySelector?.('[class*="snippet" i],[data-testid*="snippet" i],p')?.textContent || '').trim();
      const posted = (root.querySelector?.('time,[class*="posted" i],[class*="date" i]')?.getAttribute?.('datetime') || root.querySelector?.('time,[class*="posted" i],[class*="date" i]')?.textContent || '').trim();
      if (title) out.push({ title, company, location: locationText, salary, snippet, posted, url: new URL(href, location.href).href });
    }
    return out;
  });
}

async function goToNextPage(page, query, location, nextPageNum) {
  const nextSelectors = [
    'a[rel="next"]',
    'a[aria-label*="next" i]',
    'button[aria-label*="next" i]',
    '[data-testid*="pagination-next" i]',
    '[data-testid*="next-page" i]',
    'a[class*="next_page" i]',
    'a[class*="pagination_next" i]',
    'nav a:has-text("Next")',
    '[class*="pagination" i] a:has-text("Next")',
  ];

  let navigated = false;
  for (const sel of nextSelectors) {
    try {
      const locator = page.locator(sel).first();
      if (await locator.count() > 0 && await locator.isVisible().catch(() => false)) {
        await locator.scrollIntoViewIfNeeded().catch(() => {});
        await Promise.all([
          page.waitForLoadState('domcontentloaded', { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {}),
          locator.click({ timeout: 4_000 }),
        ]);
        navigated = true;
        break;
      }
    } catch {
      // Continue to next selector
    }
  }

  if (!navigated) {
    const nextUrl = buildZipRecruiterSearchUrl(page.url(), query, location, nextPageNum);
    await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
  }

  await page.waitForSelector('main, article, [data-testid*="job" i], a[href]', { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(600);
}

async function extractDetailPage(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
  await page.waitForSelector('script[type="application/ld+json"], main, article, h1', { timeout: 5_000 }).catch(() => {});
  await pageState(page);
  const data = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((el) => el.textContent || '');
    const root = document.querySelector('main, [role="main"], article') || document.body;
    const clone = root?.cloneNode(true);
    clone?.querySelectorAll?.('script,style,nav,header,footer,aside,[class*="similar" i],[class*="recommend" i],[class*="cookie" i]').forEach((el) => el.remove());
    const find = (selectors) => (document.querySelector(selectors)?.textContent || '').trim();
    const apply = Array.from(document.querySelectorAll('a[href]')).find((a) => /apply/i.test(a.textContent || ''));
    return { scripts, dom: {
      title: find('h1'), company: find('[data-testid*="company" i],[class*="company" i]'),
      location: find('[data-testid*="location" i],[class*="location" i]'), salary: find('[data-testid*="salary" i],[class*="salary" i]'),
      employmentType: find('[class*="employment" i],[class*="job-type" i]'),
      description: clone?.innerText || '', applicationUrl: apply?.href || '',
      remoteType: /\bremote\b/i.test(clone?.innerText || '') ? 'REMOTE' : '',
      datePosted: document.querySelector('time')?.getAttribute('datetime') || '',
    }};
  });
  return mergeDetailFallback(parseJobPostingJsonLd(data.scripts, page.url()), data.dom, page.url());
}

/** @type {Provider} */
const provider = {
  id: 'ziprecruiter',
  detect(entry) {
    if (entry?.provider === 'ziprecruiter') return { url: assertZipRecruiterUrl(entry?.careers_url || SEARCH_URL) };
    try {
      const url = new URL(entry?.careers_url || '');
      return ZIPRECRUITER_HOST_RE.test(url.hostname) ? { url: assertZipRecruiterUrl(url.href) } : null;
    } catch { return null; }
  },
  dedupKey(job) { return job?.sourceJobId ? `ziprecruiter:${job.sourceJobId}` : null; },
  async fetch(entry, ctx) {
    const started = Date.now();
    const cfg = entry?.ziprecruiter || {};
    const searchBaseUrl = assertZipRecruiterUrl(entry?.careers_url || SEARCH_URL);
    const queries = (Array.isArray(cfg.queries) && cfg.queries.length ? cfg.queries : DEFAULT_QUERIES).slice(0, DEFAULT_QUERY_LIMIT);
    const locations = (Array.isArray(cfg.locations) && cfg.locations.length ? cfg.locations : DEFAULT_LOCATIONS).slice(0, 4);
    const query = clean(cfg.query || queries[0] || DEFAULT_QUERIES[0]);
    const location = clean(cfg.location || locations[0] || DEFAULT_LOCATIONS[0]);
    const maxPages = Math.min(Math.max(1, Number(cfg.maxPages || entry?.max_pages || ctx?.maxPages) || 5), 5);

    const cache = readCache(); cache.searches ||= {}; cache.details ||= {};
    const cacheKey = `${query}\u0000${location}\u0000${maxPages}`;
    const cached = cache.searches[cacheKey];
    if (!ctx?.nocache && cached && Array.isArray(cached.jobs) && cached.jobs.length > 0 && Date.now() - cached.fetchedAt < SEARCH_TTL_MS) {
      return cached.jobs;
    }

    const metrics = {
      status: 'READY',
      lastScan: new Date().toISOString(),
      searchPagesProcessed: 0,
      jobsDiscovered: 0,
      detailsExtracted: 0,
      structuredDataExtracted: 0,
      domFallbacks: 0,
      duplicates: 0,
      failures: 0,
      blockedPages: 0,
      averageResponseTimeMs: 0,
    };
    const responseTimes = [];
    let browser; let context; let interrupted = false;
    let cleanupBrowserSession = () => {};
    const abort = () => { interrupted = true; void context?.close().catch(() => {}); void browser?.close().catch(() => {}); };
    ctx?.signal?.addEventListener?.('abort', abort, { once: true });
    process.once('SIGINT', abort); process.once('SIGTERM', abort);

    try {
      const { chromium } = await import('playwright');
      ({ browser, context, cleanup: cleanupBrowserSession } = await launchBrowserContext(chromium, cfg));
      await context.route('**/*', (route) => ['image', 'media', 'font'].includes(route.request().resourceType()) ? route.abort() : route.continue());
      const searchPage = await context.newPage();
      const discovered = [];
      const seen = new Set();

      // One entry, one window, one browser session:
      const startUrl = buildZipRecruiterSearchUrl(searchBaseUrl, query, location, 1);
      const tick = Date.now();
      try {
        await searchPage.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
        const currentUrl = new URL(searchPage.url());
        if (ZIPRECRUITER_HOST_RE.test(currentUrl.hostname) && !currentUrl.searchParams.has('q') && !currentUrl.searchParams.has('search')) {
          const redirectedUrl = buildZipRecruiterSearchUrl(searchPage.url(), query, location, 1);
          if (redirectedUrl !== searchPage.url()) {
            await searchPage.goto(redirectedUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
          }
        }
        await searchPage.waitForSelector('main, article, [data-testid*="job" i], a[href]', { timeout: 5_000 }).catch(() => {});
        await pageState(searchPage);
      } catch (error) {
        if (error?.code === 'EZIPRECRUITER_BLOCKED') {
          metrics.blockedPages++;
          metrics.status = 'BLOCKED';
          metrics.reason = error.message;
          if (ctx?.maxPages === 1 || ctx?.probe) throw error;
          atomicJson(HEALTH_PATH, { ...metrics, durationMs: Date.now() - started });
          return [];
        }
        metrics.failures++;
        metrics.status = 'DEGRADED';
        throw error;
      } finally {
        responseTimes.push(Date.now() - tick);
      }

      // Pagination in the same session: up to maxPages (max 5)
      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        if (interrupted || ctx?.signal?.aborted) break;

        if (pageNum > 1) {
          await new Promise((resolve) => setTimeout(resolve, BETWEEN_PAGES_MS));
          if (interrupted || ctx?.signal?.aborted) break;

          const pageTick = Date.now();
          try {
            await goToNextPage(searchPage, query, location, pageNum);
            await pageState(searchPage);
          } catch (error) {
            if (error?.code === 'EZIPRECRUITER_BLOCKED') {
              metrics.blockedPages++;
              metrics.status = 'BLOCKED';
              metrics.reason = error.message;
              // Stop immediately: "если после 5 входов откидует клаудфлер то перестань заходить"
              break;
            }
            metrics.failures++;
            break;
          } finally {
            responseTimes.push(Date.now() - pageTick);
          }
        }

        const rows = await extractSearchPage(searchPage);
        metrics.searchPagesProcessed++;
        let newJobsOnThisPage = 0;

        for (const row of rows || []) {
          const url = normalizeZipRecruiterUrl(row.url);
          if (!url || !clean(row.title)) continue;
          const id = sourceJobIdFromUrl(url);
          const key = id || url;
          if (seen.has(key)) {
            metrics.duplicates++;
            continue;
          }
          seen.add(key);
          discovered.push({
            title: clean(row.title),
            url,
            company: clean(row.company || entry?.name),
            location: clean(row.location),
            salary: clean(row.salary),
            description: clean(row.snippet),
            postedAt: epoch(row.posted),
            sourceJobId: id,
            sourceType: 'aggregator',
            source: 'ziprecruiter',
          });
          newJobsOnThisPage++;
        }

        if (rows.length === 0 || newJobsOnThisPage === 0 || pageNum >= maxPages) {
          break;
        }
      }

      await searchPage.close().catch(() => {});
      metrics.jobsDiscovered = discovered.length;
      if (metrics.blockedPages > 0) {
        metrics.status = discovered.length > 0 ? 'DEGRADED' : 'BLOCKED';
      } else if (metrics.failures > 0) {
        metrics.status = 'DEGRADED';
      } else {
        metrics.status = 'READY';
      }

      if (interrupted || ctx?.signal?.aborted) throw Object.assign(new Error('ziprecruiter: scan cancelled'), { code: 'ABORT_ERR' });
      metrics.averageResponseTimeMs = responseTimes.length ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : 0;

      if (discovered.length > 0) {
        cache.searches[cacheKey] = { fetchedAt: Date.now(), jobs: discovered };
        atomicJson(CACHE_PATH, cache);
      }
      atomicJson(HEALTH_PATH, { ...metrics, durationMs: Date.now() - started });
      return discovered;
    } catch (error) {
      metrics.status = error?.code === 'EZIPRECRUITER_BLOCKED' ? 'BLOCKED' : error?.code === 'ABORT_ERR' ? 'DEGRADED' : 'ERROR';
      metrics.reason = clean(error?.message || error);
      metrics.averageResponseTimeMs = responseTimes.length ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : 0;
      atomicJson(HEALTH_PATH, { ...metrics, durationMs: Date.now() - started });
      throw error;
    } finally {
      ctx?.signal?.removeEventListener?.('abort', abort);
      process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort);
      await context?.close().catch(() => {}); await browser?.close().catch(() => {});
      cleanupBrowserSession();
    }
  },
};

export default provider;

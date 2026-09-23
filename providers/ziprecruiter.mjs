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
const DEFAULT_QUERY_LIMIT = 17;
const NAVIGATION_TIMEOUT_MS = 18_000;
const CHALLENGE_SETTLE_MS = 3_500;
const SEARCH_RESULT_LINK_SELECTOR = [
  'a[href*="/jobs/"]',
  'a[href*="/job/"]',
  'a[href*="/c/"]',
].join(',');
const SEARCH_EMPTY_SELECTOR = [
  '[data-testid*="no-results" i]',
  '[class*="no-results" i]',
  '[class*="empty-state" i]',
].join(',');
const DETAIL_READY_SELECTOR = [
  'script[type="application/ld+json"]',
  '[data-testid*="job-description" i]',
  '.job-body',
  '[class*="job-description" i]',
  '[class*="job_description" i]',
  '.jobDetail-header h1',
  'article h1',
  'main h1',
].join(',');
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
export function parsePostedAt(value, now = Date.now()) {
  const direct = epoch(value);
  if (direct) return direct;
  const text = clean(value).toLowerCase();
  if (!text) return undefined;
  if (/^(?:today|just posted|just now)$/.test(text)) return now;
  if (/^yesterday$/.test(text)) return now - 24 * 60 * 60 * 1000;
  const relative = text.match(/(\d+)\+?\s*(minute|hour|day|week|month)s?\s+ago/);
  if (!relative) return undefined;
  const units = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_592_000_000 };
  return now - Number(relative[1]) * units[relative[2]];
}

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
    if (candidate.protocol === 'https:') applicationUrl = candidate.href;
  } catch {}
  return {
    title: clean(base.title || dom?.title), company: clean(base.company || dom?.company),
    description, location, salary: clean(base.salary || dom?.salary),
    employmentType: clean(base.employmentType || dom?.employmentType),
    remoteType: clean(base.remoteType || dom?.remoteType), postedAt: base.postedAt || parsePostedAt(dom?.datePosted),
    eligibleCountries, eligibility: base.eligibility || classifyEligibility({ location, description, eligibleCountries }),
    url: sourceUrl, sourceUrl, applicationUrl, sourceJobId: clean(base.sourceJobId || sourceJobIdFromUrl(sourceUrl)),
    extractionMethod: structured ? 'JSON_LD' : 'DOM',
  };
}

export function mergeSearchResult(row, detail, entryName = '') {
  const sourceUrl = normalizeZipRecruiterUrl(detail?.sourceUrl || detail?.url || row?.url);
  const sourceJobId = clean(detail?.sourceJobId || sourceJobIdFromUrl(sourceUrl));
  const base = detail || {};
  return {
    ...base,
    title: clean(base.title || row?.title),
    company: clean(base.company || row?.company || entryName),
    location: clean(base.location || row?.location),
    salary: clean(base.salary || row?.salary),
    description: clean(base.description || row?.snippet),
    postedAt: base.postedAt || parsePostedAt(row?.posted),
    url: sourceUrl,
    sourceUrl,
    sourceJobId,
    sourceType: 'aggregator',
    source: 'ziprecruiter',
    extractionMethod: base.extractionMethod || 'LISTING',
  };
}

function readCache(path = CACHE_PATH) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return value && typeof value === 'object' ? value : { searches: {}, details: {} };
  } catch { return { searches: {}, details: {} }; }
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

function createDiagnostics(cfg) {
  const enabled = cfg?.diagnostics === true;
  const dirValue = clean(cfg?.diagnosticsDir || join('scratch', 'ziprecruiter-debug'));
  return {
    enabled, screenshots: enabled && cfg?.screenshots !== false,
    directory: expandHome(dirValue), counter: 0,
  };
}

function diagnosticLog(diag, event, details = {}, force = false) {
  if (!diag.enabled && !force) return;
  const record = { at: new Date().toISOString(), event, ...details };
  console.error(`[ziprecruiter] ${JSON.stringify(record)}`);
}

async function diagnosticStep(diag, page, event, details = {}, forceScreenshot = false) {
  diagnosticLog(diag, event, details, forceScreenshot);
  if ((!diag.screenshots && !forceScreenshot) || !page || page.isClosed?.()) return;
  try {
    mkdirSync(diag.directory, { recursive: true });
    const suffix = String(++diag.counter).padStart(3, '0');
    const filename = `${suffix}-${event.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}.png`;
    await page.screenshot({ path: join(diag.directory, filename), fullPage: false });
    diagnosticLog(diag, 'screenshot:saved', { event, path: join(diag.directory, filename) });
  } catch (error) {
    diagnosticLog(diag, 'screenshot:error', { event, error: clean(error?.message || error) }, true);
  }
}

function observePage(diag, page, label) {
  if (!diag.enabled) return;
  page.on('close', () => diagnosticLog(diag, 'page:closed', { page: label }));
  page.on('crash', () => diagnosticLog(diag, 'page:crashed', { page: label }, true));
  page.on('pageerror', (error) => diagnosticLog(diag, 'page:error', { page: label, error: clean(error?.message || error) }, true));
  page.on('requestfailed', (request) => {
    const type = request.resourceType();
    if (['document', 'xhr', 'fetch'].includes(type)) diagnosticLog(diag, 'request:failed', {
      page: label, type, url: request.url(), error: request.failure()?.errorText || '',
    }, true);
  });
}

function checkpointJob(path, cache, cacheKey, jobs, detailKey, job) {
  if (job.extractionMethod !== 'LISTING') cache.details[detailKey] = { fetchedAt: Date.now(), job };
  cache.searches[cacheKey] = { fetchedAt: Date.now(), jobs: [...jobs], complete: false };
  atomicJson(path, cache);
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

async function waitForSearchPage(page) {
  await pageState(page);
  await page.waitForFunction(
    ({ links, empty }) => {
      const hasJob = Array.from(document.querySelectorAll(links)).some((anchor) => {
        const url = new URL(anchor.href || anchor.getAttribute('href') || '', location.href);
        return /ziprecruiter\.(?:com|ie)$/i.test(url.hostname) && !/\/jobs(?:-search|\/search)\/?$/i.test(url.pathname);
      });
      const body = document.body?.innerText || '';
      return hasJob || Boolean(document.querySelector(empty)) || /(?:no|zero) jobs? (?:found|match)/i.test(body);
    },
    { links: SEARCH_RESULT_LINK_SELECTOR, empty: SEARCH_EMPTY_SELECTOR },
    { timeout: NAVIGATION_TIMEOUT_MS },
  );
  await pageState(page);
}
async function extractSearchPage(page) {
  return page.evaluate((linkSelector) => {
    const out = [];
    const seen = new Set();
    const anchors = Array.from(document.querySelectorAll(linkSelector));
    for (const anchor of anchors) {
      const url = new URL(anchor.href || anchor.getAttribute('href') || '', location.href);
      if (!/ziprecruiter\.(?:com|ie)$/i.test(url.hostname) || /\/jobs(?:-search|\/search)\/?$/i.test(url.pathname) || seen.has(url.href)) continue;
      const root = anchor.closest('article,li,[data-testid*="job" i],[class*="job_result" i],[class*="job-card" i],[class*="jobCard" i]') || anchor.parentElement || anchor;
      const title = (root.querySelector?.('h2,h3,h4,[data-testid*="title" i],[class*="title" i]')?.textContent || anchor.textContent || '').trim();
      if (!title || title.length < 3 || /^(?:search|next|previous|filter)$/i.test(title)) continue;
      const company = (root.querySelector?.('[data-testid*="company" i],[class*="company" i]')?.textContent || '').trim();
      const locationText = (root.querySelector?.('[data-testid*="location" i],[class*="location" i]')?.textContent || '').trim();
      const salary = (root.querySelector?.('[data-testid*="salary" i],[class*="salary" i]')?.textContent || '').trim();
      const snippet = (root.querySelector?.('[class*="snippet" i],[data-testid*="snippet" i],p')?.textContent || '').trim();
      const postedNode = root.querySelector?.('time,[class*="posted" i],[class*="date" i]');
      const posted = (postedNode?.getAttribute?.('datetime') || postedNode?.textContent || '').trim();
      seen.add(url.href);
      out.push({ title, company, location: locationText, salary, snippet, posted, url: url.href });
    }
    return out;
  }, SEARCH_RESULT_LINK_SELECTOR);
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

  await waitForSearchPage(page);
}

async function extractDetailPage(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
  await pageState(page);
  await page.locator(DETAIL_READY_SELECTOR).first().waitFor({ state: 'attached', timeout: NAVIGATION_TIMEOUT_MS });
  await pageState(page);
  const data = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((el) => el.textContent || '');
    const root = document.querySelector('[data-testid*="job-description" i],.job-body,[class*="job-description" i],[class*="job_description" i]')
      || document.querySelector('main, [role="main"], article') || document.body;
    const clone = root?.cloneNode(true);
    clone?.querySelectorAll?.('script,style,nav,header,footer,aside,[class*="similar" i],[class*="recommend" i],[class*="cookie" i]').forEach((el) => el.remove());
    const find = (selectors) => (document.querySelector(selectors)?.textContent || '').trim();
    const apply = Array.from(document.querySelectorAll('a[href]')).find((a) => {
      const label = `${a.textContent || ''} ${a.getAttribute('aria-label') || ''} ${a.getAttribute('data-testid') || ''}`;
      return /apply/i.test(label);
    });
    return { scripts, dom: {
      title: find('h1'), company: find('[data-testid*="company" i],[class*="company" i]'),
      location: find('[data-testid*="location" i],[class*="location" i]'), salary: find('[data-testid*="salary" i],[class*="salary" i]'),
      employmentType: find('[class*="employment" i],[class*="job-type" i]'),
      description: clone?.innerText || '', applicationUrl: apply?.href || '',
      remoteType: /\bremote\b/i.test(clone?.innerText || '') ? 'REMOTE' : '',
      datePosted: document.querySelector('time')?.getAttribute('datetime') || document.querySelector('time')?.textContent || find('[class*="posted" i],[class*="date" i]'),
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
    throw new Error('ziprecruiter: DISABLED — browser discovery retired; no MCP configured');
    const started = Date.now();
    const cfg = entry?.ziprecruiter || {};
    const searchBaseUrl = assertZipRecruiterUrl(entry?.careers_url || SEARCH_URL);
    const queries = (Array.isArray(cfg.queries) && cfg.queries.length ? cfg.queries : DEFAULT_QUERIES).slice(0, DEFAULT_QUERY_LIMIT);
    const locations = (Array.isArray(cfg.locations) && cfg.locations.length ? cfg.locations : DEFAULT_LOCATIONS).slice(0, 4);
    const query = clean(Object.hasOwn(cfg, 'query') ? cfg.query : queries[0] || DEFAULT_QUERIES[0]);
    const location = clean(Object.hasOwn(cfg, 'location') ? cfg.location : locations[0] || DEFAULT_LOCATIONS[0]);
    const diagnostics = createDiagnostics(cfg);
    const maxPages = Math.min(Math.max(1, Number(cfg.maxPages || entry?.max_pages || ctx?.maxPages) || 5), 5);

    const cachePath = ctx?.cachePath || CACHE_PATH;
    const healthPath = ctx?.healthPath || HEALTH_PATH;
    const cache = readCache(cachePath); cache.searches ||= {}; cache.details ||= {};
    const cacheKey = `${query}\u0000${location}\u0000${maxPages}`;
    const cached = cache.searches[cacheKey];
    if (!ctx?.nocache && cached?.complete !== false && Array.isArray(cached?.jobs) && cached.jobs.length > 0 && Date.now() - cached.fetchedAt < SEARCH_TTL_MS) {
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
    let searchPage; let detailPage;
    const discovered = [];
    const seen = new Set();
    let cleanupBrowserSession = () => {};
    const abort = () => { interrupted = true; void context?.close().catch(() => {}); void browser?.close().catch(() => {}); };
    ctx?.signal?.addEventListener?.('abort', abort, { once: true });
    process.once('SIGINT', abort); process.once('SIGTERM', abort);

    try {
      const chromium = ctx?.chromium || (await import('playwright')).chromium;
      ({ browser, context, cleanup: cleanupBrowserSession } = await launchBrowserContext(chromium, cfg));
      context.on('close', () => diagnosticLog(diagnostics, 'context:closed'));
      await ctx?.setupContext?.(context);
      await context.route('**/*', (route) => {
        const blocked = ['media', 'font', ...(diagnostics.screenshots ? [] : ['image'])];
        return blocked.includes(route.request().resourceType()) ? route.abort() : route.continue();
      });
      searchPage = await context.newPage();
      detailPage = await context.newPage();
      observePage(diagnostics, searchPage, 'search');
      observePage(diagnostics, detailPage, 'detail');

      // One entry, one window, one browser session:
      const startUrl = buildZipRecruiterSearchUrl(searchBaseUrl, query, location, 1);
      const tick = Date.now();
      try {
        diagnosticLog(diagnostics, 'search:navigate', { url: startUrl, query, location });
        await searchPage.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
        const currentUrl = new URL(searchPage.url());
        if (ZIPRECRUITER_HOST_RE.test(currentUrl.hostname) && !currentUrl.searchParams.has('q') && !currentUrl.searchParams.has('search')) {
          const redirectedUrl = buildZipRecruiterSearchUrl(searchPage.url(), query, location, 1);
          if (redirectedUrl !== searchPage.url()) {
            await searchPage.goto(redirectedUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
          }
        }
        await waitForSearchPage(searchPage);
        await diagnosticStep(diagnostics, searchPage, 'search:ready', { url: searchPage.url() });
      } catch (error) {
        await diagnosticStep(diagnostics, searchPage, 'search:error', { url: searchPage.url(), error: clean(error?.message || error) }, true);
        if (error?.code === 'EZIPRECRUITER_BLOCKED') {
          metrics.blockedPages++;
          metrics.status = 'BLOCKED';
          metrics.reason = error.message;
          if (ctx?.maxPages === 1 || ctx?.probe) throw error;
          atomicJson(healthPath, { ...metrics, durationMs: Date.now() - started });
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
          if (interrupted || ctx?.signal?.aborted) break;

          const pageTick = Date.now();
          try {
            await goToNextPage(searchPage, query, location, pageNum);
            await diagnosticStep(diagnostics, searchPage, 'search:page-ready', { page: pageNum, url: searchPage.url() });
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
        await diagnosticStep(diagnostics, searchPage, 'search:cards-extracted', { page: pageNum, count: rows.length });
        metrics.searchPagesProcessed++;
        let newJobsOnThisPage = 0;

        for (const row of rows || []) {
          if (interrupted || ctx?.signal?.aborted) break;
          const url = normalizeZipRecruiterUrl(row.url);
          if (!url || !clean(row.title)) continue;
          const id = sourceJobIdFromUrl(url);
          const key = id || url;
          if (seen.has(key)) {
            metrics.duplicates++;
            continue;
          }
          seen.add(key);
          let detail;
          const cachedDetail = cache.details[key];
          try {
            diagnosticLog(diagnostics, 'detail:navigate', { page: pageNum, index: newJobsOnThisPage + 1, title: clean(row.title), url });
            if (!ctx?.nocache && cachedDetail?.job && Date.now() - cachedDetail.fetchedAt < DETAIL_TTL_MS) {
              detail = cachedDetail.job;
              diagnosticLog(diagnostics, 'detail:cache-hit', { url });
            } else {
              const detailTick = Date.now();
              detail = await extractDetailPage(detailPage, url);
              responseTimes.push(Date.now() - detailTick);
            }
            metrics.detailsExtracted++;
            if (detail.extractionMethod === 'JSON_LD') metrics.structuredDataExtracted++;
            else metrics.domFallbacks++;
            await diagnosticStep(diagnostics, detailPage, 'detail:extracted', { title: detail.title || row.title, url, method: detail.extractionMethod });
          } catch (error) {
            metrics.failures++;
            if (error?.code === 'EZIPRECRUITER_BLOCKED') metrics.blockedPages++;
            await diagnosticStep(diagnostics, detailPage, 'detail:error', { title: clean(row.title), url, error: clean(error?.message || error) }, true);
          }
          const job = mergeSearchResult(row, detail, entry?.name);
          discovered.push(job);
          checkpointJob(cachePath, cache, cacheKey, discovered, key, job);
          try {
            await ctx?.onJob?.(job);
            diagnosticLog(diagnostics, 'job:saved', { count: discovered.length, title: job.title, url: job.url });
          } catch (error) {
            metrics.failures++;
            diagnosticLog(diagnostics, 'job:save-error', { title: job.title, url: job.url, error: clean(error?.message || error) }, true);
          }
          newJobsOnThisPage++;
        }

        if (rows.length === 0 || newJobsOnThisPage === 0 || pageNum >= maxPages) {
          break;
        }
      }

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
        cache.searches[cacheKey] = { fetchedAt: Date.now(), jobs: discovered, complete: true };
        atomicJson(cachePath, cache);
      }
      atomicJson(healthPath, { ...metrics, durationMs: Date.now() - started });
      diagnosticLog(diagnostics, 'scan:complete', { jobs: discovered.length, failures: metrics.failures, status: metrics.status });
      return discovered;
    } catch (error) {
      metrics.status = error?.code === 'EZIPRECRUITER_BLOCKED' ? 'BLOCKED' : error?.code === 'ABORT_ERR' ? 'DEGRADED' : 'ERROR';
      metrics.reason = clean(error?.message || error);
      metrics.averageResponseTimeMs = responseTimes.length ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : 0;
      atomicJson(healthPath, { ...metrics, durationMs: Date.now() - started });
      diagnosticLog(diagnostics, 'scan:error', { error: metrics.reason, savedJobs: discovered.length }, true);
      if (discovered.length > 0 && error?.code !== 'ABORT_ERR') {
        diagnosticLog(diagnostics, 'scan:returning-partial', { jobs: discovered.length }, true);
        return discovered;
      }
      throw error;
    } finally {
      ctx?.signal?.removeEventListener?.('abort', abort);
      process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort);
      diagnosticLog(diagnostics, 'browser:closing', { savedJobs: discovered.length });
      await detailPage?.close().catch(() => {});
      await searchPage?.close().catch(() => {});
      await context?.close().catch(() => {}); await browser?.close().catch(() => {});
      cleanupBrowserSession();
    }
  },
};

export default provider;

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import provider, {
  DEFAULT_QUERIES,
  assertZipRecruiterUrl,
  blockedReason,
  buildZipRecruiterSearchUrl,
  mergeDetailFallback,
  mergeSearchResult,
  normalizeZipRecruiterUrl,
  parsePostedAt,
  parseJobPostingJsonLd,
  resolveBrowserProfileConfig,
  sourceJobIdFromUrl,
} from '../../providers/ziprecruiter.mjs';
import { eligibilityPriority } from '../../discovery/eligibility.mjs';
import { probeProvider } from '../../verify-portals.mjs';
import { analyzeJobMatch } from '../../server/jobMatch.mjs';

test('ZipRecruiter provider exposes the configured discovery vocabulary', () => {
  for (const query of ['React Developer', 'Senior Frontend Developer', 'Next.js Developer', 'Shopify Developer', 'Magento Frontend']) {
    assert.ok(DEFAULT_QUERIES.includes(query));
  }
  assert.equal(provider.id, 'ziprecruiter');
});

test('normalizes tracking URLs while preserving source identity', () => {
  const url = normalizeZipRecruiterUrl('https://www.ziprecruiter.com/jobs/example?jid=abc123&utm_source=test&ref=email#apply');
  assert.equal(url, 'https://www.ziprecruiter.com/jobs/example?jid=abc123');
  assert.equal(sourceJobIdFromUrl(url), 'abc123');
  assert.equal(normalizeZipRecruiterUrl('https://example.com/job/1'), '');
  assert.equal(
    normalizeZipRecruiterUrl('https://www.ziprecruiter.ie/jobs/example?jid=ie123&utm_source=redirect'),
    'https://www.ziprecruiter.ie/jobs/example?jid=ie123',
  );
  assert.equal(normalizeZipRecruiterUrl('https://www.ziprecruiter.ie/jobs/search?remote=on_site'), '');
  assert.equal(normalizeZipRecruiterUrl('https://www.ziprecruiter.com/jobs-search?search=test'), '');
  assert.throws(() => assertZipRecruiterUrl('http://127.0.0.1/jobs'), /must use https/);
});

test('builds the correct query parameters after a regional redirect and supports pagination', () => {
  assert.equal(
    buildZipRecruiterSearchUrl('https://www.ziprecruiter.com/jobs-search', 'React Developer', 'Remote'),
    'https://www.ziprecruiter.com/jobs-search?search=React+Developer&location=Remote',
  );
  assert.equal(
    buildZipRecruiterSearchUrl('https://www.ziprecruiter.com/jobs-search', 'React Developer', 'Remote', 2),
    'https://www.ziprecruiter.com/jobs-search?search=React+Developer&location=Remote&page=2',
  );
  assert.equal(
    buildZipRecruiterSearchUrl('https://www.ziprecruiter.ie/jobs/search?utm_source=redirect', 'React Developer', 'Ireland'),
    'https://www.ziprecruiter.ie/jobs/search?q=React+Developer&l=Ireland',
  );
  assert.equal(
    buildZipRecruiterSearchUrl('https://www.ziprecruiter.ie/jobs/search?utm_source=redirect', 'React Developer', 'Ireland', 3),
    'https://www.ziprecruiter.ie/jobs/search?q=React+Developer&l=Ireland&page=3',
  );
});

test('validates local browser profile configuration without embedding credentials', () => {
  const profile = resolveBrowserProfileConfig({
    userDataDir: '~/.config/google-chrome', profileDirectory: 'Default',
    channel: 'chrome', headless: false, copySession: true,
  });
  assert.match(profile.userDataDir, /\.config\/google-chrome$/);
  assert.equal(profile.profileDirectory, 'Default');
  assert.equal(profile.headless, false);
  assert.equal(profile.copySession, true);
  assert.throws(() => resolveBrowserProfileConfig({ userDataDir: '/tmp/x', profileDirectory: '../Default' }), /Profile N/);
});

test('extracts complete JSON-LD JobPosting data and US-only eligibility', () => {
  const job = parseJobPostingJsonLd([JSON.stringify({
    '@context': 'https://schema.org', '@type': 'JobPosting',
    title: 'Senior React Developer', description: '<h2>Role</h2><p>Build React and Next.js applications.</p>',
    hiringOrganization: { name: 'Acme' }, jobLocationType: 'TELECOMMUTE',
    applicantLocationRequirements: { '@type': 'Country', name: 'United States only' },
    employmentType: 'FULL_TIME', datePosted: '2026-09-01',
    baseSalary: { currency: 'USD', value: { minValue: 140000, maxValue: 180000, unitText: 'YEAR' } },
    identifier: { value: 'zr-123' }, url: 'https://www.ziprecruiter.com/jobs/acme/zr-123?utm_source=search',
  })], 'https://www.ziprecruiter.com/jobs/acme/zr-123');
  assert.equal(job.title, 'Senior React Developer');
  assert.equal(job.company, 'Acme');
  assert.match(job.description, /Build React and Next\.js/);
  assert.equal(job.eligibility, 'US_ONLY');
  assert.equal(eligibilityPriority(job.eligibility), 'LOW');
  assert.equal(job.extractionMethod, 'JSON_LD');
  assert.match(job.salary, /140000–180000/);
});

test('DOM fallback preserves relevant JD text and does not promote bare Remote', () => {
  const job = mergeDetailFallback(null, {
    title: 'Frontend Engineer', company: 'Example', location: 'Remote',
    description: 'Build accessible React applications. Remote eligibility is not otherwise specified.',
    applicationUrl: 'https://example.com/apply',
  }, 'https://www.ziprecruiter.com/jobs/example/frontend-1');
  assert.equal(job.extractionMethod, 'DOM');
  assert.equal(job.eligibility, 'UNKNOWN');
  assert.equal(job.applicationUrl, 'https://example.com/apply');
  assert.equal(job.url, 'https://www.ziprecruiter.com/jobs/example/frontend-1');
  assert.equal(job.sourceUrl, job.url);
  assert.match(job.sourceUrl, /ziprecruiter\.com/);
});

test('parses ZipRecruiter relative posted dates', () => {
  const now = Date.UTC(2026, 8, 9, 12);
  assert.equal(parsePostedAt('Today', now), now);
  assert.equal(parsePostedAt('Yesterday', now), now - 86_400_000);
  assert.equal(parsePostedAt('3 days ago', now), now - 3 * 86_400_000);
});

test('detail data wins while list metadata fills missing fields', () => {
  const job = mergeSearchResult({
    title: 'Frontend Developer', company: 'List Co', location: 'Dublin', salary: '€70k',
    snippet: 'Short listing text', posted: '2 days ago', url: 'https://www.ziprecruiter.ie/jobs/example/frontend-1',
  }, {
    company: 'Detail Co', description: 'Full job description with React and TypeScript.',
    applicationUrl: 'https://apply.example/jobs/1', extractionMethod: 'DOM',
  }, 'Fallback Co');
  assert.equal(job.title, 'Frontend Developer');
  assert.equal(job.company, 'Detail Co');
  assert.equal(job.location, 'Dublin');
  assert.match(job.description, /Full job description/);
  assert.equal(job.applicationUrl, 'https://apply.example/jobs/1');
  assert.equal(job.url, 'https://www.ziprecruiter.ie/jobs/example/frontend-1');
  assert.ok(job.postedAt);
});

test('recognizes real challenges without flagging normal security disclosures', () => {
  assert.match(blockedReason('Just a moment...', 'Cloudflare Ray ID'), /Cloudflare/);
  assert.match(blockedReason('Jobs', 'Cloudflare Ray ID. Verify you are human and enable JavaScript and cookies.'), /Cloudflare/);
  assert.match(blockedReason('CAPTCHA', 'Complete the CAPTCHA to continue.'), /CAPTCHA/);
  assert.equal(blockedReason('Jobs', 'Normal public vacancy listing'), '');
  assert.equal(
    blockedReason('Frontend Jobs', 'This site is protected by reCAPTCHA. Cloudflare provides network services.'),
    '',
  );
});

test('provider health reports access challenges as blocked, not missing', async () => {
  const blockedProvider = { id: 'ziprecruiter', fetch: async () => { throw Object.assign(new Error('challenge'), { code: 'EZIPRECRUITER_BLOCKED' }); } };
  const result = await probeProvider({}, blockedProvider, { fetchJson: async () => ({}), fetchText: async () => '' });
  assert.equal(result.status, 'blocked');
});

test('normalized jobs use the shared matcher and React Native safety filter', () => {
  const web = analyzeJobMatch({ title: 'Senior Frontend Developer', company: 'Acme' }, 'React, Next.js and TypeScript. Build accessible frontend applications.');
  const native = analyzeJobMatch({ title: 'React Native Developer', company: 'Acme' }, 'Build React Native apps for iOS and Android.');
  assert.match(web.matchClassification, /^(BEST|STRONG) MATCH$/);
  assert.equal(native.matchClassification, 'SKIP');
});
test('sequentially checkpoints jobs, continues after one detail failure, then closes pages', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'ziprecruiter-provider-test-'));
  const cachePath = join(temp, 'cache.json');
  const healthPath = join(temp, 'health.json');
  const events = [];
  const saved = [];
  const rows = [
    {
      title: 'First Frontend Role', company: 'One', location: 'Dublin', posted: 'Today',
      snippet: 'First list snippet', url: 'https://www.ziprecruiter.ie/jobs/one/frontend-1',
    },
    {
      title: 'Second Frontend Role', company: 'Two', location: 'Cork', posted: '1 day ago',
      snippet: 'Second list snippet', url: 'https://www.ziprecruiter.ie/jobs/two/frontend-2',
    },
  ];

  const makePage = (kind) => {
    let currentUrl = 'about:blank';
    let closed = false;
    let detailAttempts = 0;
    return {
      on() {},
      isClosed: () => closed,
      url: () => currentUrl,
      title: async () => 'ZipRecruiter jobs',
      locator: () => {
        const locator = { innerText: async () => 'Normal public vacancy listing with enough content.', waitFor: async () => {} };
        locator.first = () => locator;
        return locator;
      },
      waitForFunction: async () => {},
      screenshot: async () => { events.push(kind + ':screenshot'); },
      goto: async (url) => {
        events.push(kind + ':goto:' + url);
        if (kind === 'detail' && detailAttempts++ === 0) throw new Error('first detail failed');
        currentUrl = url;
      },
      evaluate: async () => {
        if (kind === 'search') return rows;
        return {
          scripts: [JSON.stringify({
            '@type': 'JobPosting',
            title: 'Second Frontend Role',
            description: '<p>Full second description with React and TypeScript responsibilities.</p>',
            hiringOrganization: { name: 'Two' },
            jobLocation: { address: { addressLocality: 'Cork', addressCountry: 'IE' } },
            datePosted: '2026-09-08',
            url: currentUrl,
          })],
          dom: { applicationUrl: 'https://apply.example/jobs/frontend-2' },
        };
      },
      close: async () => {
        closed = true;
        events.push(kind + ':close');
      },
    };
  };

  const searchPage = makePage('search');
  const detailPage = makePage('detail');
  let pageIndex = 0;
  const context = {
    on() {},
    route: async () => {},
    newPage: async () => [searchPage, detailPage][pageIndex++],
    close: async () => { events.push('context:close'); },
  };
  const browser = {
    newContext: async () => context,
    close: async () => { events.push('browser:close'); },
  };
  const chromium = { launch: async () => browser };

  try {
    const jobs = await provider.fetch({
      name: 'ZipRecruiter IE',
      careers_url: 'https://www.ziprecruiter.ie/jobs/search',
      ziprecruiter: { query: 'frontend developer', location: '', maxPages: 1 },
    }, {
      chromium, nocache: true, maxPages: 1, cachePath, healthPath,
      onJob: async (job) => {
        assert.equal(searchPage.isClosed(), false);
        assert.equal(detailPage.isClosed(), false);
        saved.push(job.title);
        events.push('saved:' + job.title);
      },
    });

    assert.equal(jobs.length, 2);
    assert.equal(jobs[0].extractionMethod, 'LISTING');
    assert.equal(jobs[1].extractionMethod, 'JSON_LD');
    assert.match(jobs[1].description, /Full second description/);
    assert.equal(jobs[1].applicationUrl, 'https://apply.example/jobs/frontend-2');
    assert.deepEqual(saved, ['First Frontend Role', 'Second Frontend Role']);
    assert.ok(events.indexOf('saved:Second Frontend Role') < events.indexOf('detail:close'));
    assert.ok(events.indexOf('detail:close') < events.indexOf('search:close'));

    const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
    const search = Object.values(cache.searches)[0];
    assert.equal(search.complete, true);
    assert.equal(search.jobs.length, 2);
    assert.equal(Object.keys(cache.details).length, 1);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import provider, {
  DEFAULT_QUERIES,
  assertZipRecruiterUrl,
  blockedReason,
  buildZipRecruiterSearchUrl,
  mergeDetailFallback,
  normalizeZipRecruiterUrl,
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
  assert.equal(job.url, 'https://example.com/apply');
  assert.match(job.sourceUrl, /ziprecruiter\.com/);
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

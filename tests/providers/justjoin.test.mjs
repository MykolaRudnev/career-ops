// tests/providers/justjoin.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — justjoin');

try {
  const justjoinModule = await import(pathToFileURL(join(ROOT, 'providers/justjoin.mjs')).href);
  const jj = justjoinModule.default;
  const { parseJustJoinResponse } = justjoinModule;

  if (jj.id === 'justjoin') pass('justjoin.id is "justjoin"');
  else fail(`justjoin.id is ${JSON.stringify(jj.id)}`);

  if (jj.detect({ name: 'JustJoin', careers_url: 'https://justjoin.it/job-offers/all-locations' })?.url) {
    pass('justjoin.detect() matches job-offers URL');
  } else {
    fail('justjoin.detect() should match justjoin.it job-offers URL');
  }

  if (jj.detect({ name: 'X', careers_url: 'https://evil.example/justjoin.it/job-offers' }) === null) {
    pass('justjoin.detect() rejects path-spoofed URLs');
  } else {
    fail('justjoin.detect() must reject path-spoofed URLs');
  }

  if (jj.detect({ name: 'X', api: 'https://justjoin.it/api/candidate-api/offers/count' }) === null) {
    pass('justjoin.detect() rejects non-offers API paths');
  } else {
    fail('justjoin.detect() must reject non-offers API paths');
  }

  const fakeResponse = {
    data: [
      {
        slug: 'acme-senior-dev-warsaw-javascript',
        title: 'Senior Developer',
        companyName: 'Acme',
        workplaceType: 'remote',
        locations: [{ city: 'Warszawa' }],
        publishedAt: '2026-06-12T10:00:00.000Z',
        requiredSkills: [{ name: 'JavaScript' }],
      },
      { slug: '', title: 'Missing Slug', companyName: 'Broken' },
      null,
    ],
    meta: { totalItems: 1, next: { cursor: 1000 } },
  };

  const parsed = parseJustJoinResponse(fakeResponse);
  if (parsed.length === 1) pass('justjoin parser filters malformed rows');
  else fail(`justjoin parser returned ${parsed.length} rows, expected 1`);

  if (parsed[0].title === 'Senior Developer' && parsed[0].url === 'https://justjoin.it/job-offer/acme-senior-dev-warsaw-javascript') {
    pass('justjoin parser maps title and URL');
  } else {
    fail(`justjoin parser mapped title/url incorrectly: ${JSON.stringify(parsed[0])}`);
  }

  if (parsed[0].company === 'Acme' && parsed[0].location === 'remote, Warszawa' && typeof parsed[0].postedAt === 'number') {
    pass('justjoin parser maps company, location, and postedAt');
  } else {
    fail(`justjoin parser mapped fields incorrectly: ${JSON.stringify(parsed[0])}`);
  }

  if (Array.isArray(parsed[0].technologies) && parsed[0].description?.includes('Required skills:')) {
    pass('justjoin parser maps required technologies and description');
  } else {
    fail(`justjoin parser should expose technologies/description: ${JSON.stringify(parsed[0])}`);
  }

  const splitSkills = parseJustJoinResponse({
    data: [{
      slug: 'kotlin-dev-poznan-java',
      title: 'Kotlin Developer',
      companyName: 'Sii',
      publishedAt: '2026-10-01T10:00:00.000Z',
      category: 'Java',
      requiredSkills: [{ name: 'Kotlin', level: 'advanced' }],
      niceToHaveSkills: [{ name: 'React.JS', level: 'nice to have' }],
    }],
  });
  if (splitSkills[0].technologies.length === 1 && splitSkills[0].technologies[0] === 'Kotlin'
    && splitSkills[0].niceToHaveTechnologies?.length === 1) {
    pass('justjoin parser keeps nice-to-have skills out of technologies[]');
  } else {
    fail(`justjoin skill split wrong: ${JSON.stringify(splitSkills[0])}`);
  }

  let capturedUrl = '';
  let capturedOpts = null;
  const fetched = await jj.fetch(
    { name: 'JustJoin', careers_url: 'https://justjoin.it/job-offers/all-locations', max_pages: 2 },
    {
      transport: 'http',
      fetchJson: async (url, opts) => {
        capturedUrl = url;
        capturedOpts = opts;
        return fakeResponse;
      },
      fetchText: async () => '',
    },
  );
  if (fetched.length === 1 && capturedUrl.startsWith('https://justjoin.it/api/candidate-api/offers?')) {
    pass('justjoin.fetch() uses candidate API endpoint');
  } else {
    fail(`justjoin.fetch() endpoint/result wrong: ${capturedUrl} ${JSON.stringify(fetched)}`);
  }

  if (capturedOpts && capturedOpts.redirect === 'error') pass('justjoin.fetch() passes redirect:"error"');
  else fail(`justjoin.fetch() should pass redirect:"error", got ${JSON.stringify(capturedOpts)}`);

  if (fetched.length === 1) pass('justjoin.fetch() stops at meta.totalItems');
  else fail(`justjoin.fetch() ignored meta.totalItems: ${fetched.length} rows`);

  const apiUrl = new URL(capturedUrl);
  if (apiUrl.searchParams.get('itemsCount') === '1000') pass('justjoin.fetch() requests enough rows to cover the full feed');
  else fail(`justjoin.fetch() page size is too small: ${capturedUrl}`);

  if (apiUrl.searchParams.get('sortBy') === 'publishedAt' && apiUrl.searchParams.get('orderBy') === 'descending') {
    pass('justjoin.fetch() sorts newest-first by publishedAt');
  } else {
    fail(`justjoin.fetch() sort params wrong: ${capturedUrl}`);
  }

  let ssrfRejected = false;
  try {
    await jj.fetch(
      { name: 'Evil', careers_url: 'https://evil.example/job-offers/all-locations' },
      {
        transport: 'http',
        fetchJson: async () => { throw new Error('SSRF! should not reach here'); },
        fetchText: async () => '',
      },
    );
  } catch (e) {
    if (e.message.includes('trusted justjoin.it')) ssrfRejected = true;
  }
  if (ssrfRejected) pass('justjoin.fetch() rejects untrusted host');
  else fail('justjoin.fetch() should reject untrusted host');

  let badShape = false;
  try {
    parseJustJoinResponse({ jobs: [] });
  } catch (e) {
    if (e.message.includes('unexpected API response')) badShape = true;
  }
  if (badShape) pass('justjoin parser throws on bad response shape');
  else fail('justjoin parser should throw on bad response shape');

  const fixtureJobs = await jj.fetch(
    {
      name: 'JustJoin Fixture',
      careers_url: 'https://justjoin.it/job-offers/all-locations',
      fixture: 'tests/fixtures/justjoin-scan-api.json',
    },
    { transport: 'http', fetchJson: async () => { throw new Error('network'); }, fetchText: async () => '' },
  );
  if (fixtureJobs.length === 3) pass('justjoin.fetch() loads offline fixture without network');
  else fail(`justjoin fixture expected 3 jobs, got ${fixtureJobs.length}`);
} catch (e) {
  fail(`justjoin provider tests crashed: ${e.message}`);
}

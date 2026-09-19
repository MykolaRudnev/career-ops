import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { readJustJoinContent } from '../lib/justjoin-content.mjs';
import { analyzeJobMatch, jobMatchInputKey, validateRequirementEvidence } from '../server/jobMatch.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/useo-react-developer.json', import.meta.url)));
const job = { id: 'useo-react', url: fixture.sourceUrl, company: 'USEO', title: fixture.offer.title };
const { offer } = fixture;
const stack = offer.requiredSkills.map(s => `<div><h4>${s.name}</h4><span>${s.level === 1 ? 'nice to have' : 'advanced'}</span></div>`).join('');
const chrome = `<aside><h3>About the company</h3>${fixture.excludedCompanyProfile}</aside><section><h3>Similar offers</h3><a href="/job-offer/other">Ruby Python Java Kotlin required. Build backend services.</a></section><footer>Recommended offer: Go engineer</footer>`;
const dom = `<h1>React Developer</h1><div><h3>Job description</h3><div>${offer.body}</div></div><div><h3>Tech stack</h3><div>${stack}<div><h4>English</h4><span>C1</span></div></div></div>`;
const browser = await chromium.launch({ headless: true });
test.after(() => browser.close());
async function extract(html, expected = job.url) {
  const page = await browser.newPage();
  try {
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto(job.url);
    return await page.evaluate(readJustJoinContent, expected);
  } finally { await page.close(); }
}
function check(content) {
  assert.doesNotMatch(content.text, /Ruby|Rails|Python|Kotlin|Similar offers|About the company|Recommended offer/i);
  const result = analyzeJobMatch(job, content.text);
  assert.deepEqual(new Set(result.primaryStack), new Set(['React', 'TypeScript', 'JavaScript', 'Next.js', 'REST API']));
  assert.equal(result.backendOwnership, false);
  assert.equal(result.backendRequirement, false);
  assert.equal(result.backendCollaborationSignals.length, 0);
  assert.equal(result.frontendDominance, true);
  assert.equal(result.matchClassification, 'BEST MATCH');
  assert.ok(result.signals.requiredYears.includes(7));
  assert.ok(result.mandatorySkills.includes('English C1'));
  for (const skill of ['HTML', 'CSS', 'AI-assisted development', 'Embedded React / external-page integration']) {
    assert.ok(result.currentJobEvidence.some(e => e.skill === skill && content.text.includes(e.evidence)), skill);
  }
  assert.deepEqual(new Set(result.optionalSkills), new Set(['AWS', 'Authentication across domains']));
  assert.doesNotMatch(JSON.stringify(result), /Ruby|Rails/);
  return result;
}
test('USEO structured offer is selected by slug; company and recommendations cannot change evaluation', async () => {
  const data = `<script type="application/json">${JSON.stringify({ recommendations: [{ ...offer, slug: 'other', body: 'Ruby required' }], offer })}</script>`;
  const clean = await extract(data + dom);
  const polluted = await extract(chrome + data + dom + chrome);
  assert.equal(polluted.source, 'current-offer-data');
  assert.equal(polluted.text, clean.text);
  check(polluted);
});
test('actual Next Flight text-reference format preserves JD paragraphs and exact offer identity', async () => {
  const record = `a:${JSON.stringify({ offer: { ...offer, body: '$b' } })}\nb:T${Buffer.byteLength(offer.body).toString(16)},${offer.body}`;
  const content = await extract(`<script>self.__next_f=[[1,${JSON.stringify(record)}]]</script>${dom}${chrome}`);
  assert.equal(content.source, 'current-offer-data');
  check(content);
  const consumed = await extract(`<script>self.__next_f=[]; self.__next_f.push(${JSON.stringify([1, record])})</script><script>self.__next_f.length=0</script>${dom}${chrome}`);
  assert.equal(consumed.source, 'current-offer-data'); check(consumed);
});
test('JSON-LD and scoped DOM fallback exclude nearby job cards and company profile', async () => {
  const ld = `<script type="application/ld+json">${JSON.stringify([
    { '@type': 'JobPosting', url: 'https://justjoin.it/job-offer/other', title: 'Ruby Developer', description: 'Ruby required' },
    { '@type': 'JobPosting', url: job.url, title: job.title, description: offer.body.replace(/<[^>]+>/g, '') }
  ])}</script>`;
  const content = await extract(ld + dom + chrome);
  assert.equal(content.source, 'current-jobposting'); check(content);
  const fallback = await extract(dom + chrome);
  assert.equal(fallback.source, 'current-description-container'); check(fallback);
  assert.equal((await extract(`<h1>React Developer</h1>${chrome}`)).text, '');
  assert.equal((await extract(dom, 'https://justjoin.it/job-offer/other')).text, '');
});
test('global evidence gate rejects phantom gaps while retaining genuine Ruby requirements', () => {
  const clean = analyzeJobMatch(job, 'Required: React and TypeScript. Build frontend components.');
  for (const skill of ['Ruby', 'Python', 'Kotlin']) {
    const gap = `Preferred ${skill} backend knowledge`;
    const polluted = { ...clean, gaps: [gap], gapRequirements: { [gap]: [skill] }, currentJobEvidence: [...clean.currentJobEvidence, { skill, evidence: `${skill} required`, source: 'job-description', section: 'required' }] };
    assert.deepEqual(validateRequirementEvidence(polluted, job, 'React and TypeScript').gaps, []);
  }
  const real = analyzeJobMatch({ title: 'Frontend React Developer' }, 'React and TypeScript required. Build frontend components.\nPreferred: Ruby backend knowledge.');
  assert.ok(real.gaps.some(g => /Ruby/.test(g)));
  const required = analyzeJobMatch({ title: 'Fullstack Ruby Developer' }, 'Required: Ruby. Build Ruby backend services.');
  assert.ok(required.missingMandatorySkills.includes('Ruby'));
});
test('cache input includes job ID, canonical URL and JD hash', () => {
  const base = jobMatchInputKey(job, offer.body);
  for (const [other, jd] of [[{ ...job, id: 'another' }, offer.body], [{ ...job, url: job.url + '-another' }, offer.body], [job, offer.body + '\nRequired: Ruby']]) {
    assert.notEqual(jobMatchInputKey(other, jd), base);
  }
  const legacy = `navigation Job description${offer.body}\nOffice location\nAbout the company ${fixture.excludedCompanyProfile}\nSimilar offers Ruby required`;
  assert.doesNotMatch(JSON.stringify(analyzeJobMatch(job, legacy)), /Ruby|Rails/);
});
test('dashboard cache rejects legacy results, changed IDs and same-company/title JD files', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'useo-evaluation-cache-'));
  try {
    const script = `
      import fs from 'node:fs';
      import assert from 'node:assert/strict';
      const job = ${JSON.stringify(job)};
      fs.mkdirSync('scratch');
      fs.writeFileSync('scratch/dashboard_eval_cache.json', JSON.stringify({[job.url]: {matchVersion: 4, matchDescription: 'Ruby backend required', gaps: ['Preferred Ruby backend knowledge']}}));
      fs.mkdirSync('outputs/other', {recursive:true});
      fs.writeFileSync('outputs/other/metadata.json', JSON.stringify({...job, url: job.url + '-other'}));
      fs.writeFileSync('outputs/other/job-description.md', 'Required: Ruby. Build Ruby backend services. '.repeat(4));
      const {careerOps} = await import(${JSON.stringify(new URL('../server/careerOps.ts', import.meta.url).href)});
      assert.equal(careerOps.getEvaluationForDisplay(job).matchDescription, '');
      const first = careerOps.getEvaluationForDisplay({...job, description: 'React TypeScript frontend components. '.repeat(4)});
      const changed = careerOps.getEvaluationForDisplay({...job, description: 'Required: Ruby. Build Ruby backend services. '.repeat(4)});
      assert.notEqual(first.matchInputKey, changed.matchInputKey);
      assert.ok(changed.missingMandatorySkills.includes('Ruby'));
      assert.equal(careerOps.getEvaluationForDisplay({...job, id: 'other'}).matchDescription, '');
    `;
    const run = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], { cwd: dir, encoding: 'utf8', timeout: 15000 });
    assert.equal(run.status, 0, run.stderr || run.error?.message);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

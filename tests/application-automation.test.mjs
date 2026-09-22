import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'career-apply-'));
process.env.CAREER_OPS_ROOT = tmp;
process.env.CAREER_OPS_TRACKER = path.join(tmp, 'data/applications.md');
process.chdir(tmp);
fs.mkdirSync(path.join(tmp, 'config'));
fs.mkdirSync(path.join(tmp, 'data'));
fs.writeFileSync(path.join(tmp, 'config/profile.yml'), 'candidate:\n  full_name: Test Candidate\n  email: test@example.com\n  location: Warsaw, Poland\n');
fs.writeFileSync(path.join(tmp, 'cv.md'), '# Test Candidate\nFrontend developer using React.\n');
const { runApplicationPage } = await import('../server/application/browser.ts');
const { planQueue, preflight } = await import('../server/application/policy.ts');
const { runQueue } = await import('../server/application/service.ts');
const { cvFingerprint, ensureTailoredCv } = await import('../server/application/cvCache.ts');
const { jobArtifactDir } = await import('../server/jobArtifacts.ts');
const { deterministicAnswer, resolveAnswer } = await import('../server/application/answers.ts');
const browser = await chromium.launch({ headless: true });
test.after(async () => { await browser.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
const job = { id: 'job-1', company: 'Example Company', title: 'Senior Frontend Developer', url: 'https://justjoin.it/job-offer/example', status: 'pending', location: 'Poland', countries: ['Poland'], extra: '' };
const pdf = path.join(tmp, 'candidate.pdf'); fs.writeFileSync(pdf, '%PDF-1.4\nfixture');
const form = (extra = '', action = 'document.body.innerHTML="Thank you for applying"') => `<h1>Example Company Senior Frontend Developer</h1><p>Remote role based in Poland working on frontend applications.</p><form onsubmit='event.preventDefault(); ${action}'><label>First name<input name="first_name" required></label><label>Email<input type="email" required></label><label>CV<input name="cv" type="file" required style="display:none"></label>${extra}<button type="submit">Submit application</button></form>`;
async function run(pages, { mode = 'DRY_RUN', answer, signal, mutate, coverLetter } = {}) {
  const context = await browser.newContext();
  let submissions = 0;
  await context.exposeFunction('submitted', () => submissions++);
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: pages[route.request().url()] || '<h1>Missing</h1>' }));
  const page = await context.newPage();
  const state = {};
  const result = await runApplicationPage(page, job, {
    signal: signal || new AbortController().signal, mode,
    update: x => { Object.assign(state, x); mutate?.(x); },
    ensureCv: async () => ({ cvPath: pdf, status: 'REUSED' }),
    answer: answer || (async f => /first/i.test(f.label) ? 'Test' : /email/i.test(f.label) ? 'test@example.com' : null),
    coverLetter: coverLetter || (async () => ({content: 'A factual letter'}))
  });
  await context.close();
  return { ...result, state, submissions };
}
test('A: JustJoin direct form reaches READY_TO_SUBMIT; actual file attached; no submission', async () => {
  const result = await run({ [job.url]: form('', 'window.submitted()') });
  assert.equal(result.result, 'READY_TO_SUBMIT'); assert.equal(result.state.applicationProvider, 'JustJoinIT'); assert.equal(result.submissions, 0); assert.equal(result.state.cvPath, pdf);
});
test('B: JustJoin popup redirects to Greenhouse and continues same flow', async () => {
  const url = 'https://boards.greenhouse.io/example/jobs/123';
  const result = await run({ [job.url]: `<h1>Example Company Senior Frontend Developer</h1><a href="${url}" target="_blank">Apply</a>`, [url]: form() });
  assert.equal(result.result, 'READY_TO_SUBMIT'); assert.equal(result.state.applicationProvider, 'Greenhouse'); assert.equal(result.state.sourceJobBoard, 'JustJoinIT'); assert.equal(result.state.finalUrl, url);
});
test('C: matching validated PDF reused with zero tailoring calls; profile/JD changes invalidate', async () => {
  const dir = jobArtifactDir(job, { create: true });
  const file = path.join(dir, 'cv.pdf'); fs.writeFileSync(file, '%PDF-1.4\nfixture');
  let calls = 0;
  const metadata = { url: job.url, inputFingerprint: cvFingerprint(job, 'JD'), success: true, factCheck: 'passed', pdfPath: file, factValidation: 'PASS', generatedAt: '2026-09-16' };
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(metadata));
  assert.equal((await ensureTailoredCv(job, 'JD', async () => { calls++; })).status, 'REUSED'); assert.equal(calls, 0);
  assert.notEqual(cvFingerprint(job, 'changed JD'), metadata.inputFingerprint);
  fs.appendFileSync(path.join(tmp, 'cv.md'), '\nUpdated candidate source.');
  assert.notEqual(cvFingerprint(job, 'JD'), metadata.inputFingerprint);
});
test('D: already applied excluded before browser executor', async () => {
  const plan = planQueue([{ ...job, status: 'applied' }], [], [], new Map(), false);
  let calls = 0;
  const result = await runQueue(plan, new AbortController().signal, async () => { calls++; }, () => {});
  assert.equal(calls, 0); assert.equal(result.summary.ALREADY_APPLIED, 1);
});
test('E: CAPTCHA becomes Needs Manual; queue continues', async () => {
  const result = await run({ [job.url]: '<h1>Verify you are human</h1>' });
  assert.equal(result.result, 'NEEDS_MANUAL');
  const queued = await runQueue([{ job }, { job: { ...job, id: 'second' } }], new AbortController().signal, async item => item.job.id === job.id ? result : { result: 'READY_TO_SUBMIT' }, () => {});
  assert.equal(queued.summary.NEEDS_MANUAL, 1); assert.equal(queued.summary.READY_TO_SUBMIT, 1);
});
test('F: unknown required factual field pauses without fabricated answer', async () => {
  const result = await run({ [job.url]: form('<label>Citizenship<input required></label>') });
  assert.equal(result.result, 'NEEDS_MANUAL'); assert.match(result.reason, /Citizenship/);
});
test('G: only unknown free-text goes to AI; identical question reuses cache', async () => {
  const candidate = { profile: { candidate: {}, language: { output: 'en' } }, facts: { email: 'test@example.com' } };
  let calls = 0;
  const generate = async prompt => { calls++; assert.match(prompt, /Why are you interested/); return JSON.stringify({ answer: 'I enjoy frontend development.', needs_confirmation: false }); };
  const signal = new AbortController().signal;
  assert.equal(await resolveAnswer({ label: 'Email', type: 'email' }, job, 'JD', candidate, {}, signal, generate), 'test@example.com');
  assert.equal(await resolveAnswer({ label: 'Citizenship', type: 'text' }, job, 'JD', candidate, {}, signal, generate), null);
  const field = { label: 'Why are you interested in this role?', type: 'textarea', required: true };
  assert.equal(await resolveAnswer(field, job, 'JD', candidate, {}, signal, generate), 'I enjoy frontend development.');
  await resolveAnswer(field, job, 'JD', candidate, {}, signal, generate);
  assert.equal(calls, 1);
});
test('H/I: ten visible jobs ordered deterministically, concurrency one, one per company', async () => {
  const jobs = Array.from({ length: 10 }, (_, n) => ({ ...job, id: String(n), url: `https://example.com/jobs/${n}`, company: n < 3 ? 'Same' : `Company ${n}`, fitScore: n / 2, matchClassification: 'BEST MATCH' }));
  const plan = planQueue(jobs, [], [], new Map(), true);
  let active = 0, maximum = 0; const scores = [];
  const result = await runQueue(plan, new AbortController().signal, async item => { active++; maximum = Math.max(maximum, active); scores.push(item.job.fitScore); await new Promise(r => setTimeout(r, 2)); active--; return { result: 'READY_TO_SUBMIT' }; }, () => {});
  assert.equal(maximum, 1); assert.equal(result.summary.selected, 10); assert.equal(result.summary.SKIPPED, 2); assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
});
test('J: submit attempted on fixture but no receipt never becomes Applied', async () => {
  const result = await run({ [job.url]: form('', 'window.submitted()') }, { mode: 'SUBMIT' });
  assert.equal(result.submissions, 1); assert.equal(result.result, 'NEEDS_MANUAL'); assert.match(result.reason, /SUBMISSION_UNCONFIRMED/); assert.equal(result.state.submissionAttempted, true);
});
test('Fixture submit requires explicit new receipt; dry run cannot invoke it', async () => {
  const result = await run({ [job.url]: form('', 'window.submitted(); document.body.innerHTML="Thank you for applying"') }, { mode: 'SUBMIT' });
  assert.equal(result.submissions, 1); assert.equal(result.result, 'SUBMITTED'); assert.ok(result.submittedAt);
});
test('Cancellation stops current preparation and future queued work', async () => {
  const controller = new AbortController();
  const result = await run({ [job.url]: form() }, { signal: controller.signal, mutate: x => { if (x.result === 'FORM_FILLED') controller.abort(); } });
  assert.equal(result.result, 'CANCELLED'); assert.equal(result.submissions, 0);
  let calls = 0;
  const batch = await runQueue([{ job }, { job }], controller.signal, async () => { calls++; }, () => {});
  assert.equal(calls, 0); assert.equal(batch.summary.CANCELLED, 2);
});
test('Unconfirmed prior submit blocks retry; different channel requires manual review', () => {
  const { excluded } = planQueue([job], [{ num: 1, company: job.company, role: job.title, status: 'Applied', notes: 'URL: https://other.example/jobs/1' }], [], new Map(), false)[0];
  assert.equal(excluded.result, 'NEEDS_MANUAL');
  assert.equal(deterministicAnswer({ label: 'Are you authorized to work in the US?' }, { facts: {}, profile: {} }), null);
});
test('All named ATS adapters use the tested generic HTML form safely', async () => {
  for (const host of ['jobs.lever.co', 'jobs.ashbyhq.com', 'apply.workable.com', 'example.teamtailor.com', 'careers.example.com']) {
    const target = `https://${host}/jobs/123`;
    const result = await run({ [job.url]: `<h1>Example Company Senior Frontend Developer</h1><a href="${target}">Apply</a>`, [target]: form() });
    assert.equal(result.result, 'READY_TO_SUBMIT', `${host}: ${result.reason}`);
  }
});
test('Search forms are never filled and consent is not guessed', async () => {
  const result = await run({ [job.url]: `<form><label>Location<input name="location" required></label></form>${form('<label>I accept legal terms<input type="checkbox" required></label>')}` });
  assert.equal(result.result, 'NEEDS_MANUAL'); assert.match(result.reason, /legal terms/);
});
test('Confirmed receipt uses canonical tracker writer and records real submission time', async () => {
  const { recordSubmitted } = await import('../server/application/service.ts');
  const { parsePipeline } = await import('../server/fileAccess.ts');
  fs.writeFileSync(path.join(tmp, 'data/pipeline.md'), `# Pipeline\n\n## Pending\n- [ ] ${job.url} | ${job.company} | ${job.title} | Poland | posted: 2026-09-01\n\n## Processed\n`);
  const submittedAt = '2026-09-16T12:34:56.000Z';
  await recordSubmitted(job, { submittedAt, applicationProvider: 'JustJoinIT', cvPath: pdf });
  assert.match(fs.readFileSync(path.join(tmp, 'data/applications.md'), 'utf8'), /Applied/);
  assert.match(fs.readFileSync(path.join(tmp, 'data/status-log.tsv'), 'utf8'), /2026-09-16.*Applied/);
  const parsed = parsePipeline();
  assert.equal(parsed.pending.length, 0); assert.equal(parsed.processed[0].status, 'applied'); assert.equal(parsed.processed[0].date, '2026-09-16');
  await recordSubmitted(job, { submittedAt, applicationProvider: 'JustJoinIT', cvPath: pdf });
  assert.equal(parsePipeline().processed.length, 1);
});

test('required cover-letter textarea respects its smaller maxlength without submitting', async () => {
  const result = await run({ [job.url]: form('<label>Cover letter<textarea required maxlength="240"></textarea></label>') }, {
    coverLetter: async () => ({ content: 'Hi, I am interested in this frontend role.\n\n' + 'I build React frontend features and work with clients. '.repeat(25) + '\n\nHappy to share more.' })
  });
  assert.equal(result.result, 'READY_TO_SUBMIT');
  const answer = result.state.answers.find(a => /cover letter/i.test(a.question)).answer;
  assert.ok(answer.length <= 240);
  assert.ok(answer.endsWith('Happy to share more.'));
  assert.equal(result.submissions, 0);
});
test('liveness preflight stops an expired job before CV generation or submission', async () => {
  const context = await browser.newContext();
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main><h1>This job is no longer available</h1><p>The listing has closed and is no longer accepting applications.</p></main>' }));
  const page = await context.newPage();
  let cvCalls = 0;
  const result = await runApplicationPage(page, job, {
    signal: new AbortController().signal, mode: 'SUBMIT', update: () => {},
    ensureCv: async () => { cvCalls++; return { cvPath: pdf }; },
    answer: async () => null, coverLetter: async () => null,
  });
  await context.close();
  assert.equal(result.result, 'CLOSED');
  assert.equal(cvCalls, 0);
});

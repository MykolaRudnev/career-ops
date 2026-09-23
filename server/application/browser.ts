import { shortCoverLetter } from "../coverLetter.ts";
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { getCareerOpsRoot } from '../../path-resolver.mjs';
import { rejectPrivateOrInvalid, validateUrlSecurity } from '../../liveness-browser.mjs';
import { classifyLiveness } from '../../liveness-core.mjs';
import { extractForm } from '../../web/src/lib/apply/extract.ts';
import { detectProvider, submitControl, verifySuccess, successText, prepareProvider } from './providers.ts';
import { normalizeQuestion } from './answers.ts';

export class ManualApplication extends Error {}
export class ClosedApplication extends Error {}
let context: any;
let idle: ReturnType<typeof setTimeout> | undefined;
export async function applicationContext() {
  if (idle) clearTimeout(idle);
  if (context) return context;
  const dir = path.join(getCareerOpsRoot(), 'scratch/application-browser');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  context = await chromium.launchPersistentContext(dir, { headless: !process.env.DISPLAY, serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(8000);
  await context.route('**/*', async (route: any) => {
    try {
      const url = route.request().url();
      if (rejectPrivateOrInvalid(url) || new URL(url).username || new URL(url).password) return await route.abort();
      await validateUrlSecurity(url);
      await route.continue();
    } catch { await route.abort().catch(() => {}); }
  });
  context.on('close', () => { context = undefined; });
  return context;
}
export function releaseBrowser() {
  idle = setTimeout(() => { void context?.close(); }, 60000);
  idle.unref();
}
export async function checkBlock(page: any) {
  const text = await page.locator('body').innerText();
  if (/verify you are human|checking your browser|access denied|unusual traffic|complete the captcha/i.test(text)) throw new ManualApplication('CAPTCHA / anti-bot challenge');
  if (await page.locator('iframe[src*="captcha"], iframe[src*="challenges.cloudflare"], .g-recaptcha, .h-captcha, [data-sitekey]').count()) throw new ManualApplication('CAPTCHA requires manual completion');
  if (await page.locator('input[type=password]:visible').count()) throw new ManualApplication('Login / account creation required');
}
async function applicationForm(frame: any) {
  const form = await extractForm(frame);
  const ids = await frame.evaluate(() => {
    const file = [...document.querySelectorAll('input[type=file]')].find(el => !/cover|motivation/i.test((el.getAttribute('name') || '') + (el.getAttribute('id') || '')));
    const root = file?.closest('form, [role=form], [role=dialog]');
    if (!root || !root.querySelector('input[type=email], input[name*=email i]')) return [];
    document.querySelectorAll('[data-co-application]').forEach(el => el.removeAttribute('data-co-application'));
    root.setAttribute('data-co-application', 'true');
    return [...root.querySelectorAll('[data-co-field]')].map(el => el.getAttribute('data-co-field'));
  });
  form.fields = form.fields.filter(f => ids.includes(f.id));
  return form;
}
async function pickForm(page: any) {
  for (const frame of page.frames()) {
    const form = await applicationForm(frame).catch(() => null);
    if (form?.fields.some((f: any) => f.type === 'file') && form.fields.some((f: any) => f.type === 'email' || /e.?mail/i.test(f.label))) return { frame, form };
  }
  return null;
}
function fieldLocator(frame: any, field: any) {
  // Fresh query on every interaction tolerates React/Workable re-renders.
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  if (field.nativeId) return frame.locator(`[id="${esc(field.nativeId)}"]`);
  if (field.nativeName) return frame.locator(`[name="${esc(field.nativeName)}"]`);
  return frame.locator(`[data-co-field="${field.id}"]`);
}
export async function runApplicationPage(initialPage: any, job: any, ctx: any) {
  let page = initialPage;
  let submitting = false;
  const pages = new Set<any>([page]);
  const onPage = (p: any) => pages.add(p);
  const browser = page.context();
  browser.on('page', onPage);
  const cancel = () => { if (!submitting) for (const p of pages) void p.close().catch(() => {}); };
  ctx.signal.addEventListener('abort', cancel, { once: true });
  const checkAbort = () => ctx.signal.throwIfAborted();
  try {
    checkAbort();
    const response = await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await prepareProvider(page);
    await checkBlock(page);
    const body = await page.locator('body').innerText();
    const controls = await page.getByRole('button').allTextContents();
    const links = await page.getByRole('link').allTextContents();
    const live = classifyLiveness({ status: response?.status(), requestedUrl: job.url, finalUrl: page.url(), bodyText: body, applyControls: [...controls, ...links] });
    if (live.result === 'expired') throw new ClosedApplication(live.reason);
    if (['bot_challenge', 'access_blocked', 'server_error'].includes(live.code)) throw new ManualApplication(live.reason);
    // Confirm vacancy identity before any personal data leaves the filesystem.
    const words = normalizeQuestion(job.title).split(' ').filter((w: string) => w.length > 2);
    const visible = normalizeQuestion(body);
    if (!words.length || words.filter((w: string) => visible.includes(w)).length / words.length < 0.6 || !visible.includes(normalizeQuestion(job.company))) throw new ManualApplication('Company/role mismatch or posting identity cannot be verified');
    const description = page.locator('main, article, [data-testid="job-description"]').first();
    const jd = await description.count() ? await description.innerText() : body;
    ctx.update({ finalUrl: page.url(), sourceJobBoard: detectProvider(job.url).id, applicationProvider: detectProvider(page.url()).id });
    let found = await pickForm(page);
    for (let hop = 0; !found && hop < 4; hop++) {
      checkAbort();
      const adapter = detectProvider(page.url());
      if (adapter.id === 'Unsupported') throw new ManualApplication('Unsupported provider: Workday');
      const triggers = page.getByRole('link', { name: adapter.apply }).or(page.getByRole('button', { name: adapter.apply }));
      let trigger;
      for (const t of await triggers.all()) {
        if (!(await t.isVisible())) continue;
        // Never press a form submit button as a navigation trigger.
        if (await t.evaluate((el: any) => el.tagName === 'BUTTON' && el.type === 'submit' && el.form)) continue;
        trigger = t; break;
      }
      if (!trigger) throw new ManualApplication('Unsupported form or application link not found');
      const popup = page.waitForEvent('popup', { timeout: 2500 }).catch(() => null);
      await trigger.click();
      page = await popup || page;
      pages.add(page);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
      ctx.update({ finalUrl: page.url(), applicationProvider: detectProvider(page.url()).id });
      await prepareProvider(page);
      await checkBlock(page);
      found = await pickForm(page);
    }
    if (!found) throw new ManualApplication('Unsupported or multi-step form');
    const { frame } = found;
    const adapter = detectProvider(frame.url());
    ctx.update({ finalUrl: frame.url(), applicationProvider: adapter.id });
    if (adapter.id === 'Unsupported') throw new ManualApplication('Unsupported provider');
    await checkBlock(frame);
    const formBody = await frame.locator('body').innerText();
    if (successText.test(formBody)) throw new ManualApplication('Existing confirmation page; verify previous application manually');
    // On external ATS require the role to survive the redirect.
    if (frame.url() !== job.url && words.filter((w: string) => normalizeQuestion(formBody).includes(w)).length / words.length < 0.6) throw new ManualApplication('Role not verified after redirect');
    const cv = await ctx.ensureCv(jd);
    checkAbort();
    ctx.update({ cvPath: cv.cvPath, cvStatus: cv.status, result: 'APPLYING' });
    const answers: any[] = [];
    let uploaded = false;
    const fields = (await applicationForm(frame)).fields;
    for (const field of fields) {
      checkAbort();
      await applicationForm(frame);
      const scope = frame.locator('[data-co-application]');
      const locator = fieldLocator(scope, field);
      if (await locator.first().isDisabled()) continue;
      if (field.type === 'file') {
        const label = `${field.label} ${field.nativeName || ''}`;
        if (/cover|motivation|list motywacyjny/i.test(label)) {
          if (field.required) {
            const artifact = await ctx.coverLetter(jd);
            const accept = await locator.getAttribute('accept') || '';
            let coverPath = artifact.textPath;
            if (/pdf/i.test(accept)) {
              coverPath = path.join(path.dirname(artifact.textPath), 'cover-letter.pdf');
              const render = await browser.newPage();
              try {
                const safe = artifact.content.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
                await render.setContent(`<main style="font:12pt Arial;white-space:pre-wrap;line-height:1.5">${safe}</main>`);
                await render.pdf({ path: coverPath, format: 'A4', margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' } });
              } finally { await render.close(); }
            } else if (accept && !/text|txt|\*/i.test(accept)) throw new ManualApplication('Unsupported required cover-letter file format');
            await locator.setInputFiles(coverPath);
          }
          continue;
        }
        if (/photo|passport|identity|diploma|certificate/i.test(label)) {
          if (field.required) throw new ManualApplication(`Required non-CV document: ${field.label}`);
          continue;
        }
        if (!/resume|résumé|\bcv\b|życiorys/i.test(label) && fields.filter(f => f.type === 'file').length !== 1) {
          if (field.required) throw new ManualApplication(`Unknown required file: ${field.label}`);
          continue;
        }
        await locator.setInputFiles(cv.cvPath);
        uploaded = true;
        continue;
      }
      const answer = /cover letter|list motywacyjny/i.test(field.label) && field.required ? shortCoverLetter((await ctx.coverLetter(jd)).content, field.maxLength || 950) : await ctx.answer(field, jd);
      if (answer === null || answer === undefined || answer === '') {
        if (field.required) throw new ManualApplication(`Required field missing: ${field.label || field.nativeName || 'unlabelled'}`);
        continue;
      }
      if (field.maxLength && String(answer).length > field.maxLength) throw new ManualApplication(`Answer exceeds limit: ${field.label}`);
      if (field.type === 'checkbox') {
        if (adapter.id === 'Lever') throw new ManualApplication('Lever checkbox requires manual completion');
        if (!/^(true|yes|false|no)$/i.test(answer)) throw new ManualApplication(`Ambiguous checkbox: ${field.label}`);
        await locator.setChecked(/^(true|yes)$/i.test(answer));
      } else if (field.type === 'radio') {
        if (adapter.id === 'Lever') throw new ManualApplication('Lever radio requires manual completion');
        await scope.getByLabel(String(answer), { exact: true }).check();
      } else if (field.combobox) {
        await locator.fill(String(answer));
        const option = frame.getByRole('option', { name: String(answer), exact: true });
        if (await option.count() !== 1) throw new ManualApplication(`Ambiguous autocomplete: ${field.label}`);
        await option.click();
      } else if (field.type === 'select') {
        await locator.selectOption({ label: String(answer) });
      } else {
        await locator.fill(String(answer));
        if (await locator.inputValue() !== String(answer)) throw new ManualApplication(`Field did not retain value: ${field.label}`);
      }
      answers.push({ question: field.label, answer: String(answer) });
    }
    await checkBlock(frame);
    if (!uploaded) throw new ManualApplication('CV upload was not verified');
    const scope = frame.locator('[data-co-application]');
    const invalid = await scope.locator('input:invalid, select:invalid, textarea:invalid').count();
    if (invalid) throw new ManualApplication('Required or invalid fields remain');
    const newFields = (await applicationForm(frame)).fields;
    if (newFields.some(f => f.required && !fields.some(old => old.label === f.label && old.nativeName === f.nativeName))) throw new ManualApplication('New required fields appeared; manual review needed');
    const submit = await submitControl(scope, adapter);
    if (!submit) throw new ManualApplication('Final submit button ambiguous, unavailable or multi-step form');
    ctx.update({ result: 'FORM_FILLED', answers });
    checkAbort();
    if (ctx.mode === 'DRY_RUN') return { result: 'READY_TO_SUBMIT', reason: 'Dry run: form filled, CV attached; final submit not clicked' };
    if (ctx.mode !== 'SUBMIT') throw new Error('Invalid application mode');
    const before = await frame.locator('body').innerText();
    // Durable intent BEFORE clicking. An interrupted/unconfirmed attempt must never auto-retry.
    ctx.update({ result: 'SUBMITTING', submissionAttempted: true });
    submitting = true;
    await submit.click();
    const evidence = await verifySuccess(page, frame, before);
    if (!evidence) return { result: 'NEEDS_MANUAL', reason: 'SUBMISSION_UNCONFIRMED: submit attempted, no receipt found' };
    return { result: 'SUBMITTED', reason: evidence, submittedAt: new Date().toISOString() };
  } catch (error: any) {
    if (submitting) return { result: 'NEEDS_MANUAL', reason: 'SUBMISSION_UNCONFIRMED: interrupted after submit attempt' };
    if (ctx.signal.aborted) return { result: 'CANCELLED', reason: 'Cancelled by user' };
    if (error instanceof ClosedApplication) return { result: 'CLOSED', reason: error.message };
    if (error instanceof ManualApplication) return { result: 'NEEDS_MANUAL', reason: error.message };
    return { result: 'NEEDS_MANUAL', reason: `Browser/form interaction needs review: ${error.message?.split('\n')[0]?.slice(0, 220) || 'browser failure'}` };
  } finally {
    ctx.signal.removeEventListener('abort', cancel);
    browser.off('page', onPage);
    for (const p of pages) await p.close().catch(() => {});
  }
}

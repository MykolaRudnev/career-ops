import fs from 'node:fs';
import path from 'node:path';
import { getCareerOpsRoot } from '../../path-resolver.mjs';
import { normalizeUrl } from '../../url-key.mjs';
import { loadBlacklist } from '../../scan.mjs';
import { classifyEligibility } from '../../discovery/eligibility.mjs';
import { analyzeJobMatch } from '../jobMatch.mjs';
import { parsePipeline, updatePipelineStatus, WORKSPACE_ROOT } from '../fileAccess.ts';
import { appendTracker } from '../manualJobs.ts';
import { careerOps } from '../careerOps.ts';
import { operationManager } from '../operations.ts';
import { runCancellableCommand } from '../process.ts';
import { loadCoverLetter } from '../coverLetter.ts';
import { jobKey, planQueue, preflight, trackerRows, rowUrls, reportPath } from './policy.ts';
import { ensureTailoredCv } from './cvCache.ts';
import { loadCandidate, resolveAnswer } from './answers.ts';
import { applicationContext, releaseBrowser, runApplicationPage, ManualApplication } from './browser.ts';
import { upsertApplicationAnswersSection } from '../../application-answers.mjs';
import { writeFileAtomic } from '../../tracker-utils.mjs';
import { checkLivenessCheap } from '../../reconcile-pending-liveness.mjs';

const storePath = () => path.join(getCareerOpsRoot(), 'data/application-automation.json');
function save(rows: any[]) {
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomic(file, JSON.stringify(rows, null, 2));
  fs.chmodSync(file, 0o600);
}
export function applicationHistory(): any[] {
  if (!fs.existsSync(storePath())) return [];
  const rows = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
  if (!Array.isArray(rows)) throw new Error('Invalid application history; refusing to bypass duplicate checks');
  return rows;
}
const finalStates = new Set(['SUBMITTED', 'READY_TO_SUBMIT', 'NEEDS_MANUAL', 'FAILED', 'CANCELLED', 'CLOSED', 'SKIPPED', 'ALREADY_APPLIED']);
export function recoverInterruptedApplications() {
  const rows = applicationHistory();
  let changed = false;
  for (const row of rows) if (!finalStates.has(row.result)) {
    row.result = row.submissionAttempted ? 'NEEDS_MANUAL' : 'FAILED';
    row.reason = row.submissionAttempted ? 'SUBMISSION_UNCONFIRMED after backend restart; verify externally' : 'Backend restarted';
    row.completedAt = new Date().toISOString(); changed = true;
  }
  if (changed) save(rows);
}
export function summarize(rows: any[]) {
  const counts: any = { selected: rows.length };
  for (const row of rows) counts[row.result] = (counts[row.result] || 0) + 1;
  return counts;
}
export async function runQueue(items: any[], signal: AbortSignal, execute: (item: any) => Promise<any>, progress: (row: any) => void) {
  const results = [];
  for (const item of items) {
    let result;
    if (item.excluded) result = item.excluded;
    else if (signal.aborted) result = { result: 'CANCELLED', reason: 'Batch cancelled before this job' };
    else {
      try { result = await execute(item); }
      catch (error: any) { result = { result: signal.aborted ? 'CANCELLED' : 'FAILED', reason: error.message }; }
    }
    const row = { jobId: item.job.id, company: item.job.company, role: item.job.title, ...result };
    results.push(row); progress(row);
  }
  return { rows: results, summary: summarize(results) };
}
export async function recordSubmitted(job: any, attempt: any) {
  let rows = trackerRows();
  let row = rows.find((r: any) => rowUrls(r).includes(normalizeUrl(job.url)));
  if (!row) {
    await appendTracker({ ...job, id: `application-${jobKey(job)}`, date: attempt.submittedAt.slice(0, 10) }, job);
    rows = trackerRows();
    row = rows.find((r: any) => rowUrls(r).includes(normalizeUrl(job.url)));
  }
  if (!row) throw new Error('Submission confirmed but tracker row could not be resolved');
  // Do not pass the cancelled browser signal: a confirmed receipt MUST be recorded.
  await runCancellableCommand(process.execPath, [path.resolve(import.meta.dirname, '../../set-status.mjs'), '--row', String(row.num), 'Applied', '--on', attempt.submittedAt.slice(0, 10), '--note', `Submitted at ${attempt.submittedAt}; Provider: ${attempt.applicationProvider}`, '--json'], { cwd: WORKSPACE_ROOT, timeoutMs: 30000 });
  await updatePipelineStatus(job.url, 'applied', attempt.submittedAt);
  const report = reportPath(row);
  if (report) writeFileAtomic(report, upsertApplicationAnswersSection(fs.readFileSync(report, 'utf8'), { date: attempt.submittedAt.slice(0, 10), state: 'submitted', freeText: attempt.answers || [], files: [{ field: 'CV', path: attempt.cvPath }] }));
}
export function startApplications(selection: any, options: any = {}) {
  if (path.resolve(getCareerOpsRoot()) !== WORKSPACE_ROOT) throw new Error('Dashboard data root differs from working directory; start dashboard in the configured data workspace');
  if (!Array.isArray(selection) || !selection.length || selection.length > 100) throw new Error('Select between 1 and 100 visible jobs');
  if (!['DRY_RUN', 'SUBMIT'].includes(options.mode)) throw new Error('Choose DRY_RUN or SUBMIT explicitly');
  if (careerOps.getActivity().currentOp) throw new Error('Another dashboard operation is running');
  if (operationManager.list().some(op => ['PENDING', 'RUNNING', 'CANCELLING'].includes(op.status))) throw new Error('Wait for or cancel the current operation');
  const pipeline = parsePipeline();
  const jobs = [...pipeline.pending, ...pipeline.processed];
  const selected = selection.map((ref: any) => {
    if (typeof ref?.id !== 'string' || typeof ref?.url !== 'string') throw new Error('Invalid job reference');
    const job = jobs.find(j => j.id === ref.id && j.url === ref.url);
    if (!job) throw new Error('Job selection changed; refresh and select again');
    return { ...job, ...careerOps.getEvaluationForDisplay(job) };
  });
  const candidate = loadCandidate();
  const history = applicationHistory();
  const items = planQueue(selected, trackerRows(), history, loadBlacklist(), selected.length > 1);
  const op = operationManager.create(`applications-${Date.now()}`, 'APPLICATION');
  const startedAt = new Date().toISOString();
  const attempts = items.map((item: any, index: number) => ({ attemptId: `${op.operationId}-${index}`, operationId: op.operationId, key: jobKey(item.job), jobId: item.job.id, company: item.job.company, role: item.job.title, url: item.job.url, sourceJobBoard: item.job.sourceName || '', applicationProvider: '', finalUrl: item.job.url, cvPath: '', mode: options.mode, startedAt, result: 'WAITING', reason: '', ...item.excluded }));
  history.push(...attempts); save(history);
  operationManager.run(op.operationId, async ({ signal, updateStage }) => {
    const result = await runQueue(items, signal, async (item) => {
      const index = items.indexOf(item);
      const attempt: any = attempts[index];
      const update = (change: any) => {
        Object.assign(attempt, change, { updatedAt: new Date().toISOString() });
        save(history);
        updateStage(`${index + 1}/${items.length} · ${item.job.company} · ${attempt.result}`);
      };
      const now = parsePipeline();
      const fresh = [...now.pending, ...now.processed].find(j => j.url === item.job.url);
      if (!fresh) return { result: 'NEEDS_MANUAL', reason: 'Job removed from pipeline' };
      const job = { ...fresh, ...careerOps.getEvaluationForDisplay(fresh) };
      const blocked = preflight(job, trackerRows(), history.filter(a => a.attemptId !== attempt.attemptId));
      if (blocked) return blocked;
      // Same cheap classifier as Pending reconcile — covers JustJoin/NFJ/Solid, not only ATS APIs.
      const liveness = await checkLivenessCheap(job.url);
      if (liveness?.result === 'expired') {
        await updatePipelineStatus(job.url, 'expired');
        return { result: 'CLOSED', reason: liveness.reason };
      }
      update({ result: 'PREPARING' });
      const browser = await applicationContext();
      const page = await browser.newPage();
      const execution = await runApplicationPage(page, job, {
        signal, mode: options.mode, update,
        ensureCv: async (jd: string) => {
          const evaluation = analyzeJobMatch(job, jd);
          if (evaluation.recommendation === 'SKIP' || evaluation.missingMandatorySkills?.length) throw new ManualApplication('Eligibility / mandatory requirements need review');
          const eligibility = classifyEligibility({ ...job, description: jd });
          const allowed = candidate.profile.application_answers?.eligible_regions;
          const country = candidate.facts.country || '';
          const supported = /poland|polska/i.test(country) && ['POLAND', 'EUROPE', 'EU_EEA', 'EMEA', 'WORLDWIDE'].includes(eligibility);
          if (!supported && !allowed?.includes(eligibility)) throw new ManualApplication(`Candidate eligibility unconfirmed: ${eligibility}`);
          update({ result: 'CV_GENERATING' });
          const cv = await ensureTailoredCv(job, jd, () => careerOps.generateTailoredCv(job, { providerId: options.providerId, model: options.model, fullJd: jd }, { operationId: attempt.attemptId, signal, updateStage }));
          update({ result: 'CV_READY', cvPath: cv.cvPath, cvStatus: cv.status, cvValidation: cv.validation });
          return cv;
        },
        answer: (field: any, jd: string) => resolveAnswer(field, job, jd, candidate, { providerId: options.providerId, model: options.model }, signal),
        coverLetter: async () => {
          let artifact = loadCoverLetter(job);
          if (!artifact || artifact.cvChangedSince || artifact.content.length > 950) artifact = (await careerOps.generateCoverLetter(job, { providerId: options.providerId, model: options.model }, { operationId: attempt.attemptId, signal, updateStage })).artifact;
          if (artifact?.metadata.factValidation !== 'PASS') throw new ManualApplication('Cover letter requires fact review');
          return artifact;
        }
      });
      // Save receipt BEFORE canonical tracker write, so a write failure cannot trigger duplicate submission.
      update({ ...execution, completedAt: new Date().toISOString() });
      if (execution.result === 'CLOSED') await updatePipelineStatus(job.url, 'expired');
      if (execution.result === 'SUBMITTED') {
        try { await recordSubmitted(job, attempt); }
        catch (error: any) { update({ trackerWarning: error.message }); }
      }
      return { ...attempt };
    }, (row) => {
      const attempt = attempts.find(a => a.jobId === row.jobId && !a.completedAt);
      if (attempt) Object.assign(attempt, row, { completedAt: new Date().toISOString() });
      save(history);
    });
    releaseBrowser();
    return result;
  });
  return op;
}

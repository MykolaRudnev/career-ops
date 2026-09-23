import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeCompany } from '../../tracker-utils.mjs';
import { normalizeUrl } from '../../url-key.mjs';
import { roleFuzzyMatch } from '../../role-matcher.mjs';
import { resolveColumns, parseTrackerRow } from '../../tracker-parse.mjs';
import { getCareerOpsRoot, resolveTrackerPath } from '../../path-resolver.mjs';
import { loadBlacklist } from '../../scan.mjs';

export const jobKey = (job: any) => createHash('sha256').update(normalizeUrl(job.url)).digest('hex').slice(0, 24);
export function trackerRows() {
  const file = resolveTrackerPath(getCareerOpsRoot());
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const columns = resolveColumns(lines);
  return lines.map(line => parseTrackerRow(line, columns)).filter(Boolean);
}
export function rowUrls(row: any): string[] {
  const urls = (row.notes || '').match(/https?:\/\/[^\s;)<>]+/g) || [];
  const report = reportPath(row);
  if (report) {
    const text = fs.readFileSync(report, 'utf8');
    const url = text.match(/\*\*URL:\*\*\s*(https?:\/\/[^\s<>]+)/i)?.[1];
    if (url) urls.push(url);
  }
  return urls.map(normalizeUrl);
}
export function reportPath(row: any) {
  const link = row?.report?.match(/\]\(([^)]+\.md)\)/)?.[1];
  if (!link) return null;
  const root = getCareerOpsRoot();
  const file = path.resolve(root, link);
  if (!file.startsWith(path.join(root, 'reports') + path.sep) || !fs.existsSync(file)) return null;
  return file;
}
export function preflight(job: any, rows: any[], attempts: any[], blacklist = loadBlacklist()) {
  const stop = (result: string, reason: string) => ({ result, reason });
  const url = normalizeUrl(job.url);
  if (job.status === 'applied') return stop('ALREADY_APPLIED', 'Already applied in pipeline');
  const prior = attempts.filter(a => a.key === jobKey(job));
  if (prior.some(a => a.result === 'SUBMITTED')) return stop('ALREADY_APPLIED', 'Confirmed prior submission');
  if (prior.some(a => a.submissionAttempted && a.result !== 'SUBMITTED')) return stop('NEEDS_MANUAL', 'Earlier submission unconfirmed; verify externally before retrying');
  if (job.status === 'skipped' || job.recommendation === 'SKIP') return stop('SKIPPED', 'Skipped or ineligible ranking');
  const company = normalizeCompany(job.company);
  if (!company) return stop('NEEDS_MANUAL', 'Unknown end employer; cross-channel check cannot be completed');
  if (attempts.some(a => a.key !== jobKey(job) && normalizeCompany(a.company || '') === company && roleFuzzyMatch(a.role || '', job.title) && (a.result === 'SUBMITTED' || a.submissionAttempted))) return stop('NEEDS_MANUAL', 'Same company/role submitted through another application URL');
  const blocked = blacklist.get(company);
  if (blocked) return stop('SKIPPED', `Blacklisted: ${blocked.reason}`);
  const submitted = /\b(applied|responded|interview|offer|hired|rejected|withdrawn)\b/i;
  for (const row of rows) {
    const exact = rowUrls(row).includes(url);
    if (exact && submitted.test(row.status)) return stop('ALREADY_APPLIED', `Tracker #${row.num}: ${row.status}`);
    if (exact && /\b(closed|expired)\b/i.test(row.status)) return stop('CLOSED', 'Tracker marks vacancy closed');
    if (exact && /\bskip\b/i.test(row.status)) return stop('SKIPPED', 'Tracker marks vacancy skipped');
    if (normalizeCompany(row.company) === company && roleFuzzyMatch(row.role, job.title) && !exact) {
      return stop('NEEDS_MANUAL', `Company/role or cross-channel conflict with tracker #${row.num}`);
    }
  }
  return null;
}
export function planQueue(jobs: any[], rows: any[], attempts: any[], blacklist: any, bulk: boolean) {
  const tier: any = { 'BEST MATCH': 0, 'STRONG MATCH': 1, 'POSSIBLE MATCH': 2 };
  const ordered = [...jobs].sort((a, b) => (tier[a.matchClassification] ?? 3) - (tier[b.matchClassification] ?? 3) || (b.fitScore || 0) - (a.fitScore || 0) || a.url.localeCompare(b.url));
  const companies = new Set();
  const urls = new Set();
  return ordered.map(job => {
    let excluded = preflight(job, rows, attempts, blacklist);
    const company = normalizeCompany(job.company);
    if (!excluded && urls.has(normalizeUrl(job.url))) excluded = { result: 'SKIPPED', reason: 'Exact duplicate in this selection' };
    if (!excluded && bulk && companies.has(company)) excluded = { result: 'SKIPPED', reason: 'Another higher-ranked job at this company selected for this batch only' };
    if (!excluded) { companies.add(company); urls.add(normalizeUrl(job.url)); }
    return { job, excluded };
  });
}

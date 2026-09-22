#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { checkLivenessViaApi } from './liveness-api.mjs';
import { classifyLiveness } from './liveness-core.mjs';
import { htmlToText } from './providers/_html-to-text.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { withPipelineLock } from './pipeline-lock.mjs';
import { readProviderHealth } from './discovery/health.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { localToday } from './lib/local-today.mjs';
import { DEFAULT_USER_AGENT } from './user-agent.mjs';

const ACTIVE_TTL_MS = 36 * 60 * 60 * 1000;
const UNCERTAIN_TTL_MS = 12 * 60 * 60 * 1000;
const URL_RE = /https?:\/\/[^\s|]+/;

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}
function atomicJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2));
  renameSync(temp, file);
}
export function pendingEntries(text) {
  const rows = [];
  let pending = false;
  for (const line of text.split('\n')) {
    if (/^## (Pending|Pendientes)/.test(line)) { pending = true; continue; }
    if (/^## /.test(line)) { pending = false; continue; }
    if (!pending || !/^\s*- \[ \]/.test(line)) continue;
    const url = line.match(URL_RE)?.[0];
    if (url) rows.push({ url, line });
  }
  return rows;
}
function dedupText(value) { return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
function sourcePriority(url) {
  if (/greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com/i.test(url)) return 0;
  if (/justjoin\.it|nofluffjobs\.com|solid\.jobs/i.test(url)) return 20;
  if (/pracuj\.pl|theprotocol\.it|bulldogjob/i.test(url)) return 50;
  return 40;
}
export function archiveDuplicatePending(text) {
  const lines = text.split('\n'), chosen = new Map(), duplicateIndexes = new Set();
  let pending = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^## (Pending|Pendientes)/.test(line)) { pending = true; continue; }
    if (/^## /.test(line)) { pending = false; continue; }
    if (!pending || !/^\s*- \[ \]/.test(line)) continue;
    const cells = line.trim().slice(5).trim().split(' | ');
    if (cells.length < 3 || !URL_RE.test(cells[0])) continue;
    const key = `${dedupText(cells[1])}::${dedupText(cells[2])}::${dedupText(cells[3])}`;
    const row = { index, url: cells[0], priority: sourcePriority(cells[0]) };
    const prior = chosen.get(key);
    if (!prior) chosen.set(key, row);
    else if (row.priority < prior.priority) { duplicateIndexes.add(prior.index); chosen.set(key, row); }
    else duplicateIndexes.add(index);
  }
  if (!duplicateIndexes.size) return { text, archived: 0 };
  const moved = [], kept = lines.filter((line, index) => {
    if (!duplicateIndexes.has(index)) return true;
    const raw = line.trim().slice(5).trim();
    moved.push(`- [x] ${raw} | status: duplicate`);
    return false;
  });
  const processed = kept.findIndex(line => /^## (Processed|Procesadas)/.test(line));
  if (processed < 0) kept.push('', '## Processed', ...moved); else kept.splice(processed + 1, 0, ...moved);
  return { text: kept.join('\n'), archived: moved.length };
}
function sourceFor(url) {
  if (/justjoin\.it/i.test(url)) return 'justjoin';
  if (/nofluffjobs\.com/i.test(url)) return 'nofluffjobs';
  if (/solid\.jobs/i.test(url)) return 'solidjobs';
  return null;
}
function sourceFeedState(root) {
  const latest = readJson(path.join(root, 'data/discovery-latest.json'), { jobs: [] });
  const current = new Set((latest.jobs || []).map(row => row.url || row.canonicalUrl).filter(Boolean));
  const complete = new Set(readProviderHealth().filter(row => ['READY', 'EMPTY'].includes(row.status) && row.coverage !== 'PARTIAL').map(row => row.source));
  return { current, complete };
}
function cachedFresh(row, now) {
  if (!row?.checkedAt || row.result === 'expired') return false;
  const ttl = row.result === 'active' ? ACTIVE_TTL_MS : UNCERTAIN_TTL_MS;
  return now - Date.parse(row.checkedAt) < ttl;
}
/** Cheap preflight for reconcile + Apply: ATS API first, then one HTTP classify. Never treats 403/Cloudflare as expired. */
export async function checkLivenessCheap(url) {
  const api = await checkLivenessViaApi(url);
  if (api) return { ...api, via: 'api' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { headers: { 'user-agent': DEFAULT_USER_AGENT, accept: 'text/html,application/xhtml+xml' }, redirect: 'follow', signal: controller.signal });
    const html = await response.text();
    const bodyText = htmlToText(html, 100_000);
    const applyControls = (html.match(/<(?:a|button)\b[^>]*>[\s\S]{0,200}?<\/(?:a|button)>/gi) || []).map(value => htmlToText(value, 240));
    const result = classifyLiveness({ status: response.status, requestedUrl: url, finalUrl: response.url, bodyText, applyControls });
    if (result.code === 'insufficient_content') return { result: 'uncertain', code: result.code, reason: result.reason, via: 'http' };
    return { ...result, via: 'http' };
  } catch (error) {
    return { result: 'uncertain', code: 'network_error', reason: error.message, via: 'http' };
  } finally {
    clearTimeout(timer);
  }
}
async function browserChecks(rows, limit) {
  if (!limit || !rows.length) return new Map();
  let chromium, browser;
  const results = new Map();
  try {
    ({ chromium } = await import('playwright'));
    const { checkUrlLiveness, newLivenessPage } = await import('./liveness-browser.mjs');
    browser = await chromium.launch({ headless: true });
    const page = await newLivenessPage(browser);
    for (const row of rows.slice(0, limit)) results.set(row.url, { ...(await checkUrlLiveness(page, row.url)), via: 'browser' });
  } catch {
    return results;
  } finally {
    if (browser) await browser.close();
  }
  return results;
}
export function moveExpired(text, expired) {
  const moved = [];
  const kept = [];
  let pending = false;
  for (const line of text.split('\n')) {
    if (/^## (Pending|Pendientes)/.test(line)) pending = true;
    else if (/^## /.test(line)) pending = false;
    const url = pending && /^\s*- \[ \]/.test(line) ? line.match(URL_RE)?.[0] : null;
    if (url && expired.has(url)) {
      const verdict = expired.get(url);
      const raw = line.trim().slice(5).trim().split(' | ').filter(part => !/^(status|liveness|checked):/i.test(part)).join(' | ');
      moved.push(`- [x] ${raw} | status: expired | liveness: ${verdict.code} | checked: ${verdict.checkedAt}`);
    } else kept.push(line);
  }
  if (!moved.length) return { text, moved };
  const index = kept.findIndex(line => /^## (Processed|Procesadas)/.test(line));
  if (index < 0) kept.push('', '## Processed', ...moved);
  else kept.splice(index + 1, 0, ...moved);
  return { text: kept.join('\n'), moved };
}
export async function reconcilePending({ root = getCareerOpsRoot(), now = Date.now(), maxChecks = 200, maxBrowser = 8, dryRun = false, check = checkLivenessCheap } = {}) {
  const pipelinePath = path.join(root, 'data/pipeline.md');
  const cachePath = path.join(root, 'data/liveness-cache.json');
  if (!existsSync(pipelinePath)) return { pending: 0, due: 0, checked: 0, active: 0, expiredRemoved: 0, uncertain: 0, skippedFresh: 0 };
  let pipelineText = readFileSync(pipelinePath, 'utf8');
  let duplicatesArchived = 0;
  const duplicatePlan = archiveDuplicatePending(pipelineText);
  if (!dryRun && duplicatePlan.archived) await withPipelineLock(pipelinePath, () => {
    const current = archiveDuplicatePending(readFileSync(pipelinePath, 'utf8'));
    if (!current.archived) return;
    const temp = `${pipelinePath}.${process.pid}.dedup.tmp`;
    writeFileSync(temp, current.text); renameSync(temp, pipelinePath); duplicatesArchived = current.archived;
  });
  else duplicatesArchived = duplicatePlan.archived;
  pipelineText = dryRun ? duplicatePlan.text : readFileSync(pipelinePath, 'utf8');
  const entries = pendingEntries(pipelineText);
  const cache = readJson(cachePath, {});
  const feed = sourceFeedState(root);
  const allDue = entries.filter(row => !cachedFresh(cache[row.url], now));
  const due = allDue.map(row => {
    const source = sourceFor(row.url);
    return { ...row, suspicious: Boolean(source && feed.complete.has(source) && !feed.current.has(row.url)) };
  }).sort((a, b) => Number(b.suspicious) - Number(a.suspicious)).slice(0, maxChecks);
  const results = new Map();
  for (let index = 0; index < due.length; index += 8) {
    const batch = due.slice(index, index + 8);
    const settled = await Promise.all(batch.map(async row => [row.url, await check(row.url)]));
    for (const [url, result] of settled) results.set(url, { ...result, checkedAt: new Date(now).toISOString() });
  }
  const uncertainRows = due.filter(row => results.get(row.url)?.result === 'uncertain');
  const browser = check === checkLivenessCheap ? await browserChecks(uncertainRows, maxBrowser) : new Map();
  for (const [url, result] of browser) results.set(url, { ...result, checkedAt: new Date(now).toISOString() });
  const expired = new Map([...results].filter(([, result]) => result.result === 'expired'));
  let removed = 0;
  if (!dryRun) {
    for (const [url, result] of results) cache[url] = result;
    atomicJson(cachePath, cache);
    if (expired.size) await withPipelineLock(pipelinePath, async () => {
      const current = readFileSync(pipelinePath, 'utf8');
      const changed = moveExpired(current, expired);
      if (!changed.moved.length) return;
      removed = changed.moved.length;
      const temp = `${pipelinePath}.${process.pid}.tmp`;
      writeFileSync(temp, changed.text);
      renameSync(temp, pipelinePath);
      const historyPath = path.join(root, 'data/scan-history.tsv');
      if (!existsSync(historyPath)) writeFileSync(historyPath, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n');
      const rows = changed.moved.map(line => {
        const cells = line.replace(/^- \[x\]\s*/, '').split(' | ');
        return `${cells[0]}\t${localToday()}\tliveness-reconciliation\t${cells[2] || ''}\t${cells[1] || ''}\tskipped_expired\t${cells[3] || ''}`;
      });
      appendFileSync(historyPath, `${rows.join('\n')}\n`);
    });
  }
  const values = [...results.values()];
  return {
    pending: entries.length,
    due: allDue.length,
    checked: results.size,
    active: values.filter(row => row.result === 'active').length,
    expiredRemoved: dryRun ? expired.size : removed,
    uncertain: values.filter(row => row.result === 'uncertain').length,
    skippedFresh: entries.length - allDue.length,
    suspiciousFromCompleteFeed: due.filter(row => row.suspicious).length,
    duplicatesArchived,
    dryRun,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const value = flag => Number(args[args.indexOf(flag) + 1]);
  const result = await reconcilePending({ dryRun: args.includes('--dry-run'), maxChecks: value('--max-checks') || 200, maxBrowser: value('--max-browser') || 8 });
  if (args.includes('--json')) process.stdout.write(`${JSON.stringify(result)}\n`);
  else console.log(`Pending ${result.pending}; checked ${result.checked}; expired ${result.expiredRemoved}; uncertain ${result.uncertain}`);
}
if (isMainModule(import.meta.url)) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });

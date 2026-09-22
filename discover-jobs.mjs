#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deduplicateJobs } from './discovery/normalize.mjs';
import { reconcilePending } from './reconcile-pending-liveness.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

export function runLane(script, args, { cwd = ROOT, env = process.env, stderr = process.stderr } = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(ROOT, script), ...args, '--json'], { cwd, env });
    let stdout = '', errorText = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { errorText += chunk; stderr?.write(chunk); });
    child.on('close', code => {
      let data = null;
      try { data = JSON.parse(stdout); } catch { /* reported below */ }
      resolve({ script, code, data, error: code === 0 && data ? null : (errorText.trim() || stdout.trim() || `exit ${code}`) });
    });
  });
}
export function mergeSourceHealth(rows) {
  const rank = { ERROR:9, API_CHANGED:8, BLOCKED:7, RATE_LIMITED:6, AUTH_REQUIRED:5, DEGRADED:4, CONFIG_MISSING:3, EMPTY:2, READY:1 };
  const merged = new Map();
  for (const row of rows) {
    const current = merged.get(row.source);
    if (!current) { merged.set(row.source, { ...row }); continue; }
    current.jobsFetched = (current.jobsFetched || 0) + (row.jobsFetched || 0);
    current.jobsRelevant = (current.jobsRelevant || 0) + (row.jobsRelevant || 0);
    current.newJobs = (current.newJobs || 0) + (row.newJobs || 0);
    current.duplicates = (current.duplicates || 0) + (row.duplicates || 0);
    current.expiredRemoved = (current.expiredRemoved || 0) + (row.expiredRemoved || 0);
    current.durationMs = Math.max(current.durationMs || 0, row.durationMs || 0);
    current.errors = [...new Set([...(current.errors || []), ...(row.errors || []), row.error].filter(Boolean))];
    if ((rank[row.status] || 0) > (rank[current.status] || 0)) current.status = row.status;
    if (row.coverage === 'PARTIAL') current.coverage = 'PARTIAL';
    if ((row.lastSuccessfulScan || '') > (current.lastSuccessfulScan || '')) current.lastSuccessfulScan = row.lastSuccessfulScan;
  }
  return [...merged.values()];
}
function statusCounts(rows) {
  const ready = rows.filter(row => ['READY', 'EMPTY'].includes(row.status)).length;
  const blocked = rows.filter(row => ['BLOCKED', 'RATE_LIMITED'].includes(row.status)).length;
  return { ready, blocked, degraded: rows.length - ready - blocked };
}
export function mergeDiscoveryReceipts(providerLane, atsLane, reconciliation = {}) {
  const provider = providerLane.data || {};
  const ats = atsLane.data || {};
  const providerHealth = provider.source_health || [];
  const atsHealth = (ats.sources || []).map(source => ({
    source, name: source[0].toUpperCase() + source.slice(1), provider: source,
    status: ats.datasetStatus?.[source] === 'ok' && !ats.stoppedByOutage ? 'READY' : 'DEGRADED',
    jobsFetched: 0, jobsRelevant: (ats.offers || []).filter(offer => offer.source === `${source}-full`).length,
    newJobs: (ats.offers || []).filter(offer => offer.source === `${source}-full`).length,
    duplicates: 0, expiredRemoved: 0, durationMs: 0,
    error: ats.datasetStatus?.[source] === 'ok' ? null : `dataset ${ats.datasetStatus?.[source] || 'unavailable'}`,
    coverage: ats.capHit ? 'PARTIAL' : 'COMPLETE',
  }));
  const sourceHealth = mergeSourceHealth([...providerHealth, ...atsHealth]);
  const offers = deduplicateJobs([...(provider.offers || []), ...(ats.offers || []).map(offer => ({ ...offer, sourcePriority: 0, directEmployerSource: true }))]);
  const lanes = {
    providers: { status: providerLane.error ? 'ERROR' : (provider.status || 'READY'), error: providerLane.error },
    ats: { status: atsLane.error ? 'ERROR' : (ats.stoppedByOutage || ats.capHit ? 'DEGRADED' : 'READY'), error: atsLane.error },
  };
  const counts = statusCounts(sourceHealth);
  return {
    version: 'careerops.discovery.receipt@1', status: providerLane.error && atsLane.error ? 'ERROR' : (providerLane.error || atsLane.error || Object.values(lanes).some(lane => lane.status !== 'READY') ? 'DEGRADED' : 'READY'),
    lanes, sourcesAttempted: sourceHealth.length, healthy: counts.ready, degraded: counts.degraded, blocked: counts.blocked,
    found: (provider.found || 0) + (ats.postingsKept || 0), filtered: provider.filtered || 0,
    duplicates: (provider.duplicates || 0) + Math.max(0, (provider.offers?.length || 0) + (ats.offers?.length || 0) - offers.length),
    added: (provider.added || 0) + (ats.saved ? (ats.offers?.length || 0) : 0), offers, source_health: sourceHealth,
    existingPendingChecked: reconciliation.checked || 0, expiredRemoved: reconciliation.expiredRemoved || 0,
    uncertain: reconciliation.uncertain || 0, stalePendingFound: reconciliation.due || 0,
    reconciliation, dry_run: Boolean(provider.dry_run || ats.dryRun),
    companiesAvailable: ats.companiesAvailable, companiesScanned: ats.companiesScanned, capHit: ats.capHit,
    datasetStatus: ats.datasetStatus, postingsKept: ats.postingsKept, postingsDroppedNoDate: ats.postingsDroppedNoDate, unreachableBoards: ats.unreachableBoards,
  };
}
export async function discoverJobs({ bulk = false, dryRun = false, refresh = false, sinceDays, ats, limit, cwd = ROOT, env = process.env, laneRunner = runLane, reconcile = reconcilePending } = {}) {
  const providerArgs = ['--quiet'];
  const atsArgs = ['--since', String(sinceDays || (bulk ? 30 : 7)), '--limit', String(limit || (bulk ? 150 : 25))];
  if (ats) atsArgs.push('--ats', ats);
  if (dryRun) { providerArgs.push('--dry-run'); atsArgs.push('--dry-run'); }
  // User-initiated discovery (dashboard Run Job Search) must not reuse a
  // multi-hour provider cache — that is how a JustJoin offer published minutes
  // before the click never reaches pipeline.md.
  if (refresh) providerArgs.push('--refresh');
  const providerLane = await laneRunner('scan.mjs', providerArgs, { cwd, env });
  const atsLane = await laneRunner('scan-ats-full.mjs', atsArgs, { cwd, env });
  const reconciliation = dryRun ? {} : await reconcile({ root: env.CAREER_OPS_ROOT || cwd, maxChecks: bulk ? 400 : 200, maxBrowser: bulk ? 12 : 8 });
  const receipt = mergeDiscoveryReceipts(providerLane, atsLane, reconciliation);
  if (!dryRun) {
    writeFileSync(path.join(env.CAREER_OPS_ROOT || cwd, 'data/discovery-health.json'), JSON.stringify({ generatedAt: new Date().toISOString(), source_health: receipt.source_health }, null, 2));
    writeFileSync(path.join(env.CAREER_OPS_ROOT || cwd, 'data/discovery-receipt.json'), JSON.stringify({ ...receipt, offers: undefined }, null, 2));
  }
  return receipt;
}
async function main() {
  const args = process.argv.slice(2);
  const value = flag => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
  const receipt = await discoverJobs({ bulk: args.includes('--bulk'), dryRun: args.includes('--dry-run'), refresh: args.includes('--refresh'), sinceDays: Number(value('--since')) || undefined, ats: value('--ats'), limit: Number(value('--limit')) || undefined });
  if (args.includes('--json')) {
    // Dashboard only needs summary counters (then reloads pipeline from disk).
    // Omitting offers keeps stdout under exec maxBuffer; the on-disk receipt
    // already drops offers for the same reason.
    const { offers: _offers, ...summary } = receipt;
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } else {
    console.log(`SCAN COMPLETE\nSources attempted: ${receipt.sourcesAttempted}\nHealthy: ${receipt.healthy} · Degraded: ${receipt.degraded} · Blocked: ${receipt.blocked}\nFetched/relevant: ${receipt.found}\nDuplicates: ${receipt.duplicates}\nNew jobs: ${receipt.added}\nExisting Pending checked: ${receipt.existingPendingChecked}\nExpired removed: ${receipt.expiredRemoved}\nUncertain: ${receipt.uncertain}`);
  }
  // Same keep-alive hazard as scan-ats-full: force-exit so the dashboard's
  // exec() callback fires and LAST SCAN / discovery-receipt.json stay in sync.
  process.exit(receipt.status === 'ERROR' ? 1 : 0);
}
if (isMainModule(import.meta.url)) main().catch(error => { console.error(error.stack || error.message); process.exit(1); });

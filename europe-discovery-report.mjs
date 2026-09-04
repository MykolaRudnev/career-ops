#!/usr/bin/env node
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import * as yaml from 'js-yaml';
import { loadProviders, resolveProvider } from './providers/_registry.mjs';
import { makeHttpCtx } from './providers/_http.mjs';
import { buildTitleFilter } from './title-keywords.mjs';
import { analyzeJobMatch } from './server/jobMatch.mjs';
import { classifyEligibility, eligibilityPriority } from './discovery/eligibility.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.env.CAREER_OPS_EUROPE_PORTALS || path.join(root, 'portals.europe.yml');
const config = yaml.load(readFileSync(configPath, 'utf8')) || {};
const providers = await loadProviders(path.join(root, 'providers'));
const titleFilter = buildTitleFilter(config.title_filter);
const refresh = process.argv.includes('--refresh');
const writeReport = !process.argv.includes('--no-write');
const cacheDir = path.join(root, 'data', 'provider-cache');
mkdirSync(cacheDir, { recursive: true });

const raw = [], health = [];
for (const entry of (config.job_boards || []).filter(x => x.enabled !== false)) {
  const resolved = resolveProvider(entry, providers);
  if (!resolved || resolved.error) { health.push({source:entry.name,status:'UNSUPPORTED',error:resolved?.error||'no provider'}); continue; }
  const cacheFile = path.join(cacheDir, `${resolved.provider.id}.json`);
  const started = Date.now();
  try {
    let jobs, cached = false;
    if (!refresh && existsSync(cacheFile)) {
      const c = JSON.parse(readFileSync(cacheFile, 'utf8'));
      if (Date.now() - Date.parse(c.fetchedAt) < 8 * 3600e3) { jobs = c.jobs; cached = true; }
    }
    if (!jobs) {
      jobs = await resolved.provider.fetch(entry, makeHttpCtx());
      writeFileSync(cacheFile, JSON.stringify({source:resolved.provider.id,fetchedAt:new Date().toISOString(),jobs}, null, 2));
    }
    for (const j of jobs) raw.push({...j, source:resolved.provider.id, sourceName:entry.name});
    health.push({source:entry.name,status:'READY',jobsFetched:jobs.length,responseMs:Date.now()-started,cached});
  } catch (e) { health.push({source:entry.name,status:/API KEY MISSING/.test(e.message)?'API KEY MISSING':'ERROR',jobsFetched:0,responseMs:Date.now()-started,error:e.message}); }
}

const relevant = raw.filter(j => titleFilter(j.title));
const seenUrl = new Set(), seenRole = new Set(), unique = [];
for (const j of relevant) {
  const url = String(j.url||'').replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
  const role = `${String(j.company||'').toLowerCase().replace(/\W/g,'')}|${String(j.title||'').toLowerCase().replace(/\W/g,'')}`;
  if (seenUrl.has(url) || seenRole.has(role)) continue;
  seenUrl.add(url); seenRole.add(role);
  const eligibility = classifyEligibility(j);
  const matchText = [j.description, ...(j.technologies || [])].filter(Boolean).join(' ');
  const match = analyzeJobMatch({title:j.title,company:j.company,location:j.location}, matchText);
  const mobile = /react[ -]?native|expo|flutter|android|ios|swift|kotlin mobile/i.test(String(j.title || '') + ' ' + matchText);
  const matchClassification = mobile && match.matchClassification === 'BEST MATCH' ? 'SKIP' : match.matchClassification;
  unique.push({...j, eligibility, eligibilityPriority:eligibilityPriority(eligibility), match:matchClassification});
}
const countBy = (rows, fn) => rows.reduce((a,x)=>{const k=fn(x)||'UNKNOWN';a[k]=(a[k]||0)+1;return a;},{});
const tech = ['React','Next.js','TypeScript','Magento','Hyvä','Shopify','Node.js'];
const report = {
  generatedAt:new Date().toISOString(), scope:'Europe remote/high-income markets additive lane', rawJobs:raw.length,
  relevantJobs:relevant.length, uniqueJobs:unique.length,
  bySource:countBy(raw,x=>x.source), byMatch:countBy(unique,x=>x.match), byEligibility:countBy(unique,x=>x.eligibility),
  technologyCounts:Object.fromEntries(tech.map(t=>[t,unique.filter(j=>new RegExp(t.replace('.','\\.'),'i').test(`${j.title} ${j.description||''}`)).length])),
  reactNativeBestMatch:unique.filter(j=>j.match==='BEST MATCH'&&/react[ -]?native|expo|flutter|android|ios/i.test(`${j.title} ${j.description||''}`)).length,
  backendHeavyBestMatch:unique.filter(j=>j.match==='BEST MATCH'&&/\b(java|spring|python|django|fastapi|\.net|c#)\b/i.test(j.title)).length,
  health,
};
if (writeReport) writeFileSync(path.join(root,'data','europe-discovery-report.json'), JSON.stringify({...report,jobs:unique},null,2));
console.log(JSON.stringify(report,null,2));

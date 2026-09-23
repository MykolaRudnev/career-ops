import { fetchSearchPages } from './search-pages.mjs';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { SOURCE_POLICIES } from './sources.mjs';
import { normalizeJob } from './normalize.mjs';
const failures = new Map(), pending = new Map();
export function errorState(e) {
  if (e.code==='SERVICE_WINDOW') return 'DEGRADED';
  if (e.code==='AUTH_REQUIRED' || e.status===401) return 'AUTH_REQUIRED';
  if (e.status===429) return 'RATE_LIMITED';
  if (e.status===403 || /captcha|cloudflare|access.denied|blocked/i.test(e.message)) return 'BLOCKED';
  if (e.status===404 || /unexpected|JSON|schema/i.test(e.message)) return 'API_CHANGED';
  return 'ERROR';
}
function read(file) { try { return JSON.parse(readFileSync(file,'utf8')); } catch { return null; } }
function write(file, value) { mkdirSync(path.dirname(file),{recursive:true}); const tmp=`${file}.${process.pid}.tmp`; writeFileSync(tmp,JSON.stringify(value)); renameSync(tmp,file); }
export function wrapProvider(provider) {
  const policy = SOURCE_POLICIES[provider.id];
  if (!policy) return provider;
  return {...provider, integrationType:policy.integrationType, async fetch(entry,ctx) {
    const config = Object.fromEntries(Object.entries(entry).filter(([k])=>!k.startsWith('_')));
    const key = `${provider.id}-${createHash('sha256').update(JSON.stringify({ config, integrationType: policy.integrationType, endpoint: policy.endpoint })).digest('hex').slice(0,16)}`;
    const root = getCareerOpsRoot();
    const healthFile = path.join(root,'data','provider-health',`${key}.json`);
    const cacheFile = path.join(root,'data','provider-cache',`${key}.json`);
    const previous = read(healthFile);
    const started = Date.now();
    if (previous && ['BLOCKED','RATE_LIMITED'].includes(previous.status) && Date.now()-statSync(healthFile).mtimeMs<3600e3) throw Object.assign(new Error(previous.errors?.[0] || previous.status),{status:previous.status==='BLOCKED'?403:429,noRetry:true});
    const health = {checkedAt:new Date().toISOString(),source:provider.id,name:entry.name,...policy,lastSuccessfulScan:previous?.lastSuccessfulScan || null,jobsFetched:0,jobsRelevant:0,newJobs:0,duplicates:0,expiredRemoved:0,coverage:policy.integrationType==='SEARCH_ONLY' ? 'PARTIAL' : 'COMPLETE',errors:[],durationMs:0};
    const save = () => { if (ctx.persist===false) return; health.durationMs=Date.now()-started; write(healthFile,health); };
    if (policy.status && policy.integrationType!=='SEARCH_ONLY') { health.status=policy.status; health.errors=[policy.reason]; save(); return []; }
    if (pending.has(key)) return pending.get(key);
    const task = (async()=>{
      try {
        const cache = read(cacheFile);
        if (!ctx.refresh && cache?.version===1 && Date.now()-Date.parse(cache.fetchedAt)<policy.cacheHours*3600e3) {
          cache.jobs = cache.jobs.map(j=>normalizeJob({...j,sourceName:entry.name},provider.id,policy,cache.fetchedAt)).filter(Boolean);
          Object.assign(health,{status:cache.partial ? 'DEGRADED' : (cache.jobs.length ? 'READY' : 'EMPTY'),cached:true,jobsFetched:cache.jobs.length,coverage:cache.partial ? 'PARTIAL' : 'COMPLETE',lastSuccessfulScan:cache.fetchedAt,errors:cache.partial ? [cache.partial] : []}); save(); return cache.jobs;
        }
        const safeCtx = {...ctx, markPartial:reason=>{health.partial=reason;}};
        for (const method of ['fetchJson','fetchText','fetchResponse']) if (ctx[method]) safeCtx[method] = async (url,opts) => {
          const host = new URL(url).hostname;
          if (failures.has(host)) throw failures.get(host);
          try { return await ctx[method](url,opts); }
          catch(e) { if ([401,403,429].includes(e.status) || /captcha|cloudflare|access.denied/i.test(e.message)) {e.noRetry=true; failures.set(host,e);} throw e; }
        };
        const rows = policy.integrationType==='SEARCH_ONLY' ? await fetchSearchPages(provider.id,entry,safeCtx) : await provider.fetch(entry,safeCtx);
        if (!Array.isArray(rows)) throw new Error('unexpected provider response');
        const fetchedAt = new Date().toISOString();
        const jobs = rows.map(j=>normalizeJob({...j,sourceName:entry.name},provider.id,policy,fetchedAt)).filter(Boolean);
        const oldUrls = new Set((cache?.jobs || []).map(j=>j.canonicalUrl));
        Object.assign(health,{status:health.partial ? 'DEGRADED' : (jobs.length ? 'READY' : 'EMPTY'),lastSuccessfulScan:fetchedAt,jobsFetched:jobs.length,coverage:health.partial ? 'PARTIAL' : 'COMPLETE',newJobs:jobs.filter(j=>!oldUrls.has(j.canonicalUrl)).length,errors:health.partial ? [health.partial] : []});
        if (ctx.persist!==false) write(cacheFile,{version:1,fetchedAt,jobs,partial:health.partial}); save(); return jobs;
      } catch(e) { Object.assign(health,{status:errorState(e),errors:[e.message]}); save(); throw e; }
    })();
    pending.set(key,task);
    try { return await task; } finally {pending.delete(key);}
  }};
}

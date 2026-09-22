import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { SOURCE_POLICIES, SEARCH_SOURCES } from './sources.mjs';
export function readProviderHealth() {
  const dir=path.join(getCareerOpsRoot(),'data','provider-health');
  const rows=[];
  if(existsSync(dir)) for(const file of readdirSync(dir).filter(f=>f.endsWith('.json'))) {
    try { const row=JSON.parse(readFileSync(path.join(dir,file),'utf8')); const index=rows.findIndex(x=>x.source===row.source && x.name===row.name); if(index<0) rows.push(row); else if((row.checkedAt || row.lastSuccessfulScan || '')>(rows[index].checkedAt || rows[index].lastSuccessfulScan || '')) rows[index]=row; } catch {}
  }
  for(const [source,p] of Object.entries(SOURCE_POLICIES)) if(!rows.some(r=>r.source===source)) rows.push({source,name:source,...p,status:p.status || (p.integrationType==='SEARCH_ONLY' ? 'DEGRADED' : 'CONFIG_MISSING'),jobsFetched:0,jobsRelevant:0,newJobs:0,duplicates:0,expiredRemoved:0,coverage:p.integrationType==='SEARCH_ONLY' ? 'PARTIAL' : 'UNKNOWN',errors:[p.reason || 'Not executed yet'],durationMs:0,lastSuccessfulScan:null});
  return [...rows,...SEARCH_SOURCES.filter(p=>!rows.some(r=>({'pracuj.pl':'pracuj','theprotocol.it':'protocol','bulldogjob.pl':'bulldogjob'}[p.domain])===r.source)).map(p=>({...p,source:p.domain,jobsFetched:0,newJobs:0,duplicates:0,errors:[p.reason],lastSuccessfulScan:null,durationMs:0}))];
}
export function recordDuplicates(jobs) {
  const counts={};
  for(const j of jobs) for(const alias of (j.sourceAliases || []).slice(1)) counts[`${alias.source}:${alias.sourceName || alias.source}`]=(counts[`${alias.source}:${alias.sourceName || alias.source}`] || 0)+1;
  const dir=path.join(getCareerOpsRoot(),'data','provider-health');
  if(!existsSync(dir)) return;
  for(const file of readdirSync(dir).filter(f=>f.endsWith('.json'))) {
    try {const p=path.join(dir,file), row=JSON.parse(readFileSync(p,'utf8'));row.duplicates=counts[`${row.source}:${row.name}`] || 0;writeFileSync(p,JSON.stringify(row));} catch {}
  }
}

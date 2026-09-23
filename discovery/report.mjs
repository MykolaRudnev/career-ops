import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { loadProviders, resolveProvider } from '../providers/_registry.mjs';
import { makeHttpCtx } from '../providers/_http.mjs';
import { deduplicateJobs } from './normalize.mjs';
import { readProviderHealth, recordDuplicates } from './health.mjs';
import { SOURCE_POLICIES, SEARCH_SOURCES } from './sources.mjs';
import { buildTitleFilter } from '../title-keywords.mjs';
import { analyzeJobMatch } from '../server/jobMatch.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export async function discoveryReport() {
  const dataRoot=getCareerOpsRoot();
  const config=yaml.load(readFileSync(process.env.CAREER_OPS_EUROPE_PORTALS || path.join(dataRoot,'portals.yml'),'utf8'));
  const providers=await loadProviders(path.join(root,'providers'));
  const entries=[...(config.job_boards || []),...(config.tracked_companies || [])];
  const raw=[], errors=[], scanned=[];
  const tasks=entries.filter(e=>e.enabled!==false || e.provider==='ziprecruiter').map(entry=>async()=>{
    const r=resolveProvider(entry,providers);
    if(!r?.provider || !SOURCE_POLICIES[r.provider.id]) return;
    scanned.push(r.provider.id);
    try { const jobs=await r.provider.fetch(entry,{...makeHttpCtx(),refresh:process.argv.includes('--refresh')});raw.push(...jobs);console.error(`${entry.name}: ${jobs.length}`); }
    catch(e) {errors.push({source:r.provider.id,name:entry.name,error:e.message});console.error(`${entry.name}: ${e.message}`);}
  });
  // Four HTTP workers; providers paginate sequentially within their request budget.
  let next=0;await Promise.all(Array.from({length:4},async()=>{while(next<tasks.length) await tasks[next++]();}));
  const filter=buildTitleFilter(config.title_filter);
  const relevant=raw.filter(j=>j.remoteEligibility!=='INDIA_ONLY' && filter(j.title) && (!j.expiresAt || Date.parse(j.expiresAt)>Date.now()));
  const unique=deduplicateJobs(relevant);recordDuplicates(unique);
  for(const j of unique) {
    const m=analyzeJobMatch({title:j.title,company:j.company,location:j.location},[j.description,...(j.technologies || [])].join('\n'));
    j.match=m.matchClassification;j.rankingCategory=m.rankingCategory;j.compatibilityPercent=m.compatibilityPercent;j.matchReason=m.reason;
  }
  const priority={HIGH:0,REVIEW:1,LOW:2,SKIP:3};
  const matchRank={'BEST MATCH':0,'GOOD MATCH':1,'POSSIBLE MATCH':2,'LOW MATCH':3,'SKIP':4};
  unique.sort((a,b)=>(priority[a.eligibilityPriority]??1)-(priority[b.eligibilityPriority]??1) || (matchRank[a.match]??3)-(matchRank[b.match]??3) || (b.compatibilityPercent || 0)-(a.compatibilityPercent || 0) || a.sourcePriority-b.sourcePriority);
  const countBy=(rows,fn)=>rows.reduce((a,j)=>{const k=fn(j)||'UNKNOWN';a[k]=(a[k]||0)+1;return a;},{});
  const top=unique.slice(0,50), has=(j,re)=>re.test(`${j.title} ${j.technologies.join(' ')}`);
  const report={generatedAt:new Date().toISOString(),discoveryOnly:true,rawJobs:raw.length,relevantJobs:relevant.length,uniqueJobs:unique.length,duplicates:relevant.length-unique.length,
    bySource:{...Object.fromEntries(Object.keys(SOURCE_POLICIES).map(s=>[s,0])),...countBy(raw,j=>j.source)},
    uniquePolandJobs:unique.filter(j=>j.remoteEligibility==='POLAND'||j.eligibleCountries.some(c=>/^(pl|poland)$/i.test(c))).length,
    byEligibility:countBy(unique,j=>j.remoteEligibility),byMatch:countBy(unique,j=>j.match),
    top50:{pureFrontend:top.filter(j=>j.rankingCategory==='pure-frontend').length,reactNextTypeScript:top.filter(j=>has(j,/react|next\.?js|typescript/i)).length,magentoHyva:top.filter(j=>has(j,/magento|hyv[aä]/i)).length,shopify:top.filter(j=>has(j,/shopify/i)).length,frontendHeavyFullstack:top.filter(j=>j.rankingCategory==='frontend-heavy-fullstack').length,reactNativeBestMatches:top.filter(j=>j.match==='BEST MATCH'&&j.rankingCategory==='mobile').length,backendHeavyBestMatches:top.filter(j=>j.match==='BEST MATCH'&&j.rankingCategory==='backend-heavy').length},
    errors,health:readProviderHealth(),searchOnly:SEARCH_SOURCES,top30:unique.slice(0,30),jobs:unique};
  if(!process.argv.includes('--no-write')) {mkdirSync(path.join(dataRoot,'data'),{recursive:true});writeFileSync(path.join(dataRoot,'data','discovery-report.json'),JSON.stringify(report,null,2));}
  console.log(JSON.stringify({...report,jobs:undefined,top30:report.top30.map(j=>({company:j.company,title:j.title,url:j.url,source:j.source,eligibility:j.remoteEligibility,match:j.match,score:j.compatibilityPercent,category:j.rankingCategory}))},null,2));
  return report;
}

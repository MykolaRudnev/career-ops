import { createHash } from 'node:crypto';
import { htmlToText } from '../providers/_html-to-text.mjs';
import { classifyEligibility, eligibilityPriority } from './eligibility.mjs';
export function canonicalUrl(value) {
  try {
    const u = new URL(value);
    if (!['https:','http:'].includes(u.protocol)) return '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|ref$|source$|referrer$)/i.test(k)) u.searchParams.delete(k);
    u.hash = ''; u.searchParams.sort();
    return u.href.replace(/\/$/,'');
  } catch { return ''; }
}
const date = value => { if (value == null || value === '') return null; const d = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value); return Number.isNaN(+d) ? null : d.toISOString(); };
export function normalizeJob(j, source, policy, now = new Date().toISOString()) {
  const url = canonicalUrl(j.canonicalUrl || j.url);
  if (!url || !j.title) return null;
  const salary = typeof j.salary === 'object' && j.salary ? j.salary : {};
  const result = {
    ...j, id:j.id || `${source}:${j.sourceJobId || createHash('sha256').update(url).digest('hex').slice(0,20)}`,
    source, sourceName:j.sourceName || source, sourceType:j.sourceType || policy.sourceType || (policy.sourcePriority===0 ? 'EMPLOYER_ATS' : 'JOB_BOARD'),
    integrationType:policy.integrationType, sourceJobId:j.sourceJobId || null,
    canonicalUrl:url, url, applyUrl:canonicalUrl(j.applyUrl) || null, company:j.company || '', title:j.title,
    description:htmlToText(j.description || '', 100000), locationRaw:j.locationRaw || j.location || '', location:j.location || j.locationRaw || '',
    city:j.city || null, country:j.country || null, workModel:String(j.workModel || j.remoteType || (/remote/i.test(j.location || '') ? 'REMOTE' : 'UNKNOWN')).toUpperCase(),
    eligibleCountries:j.eligibleCountries || (j.country ? [j.country] : []), timezoneRestrictions:j.timezoneRestrictions || [],
    employmentType:j.employmentType || null, contractType:j.contractType || salary.employmentType || salary.type || null, seniority:j.seniority || null,
    salaryMin:j.salaryMin ?? salary.min ?? salary.from ?? null, salaryMax:j.salaryMax ?? salary.max ?? salary.to ?? null,
    salaryCurrency:j.salaryCurrency || salary.currency || null, salaryPeriod:j.salaryPeriod || salary.period || null,
    technologies:j.technologies || [], publishedAt:date(j.publishedAt || j.postedAt), expiresAt:date(j.expiresAt),
    discoveredAt:j.discoveredAt || now, lastVerifiedAt:now, directEmployerSource:policy.sourcePriority===0, sourcePriority:policy.sourcePriority,
    attribution:{name:source,url},
  };
  result.remoteEligibility = classifyEligibility(result);
  result.eligibility = result.remoteEligibility;
  result.eligibilityPriority = eligibilityPriority(result.remoteEligibility,result.eligibleCountries);
  return result;
}
const text = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function deduplicateJobs(jobs) {
  const index = new Map(), result = [];
  for (const job of [...jobs].sort((a,b)=>(a.sourcePriority ?? 90)-(b.sourcePriority ?? 90))) {
    const keys = [canonicalUrl(job.canonicalUrl || job.url),canonicalUrl(job.applyUrl)].filter(Boolean).map(u=>`url:${u}`);
    if (job.directEmployerSource && job.sourceJobId) keys.push(`ats:${job.source}:${text(job.company)}:${job.sourceJobId}`);
    if (job.company && job.title) keys.push(`role:${text(job.company)}:${text(job.title)}:${text(job.locationRaw || job.location)}`);
    if (job.description?.length > 300) keys.push(`body:${text(job.company)}:${text(job.title)}:${createHash('sha256').update(text(job.description)).digest('hex')}`);
    const survivor = keys.map(k=>index.get(k)).find(Boolean);
    const alias = {source:job.source,sourceJobId:job.sourceJobId,url:job.url,applyUrl:job.applyUrl,location:job.locationRaw || job.location,sourceName:job.sourceName};
    if (survivor) survivor.sourceAliases.push(alias);
    else { job.sourceAliases = [alias]; result.push(job); }
    for (const k of keys) index.set(k,survivor || job);
  }
  return result;
}

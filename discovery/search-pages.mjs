// Deterministic JSON-LD only on explicit, search-discovered job URLs. No crawler.
const hosts={justjoin:'justjoin.it',nofluffjobs:'nofluffjobs.com',pracuj:'pracuj.pl',protocol:'theprotocol.it',bulldogjob:'bulldogjob.com'};
const robotsCache=new Map();
export function parseJobPostingPage(html,url) {
  const rows=[];
  function visit(v) {
    if(Array.isArray(v)) {v.forEach(visit);return;}
    if(!v || typeof v!=='object') return;
    if(v['@type']==='JobPosting' || v['@type']?.includes?.('JobPosting')) {
      const locations=[v.jobLocation].flat().filter(Boolean).map(l=>l.address || {});
      const regions=[v.applicantLocationRequirements].flat().filter(Boolean).map(l=>l.name).filter(Boolean);
      rows.push({title:v.title,url,company:v.hiringOrganization?.name || '',description:v.description || '',
        location:locations.map(l=>[l.addressLocality,l.addressCountry?.name || l.addressCountry].filter(Boolean).join(', ')).join('; '),
        eligibleCountries:regions,workModel:v.jobLocationType==='TELECOMMUTE'?'REMOTE':'UNKNOWN',sourceJobId:v.identifier?.value,
        postedAt:Date.parse(v.datePosted)||undefined,expiresAt:v.validThrough,employmentType:v.employmentType,
        salaryMin:v.baseSalary?.value?.minValue,salaryMax:v.baseSalary?.value?.maxValue,salaryCurrency:v.baseSalary?.currency,salaryPeriod:v.baseSalary?.value?.unitText});
    }
    if(v['@graph']) visit(v['@graph']);
  }
  for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {try{visit(JSON.parse(m[1]));}catch{}}
  return rows;
}
function allowed(robots,url) {
  // Respect wildcard and Career-Ops groups. Longest matching rule wins.
  let active=false;const matches=[];
  for(const line of robots.split(/\r?\n/)) {
    const m=line.replace(/#.*/,'').trim().match(/^([^:]+):\s*(.*)$/);if(!m)continue;
    const key=m[1].toLowerCase(),value=m[2].trim();
    if(key==='user-agent') {active=value==='*'||/career-ops/i.test(value);continue;}
    if(active&&['allow','disallow'].includes(key)&&value) {
      const pattern=value.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\\\$$/,'$');
      if(new RegExp('^'+pattern).test(url.pathname+url.search))matches.push({length:value.length,allow:key==='allow'});
    }
  }
  matches.sort((a,b)=>b.length-a.length||Number(b.allow)-Number(a.allow));return !matches.length||matches[0].allow;
}
export async function fetchSearchPages(source,entry,ctx) {
  const jobs=[];
  for(const raw of (entry.search_urls || []).slice(0,20)) {
    const url=new URL(raw),host=hosts[source];
    if(!host || url.protocol!=='https:' || !(url.hostname===host||url.hostname===`www.${host}`)) throw new Error('untrusted search-page host');
    let robots=robotsCache.get(url.origin);
    if(robots===undefined) {robots=await ctx.fetchText(`${url.origin}/robots.txt`,{redirect:'error'});robotsCache.set(url.origin,robots);}
    if(!allowed(robots,url)) {ctx.markPartial?.(`robots.txt disallows ${url.pathname}`);continue;}
    const html=await ctx.fetchText(url.href,{redirect:'error'});
    if(/<title>[^<]*(?:just a moment|access denied|captcha)/i.test(html)) throw new Error('BLOCKED search page');
    const parsed=parseJobPostingPage(html,url.href);
    if(!parsed.length)ctx.markPartial?.('No JobPosting JSON-LD on discovered page; no browser fallback');
    jobs.push(...parsed);
  }
  ctx.markPartial?.('SEARCH_ONLY: bounded search-discovered pages; no automatic search engine connector');
  return jobs;
}

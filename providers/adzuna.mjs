// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { fetchJsonWithRetry, sleep } from './_http.mjs';
const HOST = 'api.adzuna.com';
const text = (v) => typeof v === 'string' ? v.trim() : '';
const epoch = (v) => { const n = Date.parse(v); return Number.isNaN(n) ? undefined : n; };
export function parseAdzunaResponse(json, market = '') {
  if (!json || !Array.isArray(json.results)) return [];
  return json.results.map(j => {
    let url = ''; try { const u = new URL(text(j?.redirect_url)); if (u.protocol === 'https:' || u.protocol === 'http:') url = u.href; } catch {}
    if (!text(j?.title) || !url) return null;
    return { title:text(j.title), url, company:text(j?.company?.display_name), location:text(j?.location?.display_name), description:text(j.description), postedAt:epoch(j.created), sourceJobId:text(j.id), salaryMin:Number.isFinite(j.salary_min)?j.salary_min:undefined, salaryMax:Number.isFinite(j.salary_max)?j.salary_max:undefined, salaryCurrency:String(market).toLowerCase()==='gb'?'GBP':undefined, employmentType:text(j.contract_time), contractType:text(j.contract_type), sourceType:'aggregator' };
  }).filter(Boolean);
}
/** @type {Provider} */
export default { id:'adzuna', detect:e=>e?.provider==='adzuna'?{url:`https://${HOST}`}:null, async fetch(entry,ctx){
  const appId=process.env.ADZUNA_APP_ID, appKey=process.env.ADZUNA_APP_KEY; if(!appId||!appKey) throw new Error('adzuna: API KEY MISSING (ADZUNA_APP_ID / ADZUNA_APP_KEY)');
  const c=entry?.adzuna||{}, markets=Array.isArray(c.markets)&&c.markets.length?c.markets:[c.market||'gb'], queries=Array.isArray(c.queries)&&c.queries.length?c.queries:[c.what||'frontend'];
  const pages=Math.min(Number(ctx?.maxPages)||Number(entry?.max_pages)||2,10), out=[], seen=new Set();
  for(const market of markets.slice(0,20)) for(const q of queries.slice(0,20)) for(let page=1;page<=pages;page++){
    const u=new URL(`https://${HOST}/v1/api/jobs/${encodeURIComponent(String(market).toLowerCase())}/search/${page}`); u.searchParams.set('app_id',appId);u.searchParams.set('app_key',appKey);u.searchParams.set('results_per_page','50');u.searchParams.set('what',String(q));u.searchParams.set('sort_by','date');u.searchParams.set('content-type','application/json'); if(c.where)u.searchParams.set('where',String(c.where));
    const json=await fetchJsonWithRetry(ctx,u.href,{headers:{accept:'application/json'},redirect:'error'}); const rows=parseAdzunaResponse(json,market); for(const row of rows)if(!seen.has(row.sourceJobId||row.url)){seen.add(row.sourceJobId||row.url);out.push(row);} if(rows.length<50)break; await sleep(250,ctx);
  } return out;
}};

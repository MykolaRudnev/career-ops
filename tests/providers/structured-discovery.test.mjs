import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { wrapProvider } from '../../discovery/runtime.mjs';
import { classifyEligibility, eligibilityPriority } from '../../discovery/eligibility.mjs';
import { deduplicateJobs, normalizeJob } from '../../discovery/normalize.mjs';
import solid from '../../providers/solidjobs.mjs';
import himalayas from '../../providers/himalayas.mjs';
import landing from '../../providers/landingjobs.mjs';
import epraca from '../../providers/epraca.mjs';

test('country restrictions override incidental global marketing and preserve review',()=>{
 assert.equal(classifyEligibility({location:'United States',description:'Our company serves clients worldwide, including Poland.'}),'US_ONLY');
 assert.equal(classifyEligibility({eligibleCountries:['US'],description:'A global team in Europe'}),'US_ONLY');
 assert.equal(classifyEligibility({location:'Remote'}),'UNKNOWN');
 assert.equal(classifyEligibility({location:'Europe',description:'Must reside in the United States'}),'US_ONLY');
 assert.equal(classifyEligibility({eligibleCountries:['Poland','Germany']}),'COUNTRY_LIST');
 assert.equal(eligibilityPriority('COUNTRY_LIST',['Poland','Germany']),'HIGH');
 assert.equal(classifyEligibility({timezoneRestrictions:[0,1,2]}),'TIMEZONE_RESTRICTED');
});
test('ATS survives shared apply URL and records aggregator alias; query IDs stay distinct',()=>{
 const jobs=deduplicateJobs([{source:'jobgether',sourcePriority:60,title:'Frontend',company:'A',url:'https://jobgether.com/offer/a',applyUrl:'https://jobs.example/apply?id=1&utm_source=x'}, {source:'greenhouse',sourcePriority:0,title:'Frontend',company:'A',url:'https://jobs.example/apply?id=1',directEmployerSource:true}, {source:'greenhouse',sourcePriority:0,title:'Frontend',company:'A',location:'Berlin',url:'https://jobs.example/apply?id=2'}]);
 assert.equal(jobs.length,2); assert.equal(jobs[0].source,'greenhouse'); assert.equal(jobs[0].sourceAliases.length,2);
});
test('SOLID pagination and salary metadata; null rows ignored',async()=>{
 const urls=[]; const jobs=await solid.fetch({careers_url:'https://solid.jobs/public-api/offers/IT'}, {fetchJson:async(url,opts)=>{urls.push(url);assert.equal(opts.headers['X-Api-Version'],'1.0');const n=urls.length;return {totalPages:2,jobs:[null,{title:'React',url:`https://solid.jobs/o/${n}`,salary:{from:0,to:20000,currency:'PLN',period:'Month'},skills:[{name:'React'}]}]};}});
 assert.equal(jobs.length,2);assert.match(urls[1],/pageIndex=1/);assert.equal(jobs[0].salaryMin,0);
});
test('Himalayas follows cursors and retains restrictions; Landing uses offset',async()=>{
 const urls=[];const jobs=await himalayas.fetch({}, {fetchJson:async url=>{urls.push(url);return {nextCursor:urls.length===1?'abc':null,jobs:[{title:'React',guid:`https://himalayas.app/jobs/${urls.length}`,locationRestrictions:[{name:'Poland',alpha2:'PL'}],description:'Required TypeScript'}]};}});
 assert.match(urls[1],/cursor=abc/); assert.deepEqual(jobs[0].eligibleCountries,['PL']);assert.equal(jobs[0].description,'Required TypeScript');
 const pages=[];await landing.fetch({}, {fetchJson:async url=>{pages.push(url);return pages.length===1?Array.from({length:50},(_,i)=>({id:i,title:'React',url:`https://landing.jobs/at/a/${i}`})):[];}});assert.match(pages[1],/offset=50/);
});
test('registry cache avoids repeat fetches; retired sources make no requests',async()=>{
 const prior=process.env.CAREER_OPS_DATA_DIR;const dir=mkdtempSync(path.join(tmpdir(),'discovery-test-'));process.env.CAREER_OPS_DATA_DIR=dir;
 try {
  let calls=0;const p=wrapProvider({id:'jobicy',fetch:async()=>{calls++;return [{title:'React',url:'https://jobicy.com/jobs/1',location:'Europe'}];}});
  await p.fetch({name:'Jobicy'},{});await p.fetch({name:'Jobicy'},{});assert.equal(calls,1);
  const disabled=wrapProvider({id:'ziprecruiter',fetch:async()=>{throw Error('must never run');}});assert.deepEqual(await disabled.fetch({},{}),[]);
  await assert.rejects(epraca.fetch({},{}),/EPRACA_PARTNER/);
 } finally {if(prior===undefined) delete process.env.CAREER_OPS_DATA_DIR;else process.env.CAREER_OPS_DATA_DIR=prior;rmSync(dir,{recursive:true,force:true});}
});
test('normalization preserves zero salary and requirements beyond old truncation',()=>{
 const j=normalizeJob({title:'Frontend',url:'https://a.example/1',description:'x'.repeat(4500)+' MUST use Java',salaryMin:0},'test',{sourcePriority:40,integrationType:'PUBLIC_API'});
 assert.equal(j.salaryMin,0);assert.match(j.description,/MUST use Java/);
});

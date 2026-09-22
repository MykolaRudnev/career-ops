import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverJobs, mergeDiscoveryReceipts } from '../discover-jobs.mjs';

const polishHealth = ['justjoin','nofluffjobs','solidjobs'].map(source => ({ source, name: source, status: 'READY', jobsFetched: 10, newJobs: 1 }));
const providerReceipt = { status: 'READY', found: 30, added: 3, duplicates: 0, offers: [{ company:'Acme', title:'Frontend Engineer', location:'Warsaw', url:'https://justjoin.it/acme', source:'justjoin', sourcePriority:20 }], source_health: polishHealth };
const atsReceipt = { sources:['greenhouse'], datasetStatus:{greenhouse:'ok'}, postingsKept:1, saved:true, offers:[{ company:'Acme', title:'Frontend Engineer', location:'Warsaw', url:'https://boards.greenhouse.io/acme/1', source:'greenhouse-full' }] };

test('Run Job Search executes provider and direct ATS lanes and reports Polish providers', async () => {
  const calls=[];
  const receipt=await discoverJobs({ dryRun:true, laneRunner:async(script)=>{calls.push(script);return {script,code:0,data:script==='scan.mjs'?providerReceipt:atsReceipt,error:null};}, reconcile:async()=>({}) });
  assert.deepEqual(calls,['scan.mjs','scan-ats-full.mjs']);
  assert.deepEqual(receipt.source_health.slice(0,3).map(row=>row.source),['justjoin','nofluffjobs','solidjobs']);
  assert.equal(receipt.offers.length,1,'same company/title/location from provider and ATS is one offer');
});

test('refresh forwards --refresh to the provider lane so dashboard scans bypass cache', async () => {
  const argsByScript = new Map();
  await discoverJobs({
    dryRun: true,
    refresh: true,
    laneRunner: async (script, args) => {
      argsByScript.set(script, args);
      return { script, code: 0, data: script === 'scan.mjs' ? providerReceipt : atsReceipt, error: null };
    },
    reconcile: async () => ({}),
  });
  assert.ok(argsByScript.get('scan.mjs')?.includes('--refresh'), `scan.mjs args should include --refresh, got ${JSON.stringify(argsByScript.get('scan.mjs'))}`);
  assert.equal(argsByScript.get('scan-ats-full.mjs')?.includes('--refresh'), false);
});

test('one provider-lane failure does not stop the ATS lane or global receipt', async () => {
  const calls=[];
  const receipt=await discoverJobs({ dryRun:true, laneRunner:async(script)=>{calls.push(script);return script==='scan.mjs'?{script,code:1,data:null,error:'NoFluffJobs API_CHANGED'}:{script,code:0,data:atsReceipt,error:null};}, reconcile:async()=>({}) });
  assert.deepEqual(calls,['scan.mjs','scan-ats-full.mjs']);
  assert.equal(receipt.status,'DEGRADED');
  assert.equal(receipt.lanes.providers.status,'ERROR');
  assert.equal(receipt.lanes.ats.status,'READY');
  assert.equal(receipt.offers.length,1);
});

test('receipt keeps provider-level API_CHANGED while healthy providers remain visible', () => {
  const provider={...providerReceipt,source_health:[...polishHealth.map(row=>row.source==='nofluffjobs'?{...row,status:'API_CHANGED',errors:['schema changed']}:row)]};
  const receipt=mergeDiscoveryReceipts({data:provider,error:null},{data:atsReceipt,error:null},{});
  assert.equal(receipt.source_health.find(row=>row.source==='nofluffjobs').status,'API_CHANGED');
  assert.equal(receipt.source_health.find(row=>row.source==='justjoin').status,'READY');
  assert.equal(receipt.source_health.find(row=>row.source==='solidjobs').status,'READY');
});

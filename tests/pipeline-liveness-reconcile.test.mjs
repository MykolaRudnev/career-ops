import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reconcilePending } from '../reconcile-pending-liveness.mjs';
import { classifyLiveness } from '../liveness-core.mjs';

const skeleton = `# Pipeline\n\n## Pending\n\n- [ ] https://jobs.test/expired | Gone Co | Frontend Engineer | Remote\n- [ ] https://jobs.test/active | Live Co | React Engineer | Remote\n- [ ] https://jobs.test/blocked | Blocked Co | UI Engineer | Remote\n\n## Processed\n`;

test('existing Pending reconciliation archives only conclusive expiry and keeps history', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'career-liveness-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'data'));
  fs.writeFileSync(path.join(root,'data/pipeline.md'),skeleton);
  const check=async url=>url.endsWith('/expired')?{result:'expired',code:'expired_body',reason:'offer expired'}:url.endsWith('/active')?{result:'active',code:'apply_control_visible',reason:'Apply'}:{result:'uncertain',code:'bot_challenge',reason:'Cloudflare'};
  const result=await reconcilePending({root,check,maxChecks:10,maxBrowser:0,now:Date.parse('2026-09-22T10:00:00Z')});
  assert.equal(result.checked,3); assert.equal(result.expiredRemoved,1); assert.equal(result.active,1); assert.equal(result.uncertain,1);
  const pipeline=fs.readFileSync(path.join(root,'data/pipeline.md'),'utf8');
  const pending=pipeline.slice(pipeline.indexOf('## Pending'),pipeline.indexOf('## Processed'));
  assert.doesNotMatch(pending,/jobs\.test\/expired/); assert.match(pending,/jobs\.test\/active/); assert.match(pending,/jobs\.test\/blocked/);
  assert.match(pipeline,/status: expired/); assert.match(fs.readFileSync(path.join(root,'data/scan-history.tsv'),'utf8'),/skipped_expired/);
  const cached=await reconcilePending({root,check,maxChecks:10,maxBrowser:0,now:Date.parse('2026-09-22T11:00:00Z')});
  assert.equal(cached.checked,0,'active and uncertain TTL avoids rechecking the entire backlog');
});

test('403, 429, 503 and Cloudflare are uncertain, never expired', () => {
  for (const status of [403,429,503]) assert.equal(classifyLiveness({status,bodyText:'Cloudflare challenge'}).result,'uncertain');
});

test('duplicate Pending roles prefer direct ATS and retain one active row', async () => {
  const { archiveDuplicatePending } = await import('../reconcile-pending-liveness.mjs');
  const input=`# Pipeline\n\n## Pending\n- [ ] https://justjoin.it/acme-role | Acme | Frontend Engineer | Warsaw\n- [ ] https://boards.greenhouse.io/acme/jobs/123 | Acme | Frontend Engineer | Warsaw\n\n## Processed\n`;
  const result=archiveDuplicatePending(input);
  const active=result.text.slice(result.text.indexOf('## Pending'),result.text.indexOf('## Processed'));
  assert.equal(result.archived,1); assert.match(active,/greenhouse/); assert.doesNotMatch(active,/justjoin/); assert.match(result.text,/status: duplicate/);
});

test('cheap liveness marks expired boards without opening a browser', async () => {
  const { checkLivenessCheap } = await import('../reconcile-pending-liveness.mjs');
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200, url: 'https://justjoin.it/job-offer/gone',
    text: async () => '<html><body><main><h1>This job is no longer available</h1><p>The listing has closed and is no longer accepting applications. Please browse other openings on our careers site for similar engineering roles across product design backend frontend and platform teams.</p></main></body></html>',
  });
  try {
    const result = await checkLivenessCheap('https://justjoin.it/job-offer/gone');
    assert.equal(result.result, 'expired');
    assert.equal(result.via, 'http');
  } finally {
    globalThis.fetch = orig;
  }
});

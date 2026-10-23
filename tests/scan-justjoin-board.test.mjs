// tests/scan-justjoin-board.test.mjs — Level 0 job_boards + justjoin provider → pipeline Pending
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';

console.log('\nscan.mjs — JustJoin job_board (fixture) lands RedStone + Attomy in Pending');

const REDSTONE_URL = 'https://justjoin.it/job-offer/redstone-frontend-developer-web-designer-warszawa-javascript';
const ATTOMY_URL = 'https://justjoin.it/job-offer/attomy-sp-z-o-o--shopify-developer-rzeszow-html-05afe0ba';

function pendingUrls() {
  const dir = mkdtempSync(join(tmpdir(), 'scan-justjoin-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(
      join(dir, 'data', 'applications.md'),
      `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
`,
    );
    writeFileSync(join(dir, 'data', 'pipeline.md'), '# Pipeline\n\n## Pending\n\n');
    const portals = join(dir, 'portals.yml');
    writeFileSync(
      portals,
      `title_filter:
  positive:
    - Frontend
    - Shopify
    - React
job_boards:
  - name: JustJoin.it
    careers_url: https://justjoin.it/job-offers/all-locations
    provider: justjoin
    fixture: tests/fixtures/justjoin-scan-api.json
    enabled: true
`,
    );
    execFileSync(NODE, [join(ROOT, 'scan.mjs')], {
      cwd: dir,
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_PORTALS: portals },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const p = join(dir, 'data', 'pipeline.md');
    const text = existsSync(p) ? readFileSync(p, 'utf-8') : '';
    const urls = text
      .split('\n')
      .filter((l) => /^- \[[ x]\]\s+https?:\/\//.test(l))
      .map((l) => l.replace(/^- \[[ x]\]\s+/, '').trim());
    return { urls, text, history: existsSync(join(dir, 'data', 'scan-history.tsv')) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

try {
  const { urls, history } = pendingUrls();
  if (!history) fail('scan did not write scan-history.tsv');
  else pass('scan wrote scan-history.tsv');

  const hasRedstone = urls.some((u) => u === REDSTONE_URL || u.startsWith(REDSTONE_URL));
  const hasAttomy = urls.some((u) => u === ATTOMY_URL || u.startsWith(ATTOMY_URL));
  const javaOnly = urls.some((u) => u.includes('acme-java-backend'));

  if (hasRedstone && hasAttomy) {
    pass('RedStone + Attomy URLs in pipeline Pending (title filter matches title + technologies)');
  } else {
    fail(`expected both fixtures in Pending; got: ${JSON.stringify(urls)}`);
  }

  if (!javaOnly) pass('Java-only decoy filtered out by title_filter');
  else fail('Java Backend decoy should not pass title_filter');
} catch (err) {
  fail(`e2e scan run failed: ${err.message}`);
}

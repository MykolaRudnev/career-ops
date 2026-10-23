// tests/server-pipeline-api.test.mjs — GET /api/pipeline enrich path (market analytics index shape)
import { pass, fail, ROOT } from './helpers.mjs';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

console.log('\nserver — /api/pipeline and /api/market-analytics');

const JOB_URL = 'https://justjoin.it/job-offer/test-co-frontend-react-warszawa-javascript';

function writeSandbox(root) {
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'scratch'), { recursive: true });
  writeFileSync(
    join(root, 'data', 'pipeline.md'),
    `# Pipeline

## Pending

- [ ] ${JOB_URL} | TestCo | Frontend Developer | remote

## Processed

`,
  );
  writeFileSync(
    join(root, 'data', 'discovery-latest.json'),
    JSON.stringify(
      {
        generatedAt: '2026-10-23T00:00:00.000Z',
        jobs: [
          {
            title: 'Frontend Developer',
            company: 'TestCo',
            url: JOB_URL,
            technologies: ['React', 'TypeScript'],
            location: 'remote',
            description: 'Tech stack:\nReact\nTypeScript',
          },
        ],
      },
      null,
      2,
    ),
  );
}

async function fetchJson(url) {
  const res = await fetch(url);
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function waitForReady(port) {
  for (let i = 0; i < 50; i++) {
    try {
      const { status } = await fetchJson(`http://127.0.0.1:${port}/api/market-analytics`);
      if (status === 200) return true;
    } catch {
      /* server still booting */
    }
    await delay(120);
  }
  return false;
}

const serverDir = join(ROOT, 'server');
const serverModules = join(serverDir, 'node_modules');
if (!existsSync(serverModules)) {
  execFileSync('npm', ['install', '--omit=dev'], { cwd: serverDir, stdio: 'ignore' });
}

const sandbox = mkdtempSync(join(tmpdir(), 'server-pipeline-api-'));
const port = 31000 + Math.floor(Math.random() * 5000);
writeSandbox(sandbox);

const server = spawn(
  process.execPath,
  ['--experimental-strip-types', join(ROOT, 'server', 'index.ts')],
  {
    cwd: sandbox,
    env: { ...process.env, CAREER_OPS_DASHBOARD_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let serverLog = '';
server.stderr?.on('data', (chunk) => { serverLog += chunk; });
server.stdout?.on('data', (chunk) => { serverLog += chunk; });

function stopServer() {
  if (!server.killed) server.kill('SIGTERM');
}

try {
  if (!(await waitForReady(port))) {
    fail(`dashboard server did not become ready on port ${port}\n${serverLog}`);
  } else {
    pass('dashboard server booted');
  }

  const market = await fetchJson(`http://127.0.0.1:${port}/api/market-analytics`);
  if (market.status !== 200) fail(`/api/market-analytics HTTP ${market.status}: ${JSON.stringify(market.body)}`);
  else if (!Array.isArray(market.body?.jobs)) fail('market-analytics jobs is not an array');
  else pass('/api/market-analytics returns jobs array');

  const pipeline = await fetchJson(`http://127.0.0.1:${port}/api/pipeline`);
  if (pipeline.status !== 200) {
    fail(`/api/pipeline HTTP ${pipeline.status}: ${JSON.stringify(pipeline.body)}`);
  } else if (!pipeline.body?.success) {
    fail(`/api/pipeline error: ${pipeline.body?.error || JSON.stringify(pipeline.body)}`);
  } else if (!Array.isArray(pipeline.body.pending) || pipeline.body.pending.length !== 1) {
    fail(`expected one pending job, got ${JSON.stringify(pipeline.body.pending)}`);
  } else {
    const job = pipeline.body.pending[0];
    if (!Array.isArray(job.technologies) || !job.technologies.includes('React')) {
      fail(`pipeline enrich missing market technologies: ${JSON.stringify(job.technologies)}`);
    } else if (job.fitScore == null || !job.matchClassification) {
      fail(`pipeline enrich missing evaluation fields: ${JSON.stringify(job)}`);
    } else {
      pass('/api/pipeline enriches pending jobs with market analytics + evaluation');
    }
  }
} catch (err) {
  fail(`server API test crashed: ${err.message}\n${serverLog}`);
} finally {
  stopServer();
  rmSync(sandbox, { recursive: true, force: true });
}

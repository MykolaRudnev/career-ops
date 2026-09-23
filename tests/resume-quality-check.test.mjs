import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditResumeHtml } from '../resume-quality-check.mjs';

const PAD = 'Production frontend delivery across component systems, performance work, and storefronts. '.repeat(8);

function profileYml() {
  return `candidate:
  full_name: "Ada Lovelace"
  email: "ada@example.com"
  linkedin: "https://linkedin.com/in/ada"
  github: "https://github.com/ada"
  portfolio_url: "https://ada.dev/"
`;
}

function masterCv() {
  return `# Ada Lovelace

## Experience

### Frontend Engineer, Acme Labs
Jan 2020 - Present
Remote · Poland
Built production React applications with 6+ years of frontend delivery.

## Courses & Continuous Learning

- **AWS Certified Developer**
- **React Hooks Workshop**
`;
}

function headerLinks(kind) {
  if (kind === 'headline-only') return '';
  if (kind === 'bad-scheme') {
    return `
      <a href="javascript:void(0)">linkedin.com/in/ada</a>
      <a href="mailto:ada@example.com">github.com/ada</a>
      <a href="/portfolio">ada.dev</a>`;
  }
  return `
      <a href="https://linkedin.com/in/ada">linkedin.com/in/ada</a>
      <a href="https://github.com/ada">github.com/ada</a>
      <a href="https://ada.dev/">ada.dev</a>`;
}

function projectBlock(domain) {
  const tech = {
    REACT_FRONTEND: ['React, Next.js', 'React, TypeScript', 'Next.js, Gatsby', 'React'],
    MAGENTO_HYVA: ['Magento 2, Hyvä', 'Magento 2', 'Hyvä, Alpine.js', 'Adobe Commerce'],
    SHOPIFY: ['Shopify, Liquid', 'Shopify', 'Liquid', 'Shopify, JSON Templates'],
  }[domain];
  return tech.map(item => `<div class="project"><div class="project-tech">${item}</div></div>`).join('\n');
}

function cvHtml(overrides = {}) {
  const domain = overrides.domain || 'REACT_FRONTEND';
  const headline = overrides.headline || 'Senior React Developer';
  const summary = overrides.summary || 'Senior React Developer with 6+ years building scalable production UIs, Cursor, and Claude.';
  const period = overrides.period || 'Jan 2020 - Present';
  const extraBullet = overrides.extraBullet || 'Delivered accessible React storefronts.';
  const skills = (overrides.skills || [
    'React', 'Next.js', 'TypeScript', 'JavaScript', 'HTML5', 'CSS3',
    'SSR', 'ISR', 'SSG', 'REST API', 'GraphQL', 'Tailwind CSS',
    'Git', 'Docker', 'Accessibility', 'Magento 2', 'Hyvä', 'Shopify', 'Liquid',
  ]).map(skill => `<div class="skill-item">${skill}</div>`).join('\n');
  const nameExtra = overrides.linkKind === 'headline-only'
    ? ' https://linkedin.com/in/ada https://github.com/ada https://ada.dev/'
    : '';
  return `<!doctype html><html><body>
<!-- HEADER -->
<div class="header">
  <h1>Ada Lovelace${nameExtra}</h1>
  <div class="header-headline">${headline}</div>
  <div class="contact-row">
    <a href="mailto:ada@example.com">ada@example.com</a>
    ${headerLinks(overrides.linkKind)}
  </div>
</div>
<!-- PROFESSIONAL SUMMARY -->
<div class="summary-text">${summary}</div>
<p>${PAD}</p>
<!-- WORK EXPERIENCE -->
<div class="job">
  <span class="job-company">Acme Labs</span>
  <span class="job-period">${period}</span>
  <div class="job-role">Frontend Engineer</div>
  <div class="job-location">Remote · Poland</div>
  <ul>
    <li>${extraBullet}</li>
    <li>Built production React applications.</li>
  </ul>
</div>
<!-- PROJECTS -->
${projectBlock(domain)}
<!-- SKILLS -->
${skills}
<!-- EDUCATION -->
<div>University placeholder</div>
<!-- CERTIFICATIONS -->
<div class="cert-title">AWS Certified Developer</div>
<div class="cert-title">React Hooks Workshop</div>
</body></html>`;
}

function fixture(t, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'resume-quality-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10 }));
  mkdirSync(join(dir, 'config'), { recursive: true });
  mkdirSync(join(dir, 'output'), { recursive: true });
  writeFileSync(join(dir, 'cv.md'), files.cv || masterCv());
  writeFileSync(join(dir, 'config', 'profile.yml'), files.profile || profileYml());
  writeFileSync(join(dir, 'output', 'cv.html'), files.html || cvHtml());
  if (files.jd) writeFileSync(join(dir, 'output', 'job-description.md'), files.jd);
  if (files.diff) writeFileSync(join(dir, 'output', 'tailoring-diff.json'), JSON.stringify(files.diff));
  return dir;
}

function audit(dir, htmlOverrides = {}, options = {}) {
  const html = typeof htmlOverrides === 'string' ? htmlOverrides : cvHtml(htmlOverrides);
  return auditResumeHtml(html, {
    workspaceRoot: dir,
    inputPath: join(dir, 'output', 'cv.html'),
    ...options,
  });
}

test('missing JD keyword is a warning', t => {
  const dir = fixture(t, { jd: 'React, Next.js, TypeScript, Core Web Vitals and REST API.' });
  const report = audit(dir, {}, { role: 'Senior React Developer', domain: 'REACT_FRONTEND' });
  assert.equal(report.checks.jd_keywords.status, 'warning');
  assert.match(report.checks.jd_keywords.details, /Core Web Vitals/);
});

test('buzzword and first-person prose are warnings', t => {
  const dir = fixture(t);
  const report = audit(dir, {
    summary: 'I am a results-driven Senior React Developer with 6+ years building production UIs. Cursor and Claude.',
  }, { role: 'Senior React Developer', domain: 'REACT_FRONTEND' });
  assert.equal(report.checks.first_person.status, 'warning');
  assert.equal(report.checks.buzzwords.status, 'warning');
  assert.match(report.checks.buzzwords.details, /results-driven/i);
});

test('invented metric blocks factual_metrics', t => {
  const dir = fixture(t);
  const report = audit(dir, {
    extraBullet: 'Reached 94,772 users in production React apps.',
  }, { role: 'Senior React Developer', domain: 'REACT_FRONTEND' });
  assert.equal(report.checks.factual_metrics.status, 'block');
  assert.match(report.checks.factual_metrics.details, /94772 users|94,772 users/i);
  assert.ok(report.blockers.some(item => item.startsWith('factual_metrics')));
});

test('wrong date blocks dates_locations', t => {
  const dir = fixture(t);
  const report = audit(dir, {
    period: 'Jan 1999 - Present',
  }, { role: 'Senior React Developer', domain: 'REACT_FRONTEND' });
  assert.equal(report.checks.dates_locations.status, 'block');
  assert.match(report.checks.dates_locations.details, /Jan 1999/);
});

test('certificates from master CV are preserved', t => {
  const dir = fixture(t);
  const report = audit(dir, {}, { role: 'Senior React Developer', domain: 'REACT_FRONTEND' });
  assert.equal(report.checks.certificates.status, 'pass');
  assert.match(report.checks.certificates.details, /2 verified entries/);
});

test('React, Magento, and Shopify project routing pass at 75%+', t => {
  for (const [domain, role, headline] of [
    ['REACT_FRONTEND', 'Senior React Developer', 'Senior React Developer'],
    ['MAGENTO_HYVA', 'Magento / Hyva Developer', 'Magento / Hyva Developer'],
    ['SHOPIFY', 'Shopify Developer', 'Shopify Developer'],
  ]) {
    const dir = fixture(t);
    const report = audit(dir, { domain, headline }, { role, domain });
    assert.equal(report.checks.project_routing.status, 'pass', domain);
    assert.match(report.checks.project_routing.details, /4\/4/);
  }
});

test('phantom jd_keywords_matched without JD evidence is a warning', t => {
  const dir = fixture(t, {
    jd: 'React, Next.js, TypeScript and REST API.',
    diff: { jd_keywords_matched: ['Kubernetes', 'React'] },
  });
  const report = audit(dir, {}, { role: 'Senior React Developer', domain: 'REACT_FRONTEND' });
  assert.equal(report.checks.phantom_requirements.status, 'warning');
  assert.match(report.checks.phantom_requirements.details, /Kubernetes/);
  assert.doesNotMatch(report.checks.phantom_requirements.details, /React/);
});

test('skipFactCheck reports skipped, not PASS, for factual checks', t => {
  const dir = fixture(t);
  const report = audit(dir, {
    extraBullet: 'Reached 94,772 users in production React apps.',
  }, { role: 'Senior React Developer', domain: 'REACT_FRONTEND', skipFactCheck: true });
  assert.equal(report.checks.factual_metrics.status, 'skipped');
  assert.equal(report.checks.factual_consistency.status, 'skipped');
  assert.ok(!report.passed.includes('factual_metrics'));
  assert.ok(!report.passed.includes('factual_consistency'));
  assert.equal(report.checks.factual_metrics.details, 'skipped (--skip-fact-check)');
  assert.ok(report.skipped.some(item => item.startsWith('factual_metrics')));
  assert.ok(report.warnings.some(item => item.startsWith('factual_metrics')));
  assert.ok(!report.blockers.some(item => item.startsWith('factual_metrics')));
});

test('online links require visible http(s) anchors, not headline text', t => {
  const dir = fixture(t);
  const good = audit(dir, { linkKind: 'good' }, { role: 'Senior React Developer', domain: 'REACT_FRONTEND' });
  assert.equal(good.checks.online_links.status, 'pass');

  const headlineOnly = audit(dir, { linkKind: 'headline-only' }, { role: 'Senior React Developer', domain: 'REACT_FRONTEND' });
  assert.equal(headlineOnly.checks.online_links.status, 'warning');
  assert.match(headlineOnly.checks.online_links.details, /missing:/);

  const badScheme = audit(dir, { linkKind: 'bad-scheme' }, { role: 'Senior React Developer', domain: 'REACT_FRONTEND' });
  assert.equal(badScheme.checks.online_links.status, 'warning');
  assert.match(badScheme.checks.online_links.details, /invalid href:/);
});

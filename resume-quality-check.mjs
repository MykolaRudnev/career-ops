#!/usr/bin/env node

/** Deterministic final CV quality gate. No model calls. */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { isMainModule } from './lib/is-main-module.mjs';
import { stripMarkup, verifyFacts } from './verify-cv-facts.mjs';

const BUZZWORDS = [
  'results-driven', 'passionate', 'dynamic professional', 'proven track record',
  'committed to excellence', 'leveraging cutting-edge technologies',
  'leveraging cutting-edge technology', 'highly motivated', 'team player', 'go-getter',
];
const WEAK_BULLET_START = /^(?:responsible for|worked (?:on|as|in)|helped (?:with|to)|assisted (?:with|in)|involved in|participated in|tasked with)\b/i;
const ACTION_START = /^(?:built|building|led|leading|delivered|delivering|developed|developing|migrated|migrating|implemented|implementing|optimized|optimizing|improved|improving|designed|designing|integrated|integrating|owned|owning|created|creating|architected|architecting|launched|launching|established|establishing|drove|driving|managed|managing|engineered|engineering|refactored|refactoring|automated|automating|reduced|reducing|increased|increasing|maintained|maintaining|collaborated|collaborating|leveraged|leveraging|acting)\b/i;
const FIRST_PERSON = /\b(?:I|I'm|I’m|I've|I’ve|my\s+(?:experience|skills))\b/i;
const DOMAIN_LABELS = {
  REACT_FRONTEND: 'React / Next.js',
  MAGENTO_HYVA: 'Magento 2 / Hyvä',
  SHOPIFY: 'Shopify / Liquid',
};
const DOMAIN_PATTERNS = {
  REACT_FRONTEND: /\b(?:react(?:\.js)?|next(?:\.js)?|gatsby(?:\.js)?)\b/i,
  MAGENTO_HYVA: /\b(?:magento(?:\s*2)?|adobe commerce|hyv[aä]|alpine(?:\.js)?)\b/i,
  SHOPIFY: /\b(?:shopify|liquid)\b/i,
};
const DOMAIN_SKILLS = {
  REACT_FRONTEND: ['React', 'Next.js', 'TypeScript'],
  MAGENTO_HYVA: ['Magento 2', 'Hyvä'],
  SHOPIFY: ['Shopify', 'Liquid'],
};
const KEYWORDS = [
  ['React Native', /\bReact\s+Native\b/i],
  ['Core Web Vitals', /\bCore\s+Web\s+Vitals\b/i],
  ['Adobe Commerce', /\bAdobe\s+Commerce\b/i],
  ['Magento 2', /\bMagento\s*2\b/i],
  ['Hyvä', /\bHyv[aä]\b/i],
  ['Shopify CLI', /\bShopify\s+CLI\b/i],
  ['JSON Templates', /\bJSON\s+Templates?\b/i],
  ['Next.js', /\bNext(?:\.js|JS)?\b/i],
  ['TypeScript', /\bTypeScript\b/i],
  ['React', /\bReact\b(?!\s+Native)/i],
  ['Liquid', /\bLiquid\b/i],
  ['Shopify', /\bShopify\b/i],
  ['Alpine.js', /\bAlpine(?:\.js|JS)?\b/i],
  ['REST API', /\bREST(?:ful)?\s+APIs?\b/i],
  ['GraphQL', /\bGraphQL\b/i],
  ['Accessibility', /\b(?:Accessibility|WCAG)\b/i],
  ['JavaScript', /\bJavaScript\b/i],
  ['HTML5', /\bHTML5?\b/i],
  ['CSS3', /\bCSS3?\b/i],
  ['Tailwind CSS', /\bTailwind(?:\s+CSS)?\b/i],
  ['SSR', /\bSSR\b/i],
  ['SSG', /\bSSG\b/i],
  ['ISR', /\bISR\b/i],
  ['SEO', /\bSEO\b/i],
  ['Git', /\bGit\b/i],
  ['Docker', /\bDocker\b/i],
];

const LABELS = {
  artifact_integrity: 'Valid CV artifact',
  candidate_identity: 'Candidate identity present',
  target_title: 'Target title matches vacancy',
  jd_keywords: 'Important JD keywords are present',
  first_impression: 'Top section communicates role and specialization',
  online_links: 'Online links present',
  first_person: 'No first-person prose',
  buzzwords: 'No obvious buzzwords',
  action_words: 'Action-oriented experience bullets',
  technical_skills: 'Relevant Technical Skills present',
  factual_metrics: 'No invented metrics',
  factual_consistency: 'No factual inconsistencies',
  certificates: 'All verified certificates present',
  ai_assisted_engineering: 'AI-assisted engineering visible',
  project_routing: 'Correct project domain routing',
  phantom_requirements: 'No phantom requirements',
  dates_locations: 'Correct dates and locations',
  typo_grammar: 'Typo and grammar sanity check',
  page_count: 'Two-page target',
  pdf_text_extraction: 'PDF text extraction readable',
};

function decodeHtml(text) {
  return String(text || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;|&#34;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#183;|&middot;/gi, '·')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function plain(text) {
  return decodeHtml(stripMarkup(String(text || ''))).replace(/\s+/g, ' ').trim();
}

function folded(text) {
  return plain(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function classTexts(html, className) {
  const out = [];
  const re = new RegExp(`<([a-z][a-z0-9]*)[^>]+class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'gi');
  for (const match of html.matchAll(re)) out.push(plain(match[2]));
  return out.filter(Boolean);
}

function between(html, start, end) {
  const from = html.indexOf(start);
  if (from === -1) return '';
  const to = html.indexOf(end, from + start.length);
  return html.slice(from, to === -1 ? undefined : to);
}

function normalizeHttpUrl(url) {
  const raw = String(url || '').trim();
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return folded(`${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`);
  } catch {
    return '';
  }
}

function headerAnchors(headerHtml) {
  const out = [];
  for (const match of headerHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = decodeHtml((match[1].match(/\bhref\s*=\s*["']([^"']*)["']/i) || [])[1] || '').trim();
    out.push({ href, text: plain(match[2]) });
  }
  return out;
}

function isHttpHref(href) {
  return /^https?:\/\//i.test(String(href || '').trim());
}

function onlineLinkFailures(headerHtml, expectedLinks) {
  const anchors = headerAnchors(headerHtml);
  const missing = [];
  const invalid = [];
  for (const expected of expectedLinks) {
    const want = normalizeHttpUrl(expected);
    if (!want) {
      missing.push(expected);
      continue;
    }
    const httpMatch = anchors.find(anchor => isHttpHref(anchor.href) && normalizeHttpUrl(anchor.href) === want);
    if (httpMatch) {
      if (!httpMatch.text) missing.push(expected);
      continue;
    }
    const broken = anchors.find(anchor => folded(`${anchor.href} ${anchor.text}`).includes(want));
    if (broken) invalid.push(expected);
    else missing.push(expected);
  }
  return { missing, invalid };
}

function safeJson(path) {
  try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}; }
  catch { return {}; }
}

function readText(path) {
  try { return path && existsSync(path) ? readFileSync(path, 'utf8') : ''; }
  catch { return ''; }
}

function findContext({ inputPath, jdPath, role, domain }) {
  const dir = inputPath ? dirname(inputPath) : '';
  const metadata = dir ? safeJson(resolve(dir, 'metadata.json')) : {};
  const job = dir ? safeJson(resolve(dir, 'artifact-job.json')) : {};
  const diff = dir ? safeJson(resolve(dir, 'tailoring-diff.json')) : {};
  const resolvedJd = jdPath || (dir && existsSync(resolve(dir, 'job-description.md')) ? resolve(dir, 'job-description.md') : '');
  return {
    metadata,
    diff,
    jdPath: resolvedJd,
    jd: readText(resolvedJd),
    role: role || metadata.role || job.title || '',
    domain: normalizeDomain(domain || metadata.primaryDomain || diff.primary_domain || ''),
  };
}

function normalizeDomain(value) {
  const v = folded(value).replace(/[-\s/]+/g, '_');
  if (/shopify|liquid/.test(v)) return 'SHOPIFY';
  if (/magento|hyva|adobe_commerce/.test(v)) return 'MAGENTO_HYVA';
  if (/react|next|frontend/.test(v)) return 'REACT_FRONTEND';
  return '';
}

function detectDomain(role, jd) {
  const text = `${role}\n${jd}`;
  if (DOMAIN_PATTERNS.SHOPIFY.test(text)) return 'SHOPIFY';
  if (DOMAIN_PATTERNS.MAGENTO_HYVA.test(text)) return 'MAGENTO_HYVA';
  if (DOMAIN_PATTERNS.REACT_FRONTEND.test(text) || /\bTypeScript\b/i.test(text)) return 'REACT_FRONTEND';
  return '';
}

export function extractImportantJdKeywords(jd, limit = 12) {
  const found = [];
  for (const [name, pattern] of KEYWORDS) {
    const match = pattern.exec(jd);
    if (match) found.push({ name, index: match.index });
  }
  return found.sort((a, b) => a.index - b.index).slice(0, limit).map(item => item.name);
}

function keywordPresent(text, keyword) {
  const haystack = folded(text);
  const variants = {
    'rest api': ['rest api', 'restful api'],
    accessibility: ['accessibility', 'wcag'],
    'hyva': ['hyva'],
    'next.js': ['next.js', 'nextjs'],
    'alpine.js': ['alpine.js', 'alpinejs'],
    'json templates': ['json template'],
    html5: ['html5', 'html'],
    css3: ['css3', 'css'],
  };
  const key = folded(keyword);
  return (variants[key] || [key]).some(value => haystack.includes(value));
}

function add(checks, id, status, details = '') {
  checks[id] = { status, label: LABELS[id], ...(details ? { details } : {}) };
}

function canonicalSources(root) {
  const cv = readText(resolve(root, 'cv.md'));
  const profileText = readText(resolve(root, 'config', 'profile.yml'));
  let profile = {};
  try { profile = loadYaml(profileText) || {}; } catch { profile = {}; }
  return { cv, profileText, profile, all: `${cv}\n${profileText}` };
}

function canonicalCertificates(cv) {
  const start = cv.indexOf('## Courses & Continuous Learning');
  if (start === -1) return [];
  const tail = cv.slice(start + '## Courses & Continuous Learning'.length);
  const end = tail.search(/\n## /);
  const section = end === -1 ? tail : tail.slice(0, end);
  return [...section.matchAll(/^\s*-\s+\*\*(.+?)\*\*/gm)].map(match => plain(match[1]));
}

function projectRouting(html, domain) {
  if (!domain) return { ok: false, details: 'primary domain unavailable' };
  const projectHtml = between(html, '<!-- PROJECTS -->', '<!-- SKILLS -->');
  const projects = classTexts(projectHtml, 'project-tech');
  if (!projects.length) return { ok: false, details: 'no projects found' };
  const matched = projects.filter(project => DOMAIN_PATTERNS[domain].test(project)).length;
  return { ok: matched / projects.length >= 0.75, details: `${matched}/${projects.length} ${DOMAIN_LABELS[domain]} projects` };
}

function roleMatches(headline, role, domain) {
  if (!role) return false;
  if (domain && !DOMAIN_PATTERNS[domain].test(headline)) return false;
  const ignored = new Set(['senior', 'lead', 'mid', 'junior', 'the', 'and', 'with']);
  const tokens = folded(role).split(/[^a-z0-9+#.]+/).filter(token => token.length > 2 && !ignored.has(token));
  const title = folded(headline);
  return tokens.length > 0 && tokens.filter(token => title.includes(token)).length >= Math.ceil(tokens.length / 2);
}

function phantomKeywords(diff, jd) {
  const claimed = Array.isArray(diff.jd_keywords_matched) ? diff.jd_keywords_matched : [];
  return claimed.filter(keyword => !keywordPresent(jd, String(keyword)));
}

function textNodeIssues(html) {
  const issues = [];
  const visible = html.replace(/<(?:style|script)\b[\s\S]*?<\/(?:style|script)>/gi, ' ');
  for (const match of visible.matchAll(/>([^<]+)</g)) {
    const text = decodeHtml(match[1]).trim();
    if (!text) continue;
    if (/\S {2,}\S/.test(text)) issues.push(`double spaces: ${text.slice(0, 70)}`);
    if (/(?:[!?.,])\1/.test(text) && !/\.{3}/.test(text)) issues.push(`duplicate punctuation: ${text.slice(0, 70)}`);
    if (/\b([\p{L}]{3,})\s+\1\b/iu.test(text)) issues.push(`repeated word: ${text.slice(0, 70)}`);
  }
  const prose = between(html, '<!-- PROFESSIONAL SUMMARY -->', '<!-- CERTIFICATIONS -->');
  if (/\bReactJS\b|\bNextJS\b|\bTypescript\b|\bJavascript\b|\bHyva\b/.test(plain(prose))) {
    issues.push('inconsistent technology casing');
  }
  for (const date of classTexts(html, 'job-period')) {
    if (!/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} - (?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}|Present)$/i.test(date)) {
      issues.push(`malformed date: ${date}`);
    }
  }
  return [...new Set(issues)];
}

export function auditResumeHtml(html, options = {}) {
  const root = resolve(options.workspaceRoot || process.cwd());
  const context = findContext(options);
  const domain = context.domain || detectDomain(context.role, context.jd);
  const sources = canonicalSources(root);
  const checks = {};
  const body = plain(html);
  const headline = classTexts(html, 'header-headline')[0] || '';
  const summary = classTexts(html, 'summary-text')[0] || '';
  const experienceHtml = between(html, '<!-- WORK EXPERIENCE -->', '<!-- PROJECTS -->');
  const projectHtml = between(html, '<!-- PROJECTS -->', '<!-- SKILLS -->');
  const skillsHtml = between(html, '<!-- SKILLS -->', '<!-- EDUCATION -->');
  const relevantText = `${summary}\n${plain(experienceHtml)}\n${plain(projectHtml)}\n${plain(skillsHtml)}`;
  const keywords = options.keywords?.length ? options.keywords : extractImportantJdKeywords(context.jd);

  const validArtifact = /<body\b/i.test(html) && /<\/html>/i.test(html) && body.length >= 500;
  add(checks, 'artifact_integrity', validArtifact ? 'pass' : 'block', validArtifact ? '' : 'missing document structure or too little readable text');

  const candidate = sources.profile.candidate || {};
  const expectedName = String(candidate.full_name || '').trim();
  const expectedEmail = String(candidate.email || '').trim();
  const identityOk = expectedName && expectedEmail && body.includes(expectedName) && body.includes(expectedEmail);
  add(checks, 'candidate_identity', identityOk ? 'pass' : 'block', identityOk ? '' : 'canonical candidate name or email is missing');

  add(checks, 'target_title', roleMatches(headline, context.role, domain) ? 'pass' : 'warning',
    context.role ? `headline: ${headline}; vacancy: ${context.role}` : 'vacancy title unavailable');

  const missingKeywords = keywords.filter(keyword => !keywordPresent(relevantText, keyword));
  add(checks, 'jd_keywords', keywords.length && !missingKeywords.length ? 'pass' : 'warning',
    keywords.length ? (missingKeywords.length ? `missing_keyword: ${missingKeywords.join(', ')}` : `${keywords.length} checked`) : 'no important JD keywords detected');

  const domainEarly = !domain || DOMAIN_PATTERNS[domain].test(`${headline} ${summary}`);
  const firstImpressionParts = [
    /\b6\+?\s+years\b/i.test(summary),
    /\bproduction\b/i.test(summary),
    domainEarly,
    /\b(?:developer|engineer|lead|architect)\b/i.test(headline),
  ];
  add(checks, 'first_impression', firstImpressionParts.every(Boolean) ? 'pass' : 'warning',
    firstImpressionParts.every(Boolean) ? '' : 'top section should show target role, 6+ years, production scope, and primary stack');

  const headerHtml = between(html, '<!-- HEADER -->', '<!-- PROFESSIONAL SUMMARY -->');
  const expectedLinks = [candidate.linkedin, candidate.github, candidate.portfolio_url || candidate.portfolio].filter(Boolean);
  const linkFailures = onlineLinkFailures(headerHtml, expectedLinks);
  const linkDetails = [
    linkFailures.missing.length ? `missing: ${linkFailures.missing.join(', ')}` : '',
    linkFailures.invalid.length ? `invalid href: ${linkFailures.invalid.join(', ')}` : '',
  ].filter(Boolean).join('; ');
  add(checks, 'online_links', !linkDetails ? 'pass' : 'warning', linkDetails);

  const proseWithoutContacts = body.replace(/[\w.+-]+@[\w.-]+/g, ' ').replace(/https?:\/\/\S+/g, ' ');
  const firstPerson = proseWithoutContacts.match(FIRST_PERSON)?.[0] || '';
  add(checks, 'first_person', firstPerson ? 'warning' : 'pass', firstPerson ? `found: ${firstPerson}` : '');

  const buzzwords = BUZZWORDS.filter(word => folded(body).includes(folded(word)));
  add(checks, 'buzzwords', buzzwords.length ? 'warning' : 'pass', buzzwords.length ? `found: ${buzzwords.join(', ')}` : '');

  const bullets = [...experienceHtml.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(match => plain(match[1])).filter(Boolean);
  const weakBullets = bullets.filter(bullet => WEAK_BULLET_START.test(bullet) || !ACTION_START.test(bullet));
  add(checks, 'action_words', bullets.length && !weakBullets.length ? 'pass' : 'warning',
    bullets.length ? (weakBullets.length ? `review ${weakBullets.length} bullet(s): ${weakBullets.slice(0, 2).join(' | ')}` : '') : 'no experience bullets found');

  const skillItems = classTexts(skillsHtml, 'skill-item').flatMap(line => line.split(',').map(item => item.trim()).filter(Boolean));
  const requiredDomainSkills = (DOMAIN_SKILLS[domain] || []).filter(skill => keywordPresent(context.jd, skill));
  const missingSkills = requiredDomainSkills.filter(skill => !keywordPresent(skillsHtml, skill));
  const skillCountOk = skillItems.length >= 15 && skillItems.length <= 35;
  add(checks, 'technical_skills', skillCountOk && !missingSkills.length ? 'pass' : 'warning',
    `${skillItems.length} skills${missingSkills.length ? `; missing core stack: ${missingSkills.join(', ')}` : ''}`);

  if (options.skipFactCheck) {
    add(checks, 'factual_metrics', 'skipped', 'skipped (--skip-fact-check)');
    add(checks, 'factual_consistency', 'skipped', 'skipped (--skip-fact-check)');
  } else {
    const factResult = verifyFacts(html, {
      cwd: root,
      ...(options.factSourcePaths?.length ? { sourcePaths: options.factSourcePaths } : {}),
    });
    add(checks, 'factual_metrics', factResult.invented.length ? 'block' : 'pass',
      factResult.invented.length ? `unsupported: ${factResult.invented.join(', ')}` : '');

    const companies = classTexts(html, 'job-company');
    const roles = classTexts(html, 'job-role');
    const unsupportedHistory = [...companies, ...roles].filter(value => !folded(sources.all).includes(folded(value)));
    const inconsistent = [...(factResult.unsupportedFacts || []).map(item => `${item.kind}: ${item.value}`), ...(factResult.forbidden || []), ...unsupportedHistory];
    add(checks, 'factual_consistency', inconsistent.length ? 'block' : 'pass', inconsistent.length ? `unsupported: ${inconsistent.join(', ')}` : '');
  }

  const certificates = canonicalCertificates(sources.cv);
  const missingCertificates = certificates.filter(title => !folded(html).includes(folded(title)));
  add(checks, 'certificates', certificates.length && !missingCertificates.length ? 'pass' : 'warning',
    missingCertificates.length ? `missing: ${missingCertificates.join(', ')}` : `${certificates.length} verified entries present`);

  add(checks, 'ai_assisted_engineering', /\b(?:AI[- ]assisted|Cursor|Claude|ChatGPT|Gemini|LLM)\b/i.test(body) ? 'pass' : 'warning', '');

  const routing = projectRouting(html, domain);
  add(checks, 'project_routing', routing.ok ? 'pass' : 'warning', routing.details);

  const phantom = phantomKeywords(context.diff, context.jd);
  add(checks, 'phantom_requirements', phantom.length ? 'warning' : 'pass', phantom.length ? `no JD evidence: ${phantom.join(', ')}` : '');

  const historicalValues = [
    ...classTexts(html, 'job-period'),
    ...classTexts(html, 'job-location'),
  ];
  const wrongHistory = historicalValues.filter(value => !folded(sources.all).includes(folded(value)));
  add(checks, 'dates_locations', wrongHistory.length ? 'block' : 'pass', wrongHistory.length ? `not in canonical data: ${wrongHistory.join(', ')}` : '');

  const textIssues = textNodeIssues(html);
  add(checks, 'typo_grammar', textIssues.length ? 'warning' : 'pass', textIssues.join('; '));
  add(checks, 'page_count', 'pending', 'checked after rendering');
  add(checks, 'pdf_text_extraction', 'pending', 'checked after rendering');

  return summarize(checks, {
    role: context.role,
    domain,
    jdPath: context.jdPath,
    keywords,
    missingKeywords,
  });
}

export function auditRenderedPdf(report, pdfPath, pageCount, { expectedPages = 2 } = {}) {
  const checks = structuredClone(report.checks);
  add(checks, 'page_count', pageCount === expectedPages ? 'pass' : 'warning', `${pageCount} page(s); target ${expectedPages}`);

  const extracted = spawnSync('pdftotext', [pdfPath, '-'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (extracted.error?.code === 'ENOENT') {
    add(checks, 'pdf_text_extraction', 'warning', 'pdftotext is unavailable; extraction not verified');
  } else {
    const text = String(extracted.stdout || '').replace(/\s+/g, ' ').trim();
    const replacementCount = (text.match(/�/g) || []).length;
    const readable = extracted.status === 0 && text.length >= 500 && replacementCount / Math.max(1, text.length) < 0.01;
    add(checks, 'pdf_text_extraction', readable ? 'pass' : 'block',
      readable ? `${text.length} extracted characters` : `unreadable extraction (exit ${extracted.status}, ${text.length} chars)`);
  }
  return summarize(checks, report.context);
}

function summarize(checks, context = {}) {
  const entries = Object.entries(checks);
  const detail = (id, check) => `${id}${check.details ? `: ${check.details}` : ''}`;
  const passed = entries.filter(([, check]) => check.status === 'pass').map(([id]) => id);
  const skipped = entries.filter(([, check]) => check.status === 'skipped').map(([id, check]) => detail(id, check));
  const warnings = [
    ...entries.filter(([, check]) => check.status === 'warning').map(([id, check]) => detail(id, check)),
    ...skipped,
  ];
  const blockers = entries.filter(([, check]) => check.status === 'block').map(([id, check]) => detail(id, check));
  const completed = entries.filter(([, check]) => check.status !== 'pending');
  return {
    score: `${passed.length}/${completed.length}`,
    passed,
    warnings,
    skipped,
    blockers,
    checks,
    context,
    generatedAt: new Date().toISOString(),
  };
}

export function assertResumeQuality(report) {
  if (report.blockers.length) throw new Error(`Resume quality gate blocked PDF: ${report.blockers.join('; ')}`);
  return report;
}

export function qualityReportPath(pdfPath) {
  return pdfPath.slice(0, -extname(pdfPath).length) + '.quality.json';
}

export function writeResumeQualityReport(report, path) {
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  return path;
}

export function logResumeQualityReport(report) {
  console.log('Resume Quality Check');
  for (const [id, check] of Object.entries(report.checks)) {
    const mark = check.status === 'pass' ? 'PASS'
      : check.status === 'block' ? 'BLOCK'
      : check.status === 'pending' ? 'PENDING'
      : check.status === 'skipped' ? 'SKIP'
      : 'WARN';
    console.log(`${mark} — ${check.label}${check.details ? ` (${check.details})` : ''}`);
  }
  console.log(`${report.score} checks passed`);
  console.log(JSON.stringify({
    score: report.score,
    passed: report.passed,
    warnings: report.warnings,
    skipped: report.skipped,
    blockers: report.blockers,
  }));
}

function parseArgs(args) {
  const opts = { keywords: [] };
  let htmlPath = '';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--self-test') return { selfTest: true };
    if (arg === '--json') opts.json = true;
    else if (arg === '--write') opts.write = args[++i];
    else if (arg === '--jd') opts.jdPath = args[++i];
    else if (arg === '--pdf') opts.pdfPath = args[++i];
    else if (arg === '--role') opts.role = args[++i];
    else if (arg === '--domain') opts.domain = args[++i];
    else if (arg === '--keywords') opts.keywords = String(args[++i] || '').split(',').map(v => v.trim()).filter(Boolean);
    else if (!htmlPath) htmlPath = arg;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return { htmlPath, ...opts };
}

function selfTest() {
  const jd = 'React, Next.js, TypeScript, REST API, Core Web Vitals and accessibility.';
  const keywords = extractImportantJdKeywords(jd);
  if (!['React', 'Next.js', 'TypeScript', 'REST API', 'Core Web Vitals', 'Accessibility'].every(item => keywords.includes(item))) {
    throw new Error(`keyword extraction failed: ${keywords.join(', ')}`);
  }
  if (!keywordPresent('REST APIs and WCAG accessibility', 'REST API') || !keywordPresent('WCAG accessibility', 'Accessibility')) {
    throw new Error('keyword aliases failed');
  }
  console.log('resume-quality-check self-test: 2 passed, 0 failed');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return selfTest();
  if (!args.htmlPath) throw new Error('Usage: node resume-quality-check.mjs <cv.html> [--jd path] [--pdf path] [--role title] [--domain name] [--json] [--write path]');
  const htmlPath = resolve(args.htmlPath);
  let report = auditResumeHtml(readFileSync(htmlPath, 'utf8'), { ...args, inputPath: htmlPath });
  if (args.pdfPath) {
    const pdf = resolve(args.pdfPath);
    const pages = Number(safeJson(resolve(dirname(htmlPath), 'metadata.json')).pages || 0);
    if (pages > 0) report = auditRenderedPdf(report, pdf, pages);
  }
  if (args.write) writeResumeQualityReport(report, resolve(args.write));
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else logResumeQualityReport(report);
  if (report.blockers.length) process.exitCode = 1;
}

if (isMainModule(import.meta.url)) {
  try { main(); } catch (error) { console.error(`Resume quality check failed: ${error.message}`); process.exitCode = 1; }
}

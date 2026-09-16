import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { canonicalTailoredExperience, loadParsedMasterCv, parseCvMarkdown, buildMasterCvPayload, buildSimpleTailorResult, selectProfessionalDevelopment } from '../server/cvFromMaster.mjs';
import { domainProjectPool, portfolioProjectAdditions, validateDomainConsistency, isReactProject, isMagentoProject } from '../server/cvDomainRouting.mjs';
import { buildTailoringPrompt, emphasizeSummaryKeywords, runAiTailoring } from '../server/aiTailor.ts';
import { aiProviderRegistry } from '../server/ai/providerRegistry.ts';

test('tailoring preserves master chronology and profile locations even with stale provider metadata', () => {
  const original = parseCvMarkdown(readFileSync(new URL('../cv.md', import.meta.url), 'utf8'));
  const profile = load(readFileSync(new URL('../config/profile.yml', import.meta.url), 'utf8'));
  const master = loadParsedMasterCv();
  const modified = master.experience.map(entry => ({ ...entry, role: 'Invented title', dates: '2099', location: 'Invented city', bullets: ['Selected evidence'] })).reverse();
  const result = canonicalTailoredExperience(modified);
  assert.deepEqual(result.map(({ company, role, dates }) => ({ company, role, dates })), original.experience.map(({ company, role, dates }) => ({ company, role, dates })));
  for (const entry of result) assert.equal(entry.location, profile.cv.experience_locations[entry.company]);
  assert.equal(buildMasterCvPayload().candidate.location, profile.candidate.public_location_header);
  assert.throws(() => canonicalTailoredExperience(modified.slice(1)), /every master employer/);
  assert.throws(() => canonicalTailoredExperience(modified.map(() => modified[0])), /Missing or duplicate/);
});

test('six projects pass without weakening primary domain isolation', () => {
  const react = domainProjectPool('REACT_FRONTEND').slice(0, 6);
  assert.equal(validateDomainConsistency({ primaryDomain: 'REACT_FRONTEND', projects: react }).ok, true);
  assert.equal(validateDomainConsistency({ primaryDomain: 'SHOPIFY', projects: react }).ok, false);
  assert.equal(validateDomainConsistency({ primaryDomain: 'REACT_FRONTEND', projects: [...react, react[0]] }).ok, false);
  const additions = portfolioProjectAdditions();
  assert.ok(additions.length > 0);
  for (const project of additions) {
    assert.ok(domainProjectPool(project.domain).some(item => item.name === project.name));
    assert.equal(isReactProject(project.name), project.domain === 'REACT_FRONTEND');
    assert.equal(isMagentoProject(project.name), project.domain === 'MAGENTO_HYVA');
  }
});

test('professional development selects matching source courses without inventing entries', () => {
  const courses = [{ title: 'React architecture', year: '2024' }, { title: 'Unrelated course' }, { title: 'TypeScript', year: '2023' }];
  assert.deepEqual(selectProfessionalDevelopment(courses, 'React TypeScript'), [courses[0], courses[2]]);
});

test('summary emphasis is JD-backed, technical, bounded and wording-preserving', () => {
  const summary = 'Senior Frontend Developer specializing in React, Next.js and TypeScript, with 6+ years building scalable production UIs. Strong in SSR/ISR/SSG, REST API, Core Web Vitals, accessibility and SEO.';
  const emphasized = emphasizeSummaryKeywords(
    summary,
    'Requirements: React, Next.js, TypeScript, REST API and Core Web Vitals.',
    ['TypeScript', 'React', 'Core Web Vitals', '6+ years', 'scalable production UIs', 'Next.js', 'REST API']
  );
  assert.equal(emphasized.replace(/\*\*/g, ''), summary);
  const bold = [...emphasized.matchAll(/\*\*([^*]+)\*\*/g)].map(match => match[1]);
  assert.deepEqual(bold.sort(), ['Core Web Vitals', 'Next.js', 'React', 'TypeScript'].sort());
  assert.ok(bold.length >= 3 && bold.length <= 6);
  const boldWords = bold.join(' ').split(/\s+/).length;
  assert.ok(boldWords / summary.split(/\s+/).length <= 0.25);
  assert.doesNotMatch(emphasized, /\*\*(?:6\+ years|scalable production UIs|Senior Frontend Developer)\*\*/i);
});

test('React Native alone does not qualify React for summary emphasis', () => {
  assert.equal(
    emphasizeSummaryKeywords('Frontend Developer working with React interfaces.', 'React Native and Expo are required.', ['React']),
    'Frontend Developer working with React interfaces.'
  );
});

test('provider-independent tailoring accepts six projects and retains selected provider metadata', async () => {
  const job = { title: 'Senior React Developer', company: 'CV Test', url: '' };
  const jd = 'React, Next.js, TypeScript, REST API and component systems.';
  const result = buildSimpleTailorResult({ ...job, extra: jd });
  result.projects = domainProjectPool('REACT_FRONTEND').slice(0, 6).map(({ name, tech, description }) => ({ name, tech, description }));
  const execute = aiProviderRegistry.execute;
  try {
    aiProviderRegistry.execute = async (request, selection) => {
      assert.match(request.prompt, /45–70 words/);
      assert.match(request.prompt, /employer-specific factual evidence/);
      return { content: JSON.stringify(result), durationMs: 1, model: 'test-model', providerId: selection.providerId, providerName: selection.providerId, fallbackUsed: false };
    };
    for (const providerId of ['codex', 'gemini']) {
      const tailored = await runAiTailoring(job, jd, { providerId });
      assert.equal(tailored.projects.length, 6);
      assert.equal(tailored._providerId, providerId);
      assert.equal(tailored._fallbackUsed, false);
    }
  } finally { aiProviderRegistry.execute = execute; }
  const prompt = buildTailoringPrompt(job, jd);
  for (const entry of loadParsedMasterCv().experience) assert.ok(prompt.includes(`${entry.dates} | ${entry.location} | ${entry.role}`));
});

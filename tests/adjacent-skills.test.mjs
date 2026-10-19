import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canonicalize } from '../skill-extract.mjs';
import { verifyFacts } from '../verify-cv-facts.mjs';
import { buildSimpleTailorResult } from '../server/cvFromMaster.mjs';
import { buildTailoringPrompt } from '../server/aiTailor.ts';
import {
  classifyAdjacentSkill,
  planAdjacentSkills,
  selectAdjacentSkills,
  validateAdjacentSkills
} from '../server/adjacentSkills.mjs';

const cvText = fs.readFileSync(new URL('../cv.md', import.meta.url), 'utf8');

test('adjacent config classifies tooling, stack, foreign and unknown fail-closed', () => {
  assert.equal(classifyAdjacentSkill('Nx'), 'tooling');
  assert.equal(classifyAdjacentSkill('PostgreSQL'), 'stack');
  assert.equal(classifyAdjacentSkill('Rust'), 'foreign');
  assert.equal(classifyAdjacentSkill('MysteryDB'), 'foreign');
  assert.equal(canonicalize('NX'), 'Nx');
  assert.equal(canonicalize('nx'), 'Nx');
  assert.equal(canonicalize('Nx'), 'Nx');
});

test('thresholds and caps are deterministic', () => {
  const gaps = [
    ...['Nx', 'Vite', 'Jest', 'Storybook', 'Cypress'].map(skill => ({ skill, bucket: 'tooling' })),
    ...['Vue', 'Svelte'].map(skill => ({ skill, bucket: 'stack' }))
  ];
  assert.deepEqual(selectAdjacentSkills(0.69, gaps, 'normal').addTooling, []);
  assert.deepEqual(selectAdjacentSkills(0.70, gaps, 'normal').addTooling, ['Nx', 'Vite', 'Jest', 'Storybook']);
  assert.deepEqual(selectAdjacentSkills(0.79, gaps, 'normal').addStack, []);
  assert.deepEqual(selectAdjacentSkills(0.80, gaps, 'normal').addStack, ['Vue']);
  assert.deepEqual(selectAdjacentSkills(1, gaps, 'conservative').addTooling, ['Nx', 'Vite']);
});

test('foreign skills are never selected even at a perfect match', () => {
  const selected = selectAdjacentSkills(1, [{ skill: 'Rust', bucket: 'foreign' }], 'normal');
  assert.deepEqual(selected.addTooling, []);
  assert.deepEqual(selected.addStack, []);
});

test('requirement-section skills count twice nice-to-have skills', () => {
  const plan = planAdjacentSkills('Requirements\n- React\n\nNice-to-have\n- Nx', cvText, 'normal');
  assert.equal(plan.score, 2 / 3);
  assert.deepEqual(plan.addTooling, []);
});

test('prompt exposes only the planned adjacent list and off keeps strict prompt shape', () => {
  const job = { title: 'Senior React Developer', company: 'Acme', url: '' };
  const jd = 'Senior React Developer with Nx and AI';
  const prompt = buildTailoringPrompt(job, jd, 'normal');
  const section = prompt.split('ALLOWED ADJACENT SKILLS FOR THIS VACANCY')[1].split('TECHNICAL SKILLS RULES & LIMITS')[0];
  assert.match(section, /Nx \(tooling\)/);
  assert.doesNotMatch(section, /Turborepo|Vue|Rust/);
  const off = buildTailoringPrompt(job, jd, 'off');
  assert.doesNotMatch(off, /ALLOWED ADJACENT SKILLS FOR THIS VACANCY/);
  assert.match(off, /Never invent technologies, backend databases/);
  assert.match(off, /Do NOT introduce unlisted tool names into experience bullets that are absent from cv\.md\./);
});

test('Node vacancy does not instruct providers to claim unplanned Node.js', () => {
  const prompt = buildTailoringPrompt(
    { title: 'AI Engineer – Agentic Workflows (Node.js/React)', company: 'Acme', url: '' },
    'Build agentic workflows with Node.js, React, LLMs and MLOps',
    'normal'
  );
  assert.match(prompt, /ALLOWED ADJACENT SKILLS[\s\S]*?- none/);
  assert.match(prompt, /omit it from every output field, including headline, summary, skills, experience, and projects/);
  assert.doesNotMatch(prompt, /Fullstack & API: TypeScript, Node\.js fundamentals/);
});

test('Node vacancy fallback remains valid when Node.js is not planned', () => {
  const jd = 'Build agentic workflows with Node.js, React, LLMs and MLOps';
  const plan = planAdjacentSkills(jd, cvText, 'normal');
  const fallback = buildSimpleTailorResult({ title: 'AI Engineer – Agentic Workflows (Node.js/React)', company: 'Acme', url: '', extra: jd });
  assert.equal(plan.addStack.includes('Node.js'), false);
  assert.doesNotMatch(JSON.stringify(fallback), /Node\.js/i);
  assert.equal(validateAdjacentSkills(fallback, cvText, plan), true);
});

test('fact gate accepts a per-run planned skill and still blocks an unplanned one', () => {
  const configPath = new URL('../config/cv-facts.json', import.meta.url).pathname;
  const planned = verifyFacts('Built with Nx.', { sourcePaths: [], configPath, allowFacts: ['Nx'] });
  const unplanned = verifyFacts('Built with Turborepo.', { sourcePaths: [], configPath, allowFacts: ['Nx'] });
  assert.equal(planned.verdict, 'pass');
  assert.equal(unplanned.verdict, 'block');
});

test('golden React plus Nx case adds Nx only to Technical Skills and interview prep', () => {
  const jd = 'Senior React Developer with NX and AI';
  const plan = planAdjacentSkills(jd, cvText, 'normal');
  assert.equal(plan.score, 0.8);
  assert.deepEqual(plan.addTooling, ['Nx']);
  const result = buildSimpleTailorResult({ title: 'Senior React Developer', company: 'Acme', url: '', extra: jd });
  result.skills.push({ category: 'Tooling', items: 'Nx' });
  result.tailoring_diff.adjacent_skills_added = [{ skill: 'Nx', bucket: 'tooling', placement: 'Technical Skills — Tooling' }];
  result.tailoring_diff.interview_prep = [{ skill: 'Nx', studyHint: plan.prep[0].studyHint }];
  assert.equal(validateAdjacentSkills(result, cvText, plan), true);
  assert.ok(result.skills.some(group => group.category === 'Tooling' && group.items === 'Nx'));
  assert.ok(result.tailoring_diff.interview_prep.some(item => item.skill === 'Nx'));
  assert.ok(result.experience.every(entry => entry.bullets.every(bullet => !/\bNx\b/i.test(bullet))));
});

test('deterministic placement check rejects unplanned and misplaced adjacent skills', () => {
  const plan = { addTooling: ['Nx'], addStack: [], prep: [] };
  const base = structuredClone(buildSimpleTailorResult({ title: 'Senior React Developer', company: 'Acme', url: '' }));
  base.skills.push({ category: 'Tooling', items: 'Turborepo' });
  assert.throws(() => validateAdjacentSkills(base, cvText, plan), /unplanned skills: Turborepo/);
  const misplaced = structuredClone(buildSimpleTailorResult({ title: 'Senior React Developer', company: 'Acme', url: '' }));
  misplaced.summary += ' Familiar with Nx.';
  assert.throws(() => validateAdjacentSkills(misplaced, cvText, plan), /summary\/projects/);
});

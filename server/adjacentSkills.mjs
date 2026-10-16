#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractJdSkills, extractJdSkillsWeighted, classifySkillGaps } from '../jd-skill-gap.mjs';
import { canonicalize, extractSkills } from '../skill-extract.mjs';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VALID_MODES = new Set(['off', 'conservative', 'normal']);

function configPath() {
  const userPath = path.join(getCareerOpsRoot(), 'config', 'adjacent-skills.json');
  return fs.existsSync(userPath) ? userPath : path.join(CODE_ROOT, 'config', 'adjacent-skills.example.json');
}

function loadConfig() {
  const parsed = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  for (const bucket of ['tooling', 'stack', 'foreign']) {
    if (!Array.isArray(parsed[bucket]) || parsed[bucket].some(value => typeof value !== 'string' || !value.trim())) {
      throw new Error(`adjacent-skills.json ${bucket} must be an array of non-empty strings`);
    }
  }
  return parsed;
}

export function resolveAdjacentMode(mode = process.env.CAREER_OPS_ADJACENT || 'normal') {
  const value = String(mode || 'normal').toLowerCase();
  if (!VALID_MODES.has(value)) throw new Error(`Invalid adjacent skills mode "${mode}"; use off, conservative, or normal`);
  return value;
}

function aliasesFor(name) {
  const aliases = new Set([name]);
  const base = name.replace(/\s+(?:basics|API work|backend|ops|engineering|context|claims|titles)$/i, '');
  aliases.add(base);
  if (/API work|backend frameworks|native iOS/i.test(name)) {
    for (const part of base.split('/')) aliases.add(part.trim());
  }
  if (name === 'C#/.NET') { aliases.add('C#'); aliases.add('.NET'); }
  if (name === 'Python backend') aliases.add('Python');
  if (name === 'Kubernetes ops') aliases.add('Kubernetes');
  if (name === 'ML engineering') { aliases.add('ML'); aliases.add('Machine Learning'); }
  return [...aliases].filter(Boolean);
}

function registry(config) {
  const aliases = [];
  for (const bucket of ['tooling', 'stack', 'foreign']) {
    for (const configured of config[bucket]) {
      for (const alias of aliasesFor(configured)) aliases.push({ alias, configured, bucket });
    }
  }
  aliases.sort((a, b) => b.alias.length - a.alias.length);
  return aliases;
}

function canonicalDisplay(raw, entries) {
  const shared = canonicalize(raw);
  const found = entries.find(entry => canonicalize(entry.alias).toLowerCase() === shared.toLowerCase() || entry.alias.toLowerCase() === raw.toLowerCase());
  if (!found) return shared;
  if (/\s+(?:basics|API work)$/i.test(found.configured) || found.configured.includes('/')) return shared;
  return canonicalize(found.configured);
}

function fallbackCandidates(jdText, aliases) {
  const found = [];
  for (const entry of aliases) {
    const escaped = entry.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const match = jdText.match(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu'));
    if (match) found.push({ skill: match[0], weight: 2 });
  }
  for (const skill of extractSkills(jdText)) found.push({ skill, weight: 2 });
  for (const match of jdText.matchAll(/(?<![\p{L}\p{N}])(?:[A-Z]{2,}|Senior|Developer|Engineer)(?![\p{L}\p{N}])/gu)) {
    found.push({ skill: match[0], weight: 2 });
  }
  return found;
}

function uniqueWeighted(items, entries) {
  const byCanonical = new Map();
  for (const item of items) {
    const display = canonicalDisplay(item.skill, entries);
    const key = display.toLowerCase();
    const previous = byCanonical.get(key);
    if (!previous || item.weight > previous.weight) byCanonical.set(key, { skill: display, weight: item.weight });
  }
  return [...byCanonical.values()];
}

function bucketFor(skill, entries) {
  const shared = canonicalize(skill).toLowerCase();
  return entries.find(entry => canonicalize(entry.alias).toLowerCase() === shared || entry.alias.toLowerCase() === skill.toLowerCase())?.bucket || 'foreign';
}

export function classifyAdjacentSkill(skill) {
  return bucketFor(canonicalize(skill), registry(loadConfig()));
}

function studyHint(skill) {
  return `Review the official ${skill} documentation and practise one small role-relevant example before interview use.`;
}

export function selectAdjacentSkills(score, gaps, mode = 'normal') {
  mode = resolveAdjacentMode(mode);
  if (mode === 'off') return { addTooling: [], addStack: [], skippedOverCap: gaps.map(item => item.skill) };
  const toolingCap = mode === 'conservative' ? 2 : 4;
  const toolingThreshold = mode === 'conservative' ? 0.75 : 0.70;
  const tooling = gaps.filter(item => item.bucket === 'tooling');
  const stack = gaps.filter(item => item.bucket === 'stack');
  const addTooling = score >= toolingThreshold ? tooling.slice(0, toolingCap).map(item => item.skill) : [];
  const addStack = mode === 'normal' && score >= 0.80 ? stack.slice(0, 1).map(item => item.skill) : [];
  const selected = new Set([...addTooling, ...addStack].map(value => value.toLowerCase()));
  return { addTooling, addStack, skippedOverCap: [...tooling, ...stack].filter(item => !selected.has(item.skill.toLowerCase())).map(item => item.skill) };
}

export function planAdjacentSkills(jdText, cvText, mode = process.env.CAREER_OPS_ADJACENT || 'normal') {
  mode = resolveAdjacentMode(mode);
  if (mode === 'off') return { score: 0, addTooling: [], addStack: [], skippedForeign: [], skippedOverCap: [], prep: [] };
  const config = loadConfig();
  const entries = registry(config);
  const base = extractJdSkills(jdText);
  const weighted = extractJdSkillsWeighted(jdText, entries.map(entry => entry.alias));
  const weightedKeys = new Set(weighted.map(item => canonicalDisplay(item.skill, entries).toLowerCase()));
  const candidates = uniqueWeighted(weighted.length
    ? [...weighted, ...base.filter(skill => !weightedKeys.has(canonicalDisplay(skill, entries).toLowerCase())).map(skill => ({ skill, weight: 2 }))]
    : fallbackCandidates(jdText, entries), entries);
  const classified = classifySkillGaps(candidates.map(item => item.skill), cvText);
  const matched = new Set([...classified.existing, ...classified.supportedByResume].map(value => canonicalize(value).toLowerCase()));
  const gapSet = new Set(classified.gap.map(value => canonicalize(value).toLowerCase()));
  const totalWeight = candidates.reduce((sum, item) => sum + item.weight, 0);
  const matchedWeight = candidates.reduce((sum, item) => sum + (matched.has(canonicalize(item.skill).toLowerCase()) ? item.weight : 0), 0);
  const score = totalWeight ? matchedWeight / totalWeight : 0;
  const gaps = candidates.filter(item => gapSet.has(canonicalize(item.skill).toLowerCase())).map((item, order) => ({ ...item, order, bucket: bucketFor(item.skill, entries) }))
    .sort((a, b) => b.weight - a.weight || a.order - b.order);
  const skippedForeign = gaps.filter(item => item.bucket === 'foreign').map(item => item.skill);
  const selected = selectAdjacentSkills(score, gaps, mode);
  const prep = [...selected.addTooling, ...selected.addStack].map(skill => ({
    skill,
    why: selected.addTooling.includes(skill) ? 'Low-risk adjacent tooling named by this JD.' : 'Substantial adjacent stack item allowed only at very high match.',
    studyHint: studyHint(skill)
  }));
  return { score, ...selected, skippedForeign, prep };
}

export function adjacentPromptSection(plan) {
  const allowed = [...plan.addTooling.map(skill => `${skill} (tooling)`), ...plan.addStack.map(skill => `${skill} (stack)`)];
  return `\n==================================================\nALLOWED ADJACENT SKILLS FOR THIS VACANCY\n==================================================\n${allowed.length ? allowed.map(skill => `- ${skill}`).join('\n') : '- none'}\n- ONLY the skills above are exceptions to the source-backed technology rules.\n- Tooling may appear in Technical Skills inside an existing group or a \"Tooling\" group.\n- Stack items may appear ONLY on a separate \"Familiar with\" Technical Skills line.\n- Planned skills MUST NOT appear in the summary, project names/descriptions/tech stacks, or with years or metrics.\n- At most ONE existing experience bullet may be rephrased to mention ONE planned tooling skill, and only when the source bullet is genuinely about the same area. Never create a new bullet.\n- Report actual use in tailoring_diff.adjacent_skills_added and preparation in tailoring_diff.interview_prep.\n`;
}

function mentions(text, skill) {
  const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text || '');
}

export function validateAdjacentSkills(result, cvText, plan) {
  const plannedTooling = plan.addTooling || [];
  const plannedStack = plan.addStack || [];
  const planned = [...plannedTooling, ...plannedStack];
  const entries = registry(loadConfig());
  const cvCatalogSkills = entries.filter(entry => mentions(cvText, entry.alias)).map(entry => canonicalDisplay(entry.alias, entries));
  const allowed = new Set([...extractSkills(cvText), ...cvCatalogSkills, ...planned.map(canonicalize)].map(value => value.toLowerCase()));
  const cvFields = JSON.stringify({
    headline: result.headline,
    summary: result.summary,
    skills: result.skills,
    experience: result.experience,
    projects: result.projects
  });
  const outputSkills = extractSkills(cvFields);
  for (const entry of entries) {
    if (mentions(cvFields, entry.alias)) outputSkills.add(canonicalDisplay(entry.alias, entries));
  }
  const unplanned = [...outputSkills].filter(skill => !allowed.has(skill.toLowerCase()));
  if (unplanned.length) throw new Error(`Adjacent skill validation failed: unplanned skills: ${unplanned.join(', ')}`);

  const forbiddenText = [result.headline, result.summary, ...(result.projects || []).flatMap(project => [project.name, project.tech, project.description])].join('\n');
  const forbidden = planned.filter(skill => mentions(forbiddenText, skill));
  if (forbidden.length) throw new Error(`Adjacent skill validation failed: planned skills in summary/projects: ${forbidden.join(', ')}`);

  const experienceBullets = (result.experience || []).flatMap(entry => entry.bullets || []);
  const adjacentExperience = experienceBullets.filter(bullet => planned.some(skill => mentions(bullet, skill)));
  if (adjacentExperience.length > 1 || adjacentExperience.some(bullet => plannedStack.some(skill => mentions(bullet, skill)))) {
    throw new Error('Adjacent skill validation failed: only one experience bullet may mention planned tooling; stack skills are skills-only');
  }
  for (const skill of plannedStack) {
    const categories = (result.skills || []).filter(group => mentions(group.items, skill)).map(group => group.category);
    if (categories.some(category => !/^familiar with$/i.test(category.trim()))) throw new Error(`Adjacent skill validation failed: ${skill} must be under Familiar with`);
  }
  const diffAdded = result.tailoring_diff?.adjacent_skills_added || [];
  for (const item of diffAdded) {
    if (!planned.some(skill => skill.toLowerCase() === String(item.skill).toLowerCase())) throw new Error(`Adjacent skill validation failed: diff reports unplanned skill ${item.skill}`);
  }
  const actualAdded = planned.filter(skill => mentions(JSON.stringify(result.skills || []), skill) || adjacentExperience.some(bullet => mentions(bullet, skill)));
  if (actualAdded.some(skill => !diffAdded.some(item => String(item.skill).toLowerCase() === skill.toLowerCase()))) {
    throw new Error('Adjacent skill validation failed: tailoring diff must report every planned skill actually added');
  }
  if (diffAdded.some(item => !actualAdded.some(skill => skill.toLowerCase() === String(item.skill).toLowerCase()))) {
    throw new Error('Adjacent skill validation failed: tailoring diff reports an adjacent skill not present in the CV');
  }
  const interviewPrep = result.tailoring_diff?.interview_prep || [];
  if (interviewPrep.some(item => !planned.some(skill => skill.toLowerCase() === String(item.skill).toLowerCase()))) {
    throw new Error('Adjacent skill validation failed: interview prep contains an unplanned skill');
  }
  if (actualAdded.some(skill => !interviewPrep.some(item => String(item.skill).toLowerCase() === skill.toLowerCase() && String(item.studyHint || '').trim()))) {
    throw new Error('Adjacent skill validation failed: interview prep must cover every adjacent skill actually added');
  }
  return true;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const jdPath = args.find(arg => !arg.startsWith('--'));
  const modeArg = args.find(arg => arg.startsWith('--mode='))?.slice(7) || process.env.CAREER_OPS_ADJACENT || 'normal';
  if (!jdPath) {
    console.error('Usage: node server/adjacentSkills.mjs <jd-file> [--mode=off|conservative|normal]');
    process.exitCode = 1;
  } else {
    const cvText = fs.readFileSync(path.join(getCareerOpsRoot(), 'cv.md'), 'utf8');
    console.log(JSON.stringify(planAdjacentSkills(fs.readFileSync(jdPath, 'utf8'), cvText, modeArg), null, 2));
  }
}

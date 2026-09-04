import test from "node:test";
import assert from "node:assert/strict";
import { analyzeJobMatch } from "../server/jobMatch.mjs";

const run = (title, description) => analyzeJobMatch({ title, company: "Test" }, description);
const edgeJd = `
Core mandatory requirements:
- React
- TypeScript
- Next.js
- frontend unit/integration testing
- WCAG and WAI-ARIA
- Core Web Vitals
- high-traffic e-commerce
- Design Systems / component libraries
- REST API integration
- Chrome DevTools
- AI-assisted software development
- minimum 7 years commercial React + TypeScript experience
Nice-to-have:
- SEO / SEA
- Playwright
- BASIC backend technology knowledge, e.g. PHP / Go
- CI/CD
- Docker
- UX/UI
- Figma
Responsibilities:
- design, develop and maintain frontend applications with React, TypeScript and Next.js
- build modular scalable frontend solutions and optimize Core Web Vitals
- collaborate with backend teams using PHP/Symfony and Go
- frontend testing, REST API integration, code review and frontend code quality
`;

test("Edge One frontend regression is strong/best and collaboration is not ownership", () => {
  const result = run("Senior Frontend Developer (React + Typescript + Next.js)", edgeJd);
  assert.match(result.matchClassification, /^(BEST|STRONG) MATCH$/);
  assert.ok(result.compatibilityPercent >= 82);
  assert.equal(result.recommendation, "APPLY");
  assert.equal(result.responsibilitySplit.frontend, "dominant");
  assert.equal(result.signals.backendMandatoryDevelopmentCount, 0);
  assert.equal(result.backendOwnershipSignals.length, 0);
  assert.ok(result.backendCollaborationSignals.some((s) => /backend teams/i.test(s)));
  assert.ok(result.optionalSkills.includes("PHP"));
  assert.ok(result.optionalSkills.includes("Go"));
  assert.ok(result.mandatorySkills.includes("React"));
  assert.ok(result.mandatorySkills.includes("Next.js"));
  assert.ok(result.mandatorySkills.includes("TypeScript"));
});

test("backend ownership matrix and frontend collaboration cases", () => {
  assert.equal(run("Senior Fullstack Java + React", "Develop Spring services and React UI.").matchClassification, "LOW MATCH");
  assert.match(run("Frontend React Developer", "React required. Java is nice-to-have.").matchClassification, /^(BEST|STRONG) MATCH$/);
  assert.match(run("Frontend React + Node", "Frontend-heavy React and Next.js; maintain a small Node.js API layer.").matchClassification, /^(BEST|STRONG) MATCH$/);
  assert.match(run("Node.js Engineer", "Build Node.js services; some React UI.").matchClassification, /^(LOW|POSSIBLE) MATCH$/);
  assert.equal(run("React Native Developer", "Build React Native apps for iOS and Android.").matchClassification, "SKIP");
  assert.match(run("Senior Frontend Developer", "React, Next.js and TypeScript. Collaborate with the Python backend team.").matchClassification, /^(BEST|STRONG) MATCH$/);
});

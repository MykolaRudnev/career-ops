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
  assert.match(run("Frontend React Developer", "React and TypeScript required. Build accessible frontend components and design systems. Java is nice-to-have.").matchClassification, /^(BEST|STRONG) MATCH$/);
  assert.match(run("Frontend React + Node", "Frontend-heavy React and Next.js; build frontend applications; maintain a small Node.js API layer.").matchClassification, /^(BEST|STRONG) MATCH$/);
  assert.match(run("Node.js Engineer", "Build Node.js services; some React UI.").matchClassification, /^(LOW|POSSIBLE) MATCH$/);
  assert.equal(run("React Native Developer", "Build React Native apps for iOS and Android.").matchClassification, "SKIP");
  assert.match(run("Senior Frontend Developer", "React, Next.js and TypeScript. Build frontend applications. Collaborate with the Python backend team.").matchClassification, /^(BEST|STRONG) MATCH$/);
});

test("Cerebre Senior Web Application Engineer - React regression case", () => {
  const cerebreJd = `
Senior Web Application Engineer - React
cerebre

Required:
React, TypeScript, JavaScript, complex web applications, frontend integrations, product work

Preferred only:
full stack/backend development, .NET/C#, backend concepts
`;

  const result = run("Senior Web Application Engineer - React", cerebreJd);
  assert.equal(result.matchClassification, "STRONG MATCH");
  assert.ok(result.compatibilityPercent >= 78 && result.compatibilityPercent <= 88, `Expected ~78-88%, got ${result.compatibilityPercent}%`);
  assert.ok(result.fitScore >= 4.0 && result.fitScore <= 4.4, `Expected approximately 4.0-4.4 / 5, got ${result.fitScore}`);
  assert.equal(result.recommendation, "APPLY");
  assert.equal(result.frontendDominance, true);
  assert.equal(result.signals.backendMandatoryDevelopmentCount, 0);
  assert.notEqual(result.matchClassification, "BEST MATCH", "Should not be promoted to BEST MATCH automatically");
  assert.ok(result.gaps.some(g => /\.NET\/C#/i.test(g)), "Surfaces preferred backend in gaps");
});

test("Web application title patterns with confirmed React/web UI are frontend-dominant and score STRONG MATCH", () => {
  const jd = `
Required:
React, TypeScript, JavaScript, complex web applications, frontend integrations, product work

Preferred only:
full stack/backend development, .NET/C#, backend concepts
`;

  const titles = [
    "Web Application Engineer",
    "Senior Web Application Engineer",
    "Web Engineer",
    "Senior Web Engineer",
    "UI Engineer",
    "Application Engineer - React",
    "Product Engineer - React",
    "Web Software Engineer",
    "Frontend Application Engineer"
  ];

  for (const title of titles) {
    const res = run(title, jd);
    assert.equal(res.matchClassification, "STRONG MATCH", `${title} should be STRONG MATCH`);
    assert.ok(res.compatibilityPercent >= 78 && res.compatibilityPercent <= 88, `${title} should be ~78-88%, got ${res.compatibilityPercent}`);
    assert.ok(res.fitScore >= 4.0 && res.fitScore <= 4.4, `${title} should be ~4.0-4.4 / 5, got ${res.fitScore}`);
    assert.equal(res.recommendation, "APPLY", `${title} should recommend APPLY`);
    assert.equal(res.frontendDominance, true, `${title} should be frontend-dominant`);
  }
});

test("Web application titles are NOT classified as frontend by title alone without JD evidence", () => {
  const backendJd = `
Required:
- 5+ years building distributed backend systems
- Python, Django, PostgreSQL
- REST APIs, microservices, AWS

Preferred:
- Docker, Kubernetes
`;

  const res = run("Senior Web Application Engineer", backendJd);
  assert.equal(res.frontendDominance, false);
  assert.equal(res.matchClassification, "LOW MATCH");
  assert.equal(res.recommendation, "SKIP");
});

test("pure Frontend / React / Next.js roles outrank frontend-adjacent Web Application roles when match is stronger", () => {
  const pureFrontendJd = `
Required:
- React, Next.js, TypeScript, modern frontend architecture
- Component libraries and design systems
- Performance optimization and Core Web Vitals
- Testing with Jest and Playwright
`;

  const webAppJd = `
Required:
React, TypeScript, JavaScript, complex web applications, frontend integrations, product work

Preferred only:
full stack/backend development, .NET/C#, backend concepts
`;

  const pure = run("Senior Frontend Developer", pureFrontendJd);
  const webApp = run("Senior Web Application Engineer - React", webAppJd);

  assert.equal(pure.matchClassification, "BEST MATCH");
  assert.equal(webApp.matchClassification, "STRONG MATCH");
  assert.ok(pure.compatibilityPercent > webApp.compatibilityPercent, `Pure frontend (${pure.compatibilityPercent}%) should outrank web app (${webApp.compatibilityPercent}%)`);
});

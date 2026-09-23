import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyDomain,
  validateDomainConsistency,
  selectProjectsForDomain,
  enforceDomainConsistency,
  domainConsistencyValidation,
  selectKnowledgeFiles,
  buildDomainDryRun,
  isShopifyProject,
  isReactOnlyProject,
  isMagentoProject,
  DomainValidationError
} from "../server/cvDomainRouting.mjs";
import { countPdfPagesFromBuffer, parseLoggedPdfPageCount } from "../server/pdfPageCount.mjs";

test("classifies Shopify / React / Magento titles as the expected primary domain", () => {
  assert.equal(classifyDomain("Shopify Developer", "Theme work in Liquid").primary, "SHOPIFY");
  assert.equal(classifyDomain("Senior React Developer", "Next.js and TypeScript").primary, "REACT_FRONTEND");
  assert.equal(classifyDomain("Magento 2 / Hyvä Frontend Developer", "Hyvä CMS, PLP, PDP").primary, "MAGENTO_HYVA");
});

test("Shopify Frontend vacancy is PRIMARY SHOPIFY and does not treat frontend as React", () => {
  const jd = "We need a frontend developer for Shopify themes, Liquid sections, JSON templates, and storefront UX.";
  const result = classifyDomain("Shopify Frontend Developer", jd);
  assert.equal(result.primary, "SHOPIFY");
  assert.equal(result.secondary.includes("REACT_FRONTEND"), false);
  assert.equal(result.secondary.includes("GENERAL_FRONTEND"), false);
  const files = selectKnowledgeFiles(result.primary, result.secondary, `Shopify Frontend Developer\n${jd}`);
  assert.equal(files[0].path, "knowledge/shopify.md");
  assert.equal(files.some((f) => f.path === "knowledge/react-frontend.md"), false);
});

test("Shopify title wins even when the JD also mentions React, and React knowledge is secondary only", () => {
  const jd = "We use Shopify Plus. React experience is a plus for a small internal tool.";
  const result = classifyDomain("Shopify Developer", jd);
  assert.equal(result.primary, "SHOPIFY");
  assert.ok(result.secondary.includes("REACT_FRONTEND"));
  const files = selectKnowledgeFiles(result.primary, result.secondary, `Shopify Developer\n${jd}`);
  assert.equal(files[0].domain, "SHOPIFY");
  assert.equal(files[0].path, "knowledge/shopify.md");
  assert.equal(files[1]?.path, "knowledge/react-frontend.md");
});

test("frontend-heavy React + Node classifies as fullstack TypeScript with React secondary", () => {
  const result = classifyDomain(
    "Fullstack Engineer (React + Node)",
    "Frontend-heavy fullstack TypeScript. Node.js fundamentals for APIs. Primarily frontend."
  );
  assert.equal(result.primary, "FULLSTACK_TYPESCRIPT_NODE");
  assert.ok(result.secondary.includes("REACT_FRONTEND"));
});

test("75% whitelist rule fails when Shopify CV is mostly React-only projects", () => {
  const validation = validateDomainConsistency({
    primaryDomain: "SHOPIFY",
    projects: [
      { name: "ponadczasowi.pl" },
      { name: "copernicspace.com" },
      { name: "pmicareers.pl" },
      { name: "Glasy.pl" }
    ]
  });
  assert.equal(validation.ok, false);
  assert.ok(validation.reasons.some((r) => /React-only|75%|no Shopify/i.test(r)));
  assert.ok(validation.counts.reactOnlyCount > validation.counts.shopifyCount);
});

test("Shopify CV with no Shopify project fails", () => {
  const validation = validateDomainConsistency({
    primaryDomain: "SHOPIFY",
    projects: [
      { name: "ponadczasowi.pl" },
      { name: "copernicspace.com" },
      { name: "hrk.pl" }
    ]
  });
  assert.equal(validation.ok, false);
  assert.ok(validation.reasons.some((r) => /no Shopify-specific project/i.test(r)));
});

test("default offer tracks use the pinned four projects in order", () => {
  const offers = [
    {
      title: "Senior Magento 2 / Hyvä Frontend Developer",
      jd: "Hyvä Theme, Hyvä Checkout, PLP, PDP, and checkout on Magento Open Source.",
      expect: ["HUBER SE", "3MK Protection", "British American Tobacco", "solar.com.pl"]
    },
    {
      title: "Senior React / Next.js Developer",
      jd: "React, Next.js, TypeScript, component systems, and product UI.",
      expect: ["copernicspace.com", "ponadczasowi.pl", "hrk.pl", "carneoo.de"]
    },
    {
      title: "Shopify Developer",
      jd: "Custom Shopify themes, Liquid sections, and Online Store 2.0.",
      expect: ["Glasy.pl", "Pixel25", "Warmsome", "Berg's"]
    }
  ];
  for (const offer of offers) {
    const selected = selectProjectsForDomain(classifyDomain(offer.title, offer.jd).primary, offer);
    assert.deepEqual(selected.projects.map((project) => project.name), offer.expect, offer.title);
    assert.equal(validateDomainConsistency({
      primaryDomain: classifyDomain(offer.title, offer.jd).primary,
      projects: selected.projects,
      jdText: `${offer.title}\n${offer.jd}`
    }).ok, true, offer.title);
  }
});

test("correct Shopify / Magento / React pools pass domain validation", () => {
  const shopify = selectProjectsForDomain("SHOPIFY", { title: "Shopify Developer", company: "Attomy" });
  const react = selectProjectsForDomain("REACT_FRONTEND", { title: "Senior React Developer", company: "Acme" });
  const magento = selectProjectsForDomain("MAGENTO_HYVA", { title: "Magento 2 / Hyvä Frontend Developer", company: "Snowdog" });

  assert.equal(validateDomainConsistency({ primaryDomain: "SHOPIFY", projects: shopify.projects }).ok, true);
  assert.equal(validateDomainConsistency({ primaryDomain: "REACT_FRONTEND", projects: react.projects }).ok, true);
  assert.equal(validateDomainConsistency({ primaryDomain: "MAGENTO_HYVA", projects: magento.projects }).ok, true);

  assert.ok(shopify.projects.filter((p) => isShopifyProject(p.name)).length >= 3);
  assert.equal(shopify.projects.filter((p) => isReactOnlyProject(p.name)).length, 0);
  assert.ok(react.projects.every((p) => !isShopifyProject(p.name) && !isMagentoProject(p.name)));
  assert.ok(magento.projects.filter((p) => isMagentoProject(p.name)).length >= 3);
});

test("Magento CV with React-only majority fails; React CV with Shopify majority fails", () => {
  assert.equal(
    validateDomainConsistency({
      primaryDomain: "MAGENTO_HYVA",
      projects: [{ name: "copernicspace.com" }, { name: "hrk.pl" }, { name: "pmicareers.pl" }, { name: "HUBER SE" }]
    }).ok,
    false
  );
  assert.equal(
    validateDomainConsistency({
      primaryDomain: "REACT_FRONTEND",
      projects: [{ name: "Glasy.pl" }, { name: "Ascent" }, { name: "Warmsome" }, { name: "ponadczasowi.pl" }]
    }).ok,
    false
  );
});

test("domainConsistencyValidation fails generation when a Shopify CV selects mostly React projects", () => {
  assert.throws(
    () => domainConsistencyValidation(
      {
        projects: [
          { name: "ponadczasowi.pl" },
          { name: "copernicspace.com" },
          { name: "pmicareers.pl" },
          { name: "Glasy.pl" }
        ]
      },
      { title: "Shopify Developer", company: "Attomy" },
      "Looking for a Shopify Developer with Liquid theme experience."
    ),
    (err) => err instanceof DomainValidationError && /DOMAIN CONSISTENCY FAILED/.test(err.message)
  );
});

test("enforceDomainConsistency does not silently rewrite a wrong Shopify project list", () => {
  assert.throws(
    () => enforceDomainConsistency(
      {
        primary_domain: "SHOPIFY",
        headline: "Senior Frontend Developer",
        summary: "Senior Frontend Developer specializing in React, Next.js and TypeScript.",
        skills: [{ category: "Frontend", items: "React, Next.js, TypeScript" }],
        projects: [
          { name: "ponadczasowi.pl", tech: "Next.js", description: "ecom" },
          { name: "copernicspace.com", tech: "React", description: "nft" },
          { name: "pmicareers.pl", tech: "Next.js", description: "careers" }
        ],
        tailoring_diff: {
          summary_focus: "React",
          skills_promoted: ["React"],
          projects_selected: [],
          jd_keywords_matched: [],
          experience_emphasis: "React"
        }
      },
      { title: "Shopify Developer", company: "Attomy" },
      "Looking for a Shopify Developer with Liquid theme experience."
    ),
    (err) => err instanceof DomainValidationError && /PRIMARY=SHOPIFY/.test(err.message)
  );
});

const VACANCY_FIXTURES = [
  {
    name: "Shopify vacancy",
    title: "Shopify Frontend Developer",
    jd: "Shopify theme development, Liquid sections and blocks, JSON templates, storefront frontend work.",
    expect: "SHOPIFY",
    primaryFile: "knowledge/shopify.md",
    forbiddenFile: "knowledge/react-frontend.md"
  },
  {
    name: "Magento/Hyvä vacancy",
    title: "Magento 2 / Hyvä Frontend Developer",
    jd: "Hyvä CMS, Alpine.js, PHTML, XML layout, PLP, PDP, Magento 2 storefront.",
    expect: "MAGENTO_HYVA",
    primaryFile: "knowledge/magento-hyva.md",
    forbiddenFile: "knowledge/shopify.md"
  },
  {
    name: "React/Next vacancy",
    title: "Senior React / Next.js Frontend Developer",
    jd: "React, Next.js, TypeScript, component systems, SSR, product UI.",
    expect: "REACT_FRONTEND",
    primaryFile: "knowledge/react-frontend.md",
    forbiddenFile: "knowledge/shopify.md"
  },
  {
    name: "React + Node frontend-heavy vacancy",
    title: "Fullstack Engineer (React + Node)",
    jd: "Frontend-heavy fullstack TypeScript. React and Next.js UI plus Node.js fundamentals for APIs. Primarily frontend.",
    expect: "FULLSTACK_TYPESCRIPT_NODE",
    primaryFile: "knowledge/react-frontend.md",
    forbiddenFile: "knowledge/shopify.md"
  }
];

test("regression: four vacancy types classify, load PRIMARY knowledge, and keep a dominant project pool", () => {
  for (const vacancy of VACANCY_FIXTURES) {
    const classified = classifyDomain(vacancy.title, vacancy.jd);
    assert.equal(classified.primary, vacancy.expect, vacancy.name);
    const files = selectKnowledgeFiles(classified.primary, classified.secondary, `${vacancy.title}\n${vacancy.jd}`);
    assert.equal(files[0].path, vacancy.primaryFile, vacancy.name);
    if (vacancy.forbiddenFile !== vacancy.primaryFile) {
      assert.equal(files.some((f) => f.path === vacancy.forbiddenFile), false, vacancy.name);
    }
    const selected = selectProjectsForDomain(classified.primary, {
      title: vacancy.title,
      jd: vacancy.jd,
      company: vacancy.name
    });
    const validation = validateDomainConsistency({
      primaryDomain: classified.primary,
      projects: selected.projects,
      jdText: `${vacancy.title}\n${vacancy.jd}`
    });
    assert.equal(validation.ok, true, `${vacancy.name}: ${validation.reasons.join("; ")}`);
    assert.ok(validation.counts.ratio >= 0.75, vacancy.name);
  }
});

test("dry-run structures for the three test roles pass domain consistency", () => {
  const roles = [
    { title: "Shopify Developer", expect: "SHOPIFY" },
    { title: "Senior React Developer", expect: "REACT_FRONTEND" },
    { title: "Magento 2 / Hyvä Frontend Developer", expect: "MAGENTO_HYVA" }
  ];
  for (const role of roles) {
    const dry = buildDomainDryRun({ title: role.title, company: "Dry Run Co", jd: role.title });
    assert.equal(dry.primary_domain, role.expect);
    assert.equal(dry.validation.ok, true, dry.validation.reasons.join("; "));
    assert.ok(dry.projects.length >= 2 && dry.projects.length <= 4);
    assert.ok(dry.summary.length > 40);
    assert.ok(dry.skills.length >= 4);
  }
});

test("PDF page count is read from the page tree, not hardcoded", () => {
  const pdf = Buffer.from(`%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count 3 /Kids [3 0 R] >>
endobj
trailer
<< /Root 1 0 R >>
%%EOF
`, "latin1");
  assert.equal(countPdfPagesFromBuffer(pdf), 3);
  assert.equal(parseLoggedPdfPageCount("PDF generated\nPages: 2\nSize: 80 KB"), 2);
});

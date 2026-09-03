import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyDomain,
  validateDomainConsistency,
  selectProjectsForDomain,
  enforceDomainConsistency,
  buildDomainDryRun,
  isShopifyProject,
  isReactOnlyProject
} from "../server/cvDomainRouting.mjs";

test("classifies Shopify / React / Magento titles as the expected primary domain", () => {
  assert.equal(classifyDomain("Shopify Developer", "Theme work in Liquid").primary, "SHOPIFY");
  assert.equal(classifyDomain("Senior React Developer", "Next.js and TypeScript").primary, "REACT_FRONTEND");
  assert.equal(classifyDomain("Magento 2 / Hyvä Frontend Developer", "Hyvä CMS, PLP, PDP").primary, "MAGENTO_HYVA");
});

test("Shopify title wins even when the JD also mentions React", () => {
  const result = classifyDomain(
    "Shopify Developer",
    "We use Shopify Plus. React experience is a plus for a small internal tool."
  );
  assert.equal(result.primary, "SHOPIFY");
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

test("correct Shopify / Magento / React pools pass domain validation", () => {
  const shopify = selectProjectsForDomain("SHOPIFY", { title: "Shopify Developer", company: "Attomy" });
  const react = selectProjectsForDomain("REACT_FRONTEND", { title: "Senior React Developer", company: "Acme" });
  const magento = selectProjectsForDomain("MAGENTO_HYVA", { title: "Magento 2 / Hyvä Frontend Developer", company: "Snowdog" });

  assert.equal(validateDomainConsistency({ primaryDomain: "SHOPIFY", projects: shopify.projects }).ok, true);
  assert.equal(validateDomainConsistency({ primaryDomain: "REACT_FRONTEND", projects: react.projects }).ok, true);
  assert.equal(validateDomainConsistency({ primaryDomain: "MAGENTO_HYVA", projects: magento.projects }).ok, true);

  assert.ok(shopify.projects.filter((p) => isShopifyProject(p.name)).length >= 3);
  assert.equal(shopify.projects.filter((p) => isReactOnlyProject(p.name)).length, 0);
  assert.ok(react.projects.every((p) => !isShopifyProject(p.name)));
  assert.ok(magento.projects.filter((p) => /huber|lufed|housetipster|edycja|fmic|dreamroots|hbsgroup|paypair|tobacco|catering24|solar|3mk/i.test(p.name)).length >= 3);
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

test("enforceDomainConsistency replaces a wrong Shopify project list from the whitelist", () => {
  const enforced = enforceDomainConsistency(
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
  );
  assert.equal(enforced.corrected, true);
  assert.equal(enforced.validation.ok, true);
  assert.equal(enforced.result.primary_domain, "SHOPIFY");
  assert.ok(enforced.result.projects.filter((p) => isShopifyProject(p.name)).length >= 3);
  assert.match(enforced.result.summary, /shopify/i);
  assert.match(enforced.result.skills.map((s) => s.items).join(" "), /Liquid/);
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

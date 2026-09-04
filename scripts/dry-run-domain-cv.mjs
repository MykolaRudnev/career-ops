#!/usr/bin/env node
import { loadParsedMasterCv } from "../server/cvFromMaster.mjs";
import { buildDomainDryRun } from "../server/cvDomainRouting.mjs";

const roles = [
  { label: "A. Shopify Developer", title: "Shopify Developer", jd: "Shopify Developer. Liquid themes, custom sections, JSON templates, Shopify Admin, PLP/PDP." },
  { label: "B. Senior React Developer", title: "Senior React Developer", jd: "Senior React Developer. Next.js, TypeScript, SSR, component architecture, Core Web Vitals." },
  { label: "C. Magento 2 / Hyvä Frontend Developer", title: "Magento 2 / Hyvä Frontend Developer", jd: "Magento 2 Hyvä frontend. Hyvä CMS, Alpine.js, PLP, PDP, Cart, Checkout, XML layout." }
];

const experience = loadParsedMasterCv().experience;

for (const role of roles) {
  const dry = buildDomainDryRun({ ...role, company: "Dry-Run", extra: role.jd }, experience);
  const fbf = dry.experience.find((e) => /for better future/i.test(e.company));
  console.log("\n==================================================");
  console.log(role.label);
  console.log("==================================================");
  console.log(`PRIMARY DOMAIN: ${dry.primary_domain}`);
  console.log(`Validation: ${dry.validation.ok ? "PASS" : "FAIL"} ${dry.validation.reasons.join("; ")}`);
  console.log("\nProfessional Summary:");
  console.log(dry.summary);
  console.log("\nTechnical Skills:");
  for (const skill of dry.skills) console.log(`- ${skill.category}: ${skill.items}`);
  console.log("\nSelected projects:");
  for (const project of dry.projects) console.log(`- ${project.name} (${project.tech})`);
  console.log("\nSelected experience bullets (For Better Future):");
  for (const bullet of fbf?.bullets || []) console.log(`- ${bullet}`);
}

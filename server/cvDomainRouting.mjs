/**
 * Deterministic domain routing for tailored CVs.
 * Knowledge may be broad; project/skill/summary selection must follow ONE primary domain.
 * Factual claims stay grounded in cv.md + knowledge/*.md — nothing is invented here.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCareerOpsRoot } from '../path-resolver.mjs';

// Supplementary evidence stays in the user layer. Only the explicitly marked,
// source-annotated registry table extends project pools; it never changes JD
// classification, employer history, or the primary-domain ratio.
export function portfolioProjectAdditions() {
  let markdown;
  try { markdown = readFileSync(join(getCareerOpsRoot(), 'knowledge/projects.md'), 'utf8'); }
  catch { return []; }
  const section = markdown.split(/^## Portfolio-verified additions\s*$/m)[1]?.split(/^## /m)[0] || '';
  return section.split('\n').filter(line => line.startsWith('|')).flatMap(line => {
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    if (cells.length !== 5) return [];
    const [name, domain, url, tech, description] = cells;
    if (!['REACT_FRONTEND', 'MAGENTO_HYVA', 'SHOPIFY'].includes(domain)
        || !name || !tech || !description || !/^https:\/\//.test(url)) return [];
    return [{ name, domain, url, tech, description, aliases: [name] }];
  });
}

function matchesPortfolioProject(name, domain) {
  return portfolioProjectAdditions().some(project => project.domain === domain && normalizeName(project.name) === normalizeName(name));
}

export const PRIMARY_DOMAINS = [
  "REACT_FRONTEND",
  "MAGENTO_HYVA",
  "SHOPIFY",
  "FULLSTACK_TYPESCRIPT_NODE",
  "FRONTEND_LEAD",
  "PRODUCT_ENGINEERING",
  "DELIVERY_TECHNICAL",
  "GENERAL_FRONTEND"
];

const SHOPIFY_ALIASES = [
  "glasy.pl", "glasy",
  "ascent",
  "warmsome",
  "pixel25", "pixel 25",
  "berg's", "bergs", "bergs.co",
  "diamandia"
];

const REACT_ALIASES = [
  "ponadczasowi.pl", "ponadczasowi",
  "copernicspace.com", "copernicspace",
  "hrk.pl", "hrk",
  "pmicareers.pl", "pmicareers",
  "learningspace.app", "learningspace",
  "carneoo.de", "carneoo"
];

const MAGENTO_ALIASES = [
  "huber se", "huber",
  "lufed it", "lufed",
  "housetipster.com", "housetipster",
  "edycja.pl", "edycja",
  "fmic.pl", "fmic",
  "dreamroots.pl", "dreamroots",
  "hbsgroup.net", "hbsgroup",
  "paypair.com", "paypair",
  "british american tobacco", "bat",
  "catering24.co.uk", "catering24",
  "solar.com.pl", "solar.com",
  "3mk protection", "3mk.pl", "3mk",
  "orba"
];

/** Canonical project cards (verified catalog). */
export const PROJECT_CATALOG = {
  shopify: [
    {
      name: "Glasy.pl",
      aliases: ["glasy.pl", "glasy"],
      tech: "Shopify, Liquid, JavaScript, CSS",
      description: "Custom homepage elements, collection/PLP improvements, custom header and footer, and Shopify theme functionality for a live eyewear storefront."
    },
    {
      name: "Ascent",
      aliases: ["ascent"],
      tech: "Shopify, Liquid, JSON Templates, Shopify Admin",
      description: "Development-store homepage from Figma, reusable Liquid sections/blocks, and Shopify Admin configuration for a D2C brand."
    },
    {
      name: "Warmsome",
      aliases: ["warmsome"],
      tech: "Shopify, Liquid, Responsive UI",
      description: "Custom Shopify storefront sections, responsive components, and theme development for a live home-goods store."
    },
    {
      name: "Pixel25",
      aliases: ["pixel25", "pixel 25"],
      tech: "Shopify, Liquid, Custom Sections",
      description: "Custom Liquid sections and application-style frontend components for an automotive service storefront in development."
    },
    {
      name: "Berg's",
      aliases: ["berg's", "bergs", "bergs.co"],
      tech: "Shopify, Liquid",
      description: "Product page improvements, custom product logic, and frontend fixes on an existing apparel Shopify store."
    },
    {
      name: "Diamandia",
      aliases: ["diamandia"],
      tech: "Shopify, Liquid",
      description: "Homepage sections, social media integration, and theme improvements. Caveat: our version was not released to production."
    }
  ],
  react: [
    {
      name: "ponadczasowi.pl",
      aliases: ["ponadczasowi.pl", "ponadczasowi"],
      tech: "Next.js, React, TypeScript, Tailwind CSS, REST APIs",
      description: "Production Next.js e-commerce storefront covering checkout, payments, shipping, and blog, with lazy loading and code splitting."
    },
    {
      name: "copernicspace.com",
      aliases: ["copernicspace.com", "copernicspace"],
      tech: "React, Next.js, TypeScript, REST APIs, Styled Components",
      description: "NFT marketplace built from scratch: interactive builder, listings, user profiles, and frontend performance work."
    },
    {
      name: "hrk.pl",
      aliases: ["hrk.pl", "hrk"],
      tech: "Gatsby.js, React, TypeScript, GraphQL",
      description: "Recruitment platform frontend with SEO architecture work and a verified ~50% increase in organic search traffic."
    },
    {
      name: "pmicareers.pl",
      aliases: ["pmicareers.pl", "pmicareers"],
      tech: "React, Next.js, TypeScript, REST APIs",
      description: "React-to-Next.js migration with performance and scalability improvements; full frontend delivery."
    },
    {
      name: "learningspace.app",
      aliases: ["learningspace.app", "learningspace"],
      tech: "React, Next.js, TypeScript",
      description: "Interactive educational platform with scalable UI and lesson/progress UX."
    },
    {
      name: "carneoo.de",
      aliases: ["carneoo.de", "carneoo"],
      tech: "React, Next.js",
      description: "Features, bug fixes, custom components, and UX/stability work on an automotive marketplace."
    }
  ],
  magento: [
    {
      name: "HUBER SE",
      aliases: ["huber se", "huber"],
      tech: "Magento 2, Hyvä Theme, Hyvä CMS, Alpine.js, Tailwind CSS",
      description: "Lead frontend delivery on a Magento 2 / Hyvä storefront: PLP/PDP/Cart/Checkout/Account, multi-store CMS, performance, SEO, and accessibility."
    },
    {
      name: "Lufed IT",
      aliases: ["lufed it", "lufed"],
      tech: "Magento 2, Hyvä Theme, Alpine.js, Tailwind CSS",
      description: "Magento 2 / Hyvä migration and reusable CMS/component system with ownership of PLP, PDP, Cart, Checkout, and Account."
    },
    {
      name: "housetipster.com",
      aliases: ["housetipster.com", "housetipster"],
      tech: "Magento 2, XML Layout, PHTML, JavaScript",
      description: "Full Magento 2 build from scratch: homepage, PLP, PDP, CMS pages, account area, and custom components."
    },
    {
      name: "edycja.pl",
      aliases: ["edycja.pl", "edycja"],
      tech: "Magento 2, Custom Theme",
      description: "Magento 2 store built from scratch with custom theme, advanced UI, and checkout flow."
    },
    {
      name: "fmic.pl",
      aliases: ["fmic.pl", "fmic"],
      tech: "Magento 2",
      description: "Business-logic enhancements, performance work, and catalog filtering on an automotive Magento 2 store."
    },
    {
      name: "dreamroots.pl",
      aliases: ["dreamroots.pl", "dreamroots"],
      tech: "Magento 2",
      description: "Performance optimization, multi-language translations, and new catalog pages."
    },
    {
      name: "hbsgroup.net",
      aliases: ["hbsgroup.net", "hbsgroup"],
      tech: "Magento 2",
      description: "Version updates, new landing pages, and logic fixes on a B2B Magento 2 store."
    },
    {
      name: "paypair.com",
      aliases: ["paypair.com", "paypair"],
      tech: "Magento 2",
      description: "Bug fixes, new features, and UX improvements on a payments-related Magento storefront."
    },
    {
      name: "British American Tobacco",
      aliases: ["british american tobacco", "bat"],
      tech: "Magento 2 Enterprise",
      description: "Product pages, checkout flows, customer account areas, and multi-market delivery across 4 storefronts."
    },
    {
      name: "catering24.co.uk",
      aliases: ["catering24.co.uk", "catering24"],
      tech: "Magento 2",
      description: "Custom storefront with commercial integrations and CMS-driven pages."
    },
    {
      name: "solar.com.pl",
      aliases: ["solar.com.pl", "solar.com"],
      tech: "Magento 2",
      description: "Custom storefront with specialized catalog features and custom UI components."
    },
    {
      name: "3mk.pl",
      aliases: ["3mk protection", "3mk.pl", "3mk"],
      tech: "Magento 2",
      description: "Storefront from scratch: homepage, category/PLP, cart, and custom UI focused on UX and conversion."
    },
    {
      name: "ORBA",
      aliases: ["orba"],
      tech: "Magento 2",
      description: "Front-end optimization, performance improvements, and user experience enhancements on a cosmetics Magento storefront."
    }
  ]
};

export const DOMAIN_KNOWLEDGE_FILES = {
  SHOPIFY: "knowledge/shopify.md",
  MAGENTO_HYVA: "knowledge/magento-hyva.md",
  REACT_FRONTEND: "knowledge/react-frontend.md",
  FULLSTACK_TYPESCRIPT_NODE: "knowledge/react-frontend.md",
  FRONTEND_LEAD: "knowledge/react-frontend.md",
  PRODUCT_ENGINEERING: "knowledge/react-frontend.md",
  DELIVERY_TECHNICAL: "knowledge/react-frontend.md",
  GENERAL_FRONTEND: "knowledge/react-frontend.md"
};

export const DOMAIN_PROJECT_POOLS = {
  SHOPIFY: PROJECT_CATALOG.shopify,
  MAGENTO_HYVA: PROJECT_CATALOG.magento,
  REACT_FRONTEND: PROJECT_CATALOG.react,
  FULLSTACK_TYPESCRIPT_NODE: PROJECT_CATALOG.react,
  FRONTEND_LEAD: [
    PROJECT_CATALOG.magento[0],
    PROJECT_CATALOG.magento[1],
    PROJECT_CATALOG.react[0],
    PROJECT_CATALOG.react[1],
    PROJECT_CATALOG.react[3]
  ],
  PRODUCT_ENGINEERING: [
    PROJECT_CATALOG.react[0],
    PROJECT_CATALOG.react[4],
    PROJECT_CATALOG.react[1],
    PROJECT_CATALOG.react[3],
    PROJECT_CATALOG.magento[0]
  ],
  DELIVERY_TECHNICAL: [
    PROJECT_CATALOG.magento[0],
    PROJECT_CATALOG.magento[1],
    PROJECT_CATALOG.react[0],
    PROJECT_CATALOG.magento[2]
  ],
  GENERAL_FRONTEND: [
    ...PROJECT_CATALOG.react,
    PROJECT_CATALOG.magento[0]
  ]
};

export const SHOPIFY_FORBIDDEN_UNLESS_JD_REACT = PROJECT_CATALOG.react.map((p) => p.name);

const SKILL_GROUPS = {
  SHOPIFY: [
    { category: "Shopify", items: "Shopify Themes, Liquid, Custom Sections & Blocks, JSON Templates, Shopify Admin Configuration, Section Schema, Theme Customization" },
    { category: "Frontend", items: "JavaScript, TypeScript, HTML5, CSS3" },
    { category: "E-Commerce", items: "Collections / PLP, PDP, Cart, Checkout, Customer Journey, CRO / Conversion Optimization" },
    { category: "Performance", items: "Core Web Vitals, SEO, Responsive Design, Accessibility" },
    { category: "APIs", items: "REST API, GraphQL" }
  ],
  REACT_FRONTEND: [
    { category: "Frontend", items: "React, Next.js, TypeScript, JavaScript, HTML5, CSS3" },
    { category: "Architecture & Performance", items: "Frontend Architecture, SSR, ISR, SSG, Code Splitting, Component Systems, Core Web Vitals, Performance Optimization" },
    { category: "APIs", items: "REST API, GraphQL, JSON" },
    { category: "Styling", items: "Tailwind CSS, Styled Components" },
    { category: "Practices", items: "Responsive Design, Accessibility / WCAG, SEO" },
    { category: "Tooling", items: "Git, CI/CD, Docker" }
  ],
  MAGENTO_HYVA: [
    { category: "Magento / E-Commerce", items: "Magento 2, Hyvä Theme, Hyvä CMS, Alpine.js, XML/Layout, PHTML, PLP, PDP, Cart, Checkout, Customer Account, CMS" },
    { category: "Frontend", items: "JavaScript, TypeScript, HTML5, CSS3" },
    { category: "Performance", items: "Core Web Vitals, Performance Optimization, SEO, Accessibility" },
    { category: "Styling", items: "Tailwind CSS, LESS / SASS" },
    { category: "APIs", items: "REST API, GraphQL" },
    { category: "Tooling", items: "Git, GitLab, CI/CD, Docker" }
  ],
  FULLSTACK_TYPESCRIPT_NODE: [
    { category: "Frontend", items: "React, Next.js, TypeScript, JavaScript" },
    { category: "Architecture", items: "Frontend Architecture, SSR, ISR, SSG, Component Systems" },
    { category: "APIs & Integration", items: "REST API, GraphQL, JSON" },
    { category: "Fullstack & API", items: "TypeScript, Node.js fundamentals, REST API, GraphQL, JSON" },
    { category: "Tooling & Performance", items: "Git, CI/CD, Docker, Core Web Vitals" }
  ],
  FRONTEND_LEAD: [
    { category: "Frontend", items: "React, Next.js, TypeScript, JavaScript, HTML5, CSS3" },
    { category: "E-Commerce", items: "Magento 2, Hyvä Theme, Storefront Architecture, PLP, PDP, Cart, Checkout" },
    { category: "Leadership & Delivery", items: "Technical Leadership, Architecture Decisions, Client Communication, Requirements Translation, Delivery Ownership, Cross-functional Coordination" },
    { category: "Performance", items: "Core Web Vitals, SEO, Accessibility / WCAG" },
    { category: "Tooling", items: "Git, CI/CD, Docker" }
  ],
  PRODUCT_ENGINEERING: [
    { category: "Frontend", items: "React, Next.js, TypeScript, JavaScript, HTML5, CSS3" },
    { category: "Product UI", items: "Component Systems, Customer Journeys, UX, Responsive Design" },
    { category: "Delivery", items: "Requirements Analysis, Client Communication, Technical Decision-Making, Delivery Ownership, Cross-functional Coordination" },
    { category: "APIs", items: "REST API, GraphQL, JSON" }
  ],
  DELIVERY_TECHNICAL: [
    { category: "Frontend", items: "JavaScript, TypeScript, HTML5, CSS3, React" },
    { category: "Delivery", items: "Requirements Analysis, Client Communication, Technical Decision-Making, Delivery Ownership, Cross-functional Coordination" },
    { category: "E-Commerce", items: "Storefront Delivery, PLP, PDP, Cart, Checkout, CMS" },
    { category: "Tooling", items: "Git, CI/CD, JIRA" }
  ],
  GENERAL_FRONTEND: [
    { category: "Frontend", items: "React, Next.js, TypeScript, JavaScript, HTML5, CSS3" },
    { category: "Architecture & Performance", items: "Frontend Architecture, SSR, Core Web Vitals, Responsive Design, Accessibility / WCAG, SEO" },
    { category: "APIs", items: "REST API, GraphQL, JSON" },
    { category: "Tooling", items: "Git, CI/CD" }
  ]
};

const SUMMARIES = {
  SHOPIFY: "Senior E-Commerce Frontend Developer specializing in Shopify theme development, Liquid sections and blocks, JSON templates, and conversion-focused storefronts. 6+ years delivering customer journeys across homepage, collections/PLP, PDP, cart, and checkout, with strong JavaScript, HTML/CSS, REST/GraphQL, and responsive performance work. Comfortable translating Figma into production Shopify Admin-configurable sections without claiming unreleased work as live.",
  REACT_FRONTEND: "Senior Frontend Developer specializing in React, Next.js and TypeScript, with 6+ years building scalable production UIs, component systems, and performance-sensitive web applications. Strong in SSR/ISR/SSG, REST/GraphQL, Core Web Vitals, accessibility, and SEO. Delivers end-to-end frontend from architecture through production across e-commerce, marketplace, and platform products.",
  MAGENTO_HYVA: "Senior Frontend Developer with deep Magento 2 / Hyvä experience across PLP, PDP, cart, checkout, customer account, and CMS, including Hyvä CMS, Alpine.js, XML/Layout, and PHTML. Leads storefront delivery, multi-store work, performance, SEO, and accessibility on enterprise Magento platforms, coordinating with backend, SEO, and client stakeholders.",
  FULLSTACK_TYPESCRIPT_NODE: "Senior Frontend Engineer expanding into frontend-heavy Fullstack TypeScript: React, Next.js, TypeScript, and Node.js fundamentals for API integration, not commercial backend ownership. Strong in component architecture, SSR/ISR/SSG, REST/GraphQL, JSON, Docker, and CI/CD, with production frontend delivery as the core claim.",
  FRONTEND_LEAD: "Lead / Senior Frontend Developer combining hands-on React, Next.js, TypeScript, and e-commerce storefront engineering with technical leadership, architecture decisions, and client communication. 6+ years delivering production platforms while translating business and SEO requirements into frontend milestones.",
  PRODUCT_ENGINEERING: "Senior Frontend / Product Engineer focused on customer-facing product UI, component systems, and delivery ownership. Uses React, Next.js, and TypeScript to ship production features while coordinating requirements, technical decisions, and cross-functional delivery.",
  DELIVERY_TECHNICAL: "Senior Frontend Developer with delivery ownership: requirements analysis, client communication, technical decision-making, and cross-functional coordination, grounded in commercial storefront and web application delivery rather than people-management claims.",
  GENERAL_FRONTEND: "Senior Frontend Developer with 6+ years of commercial experience building scalable web applications, component systems, and customer-facing product UI. Strong in JavaScript, TypeScript, modern frontend architecture, performance, accessibility, and SEO."
};

const HEADLINES = {
  SHOPIFY: "Senior Shopify / Front-End Developer | Liquid | JavaScript | E-commerce",
  REACT_FRONTEND: "Senior Frontend Developer | React | Next.js | TypeScript | Product UI",
  MAGENTO_HYVA: "Lead / Senior Front-End Developer | Magento 2 | Hyvä | E-commerce Architecture",
  FULLSTACK_TYPESCRIPT_NODE: "Senior Frontend Engineer | React | Next.js | TypeScript | Frontend-heavy Fullstack",
  FRONTEND_LEAD: "Lead Front-End Developer | Architecture | Delivery | React & E-commerce",
  PRODUCT_ENGINEERING: "Senior Frontend / Product Engineer | React | TypeScript | Delivery",
  DELIVERY_TECHNICAL: "Senior Frontend Developer | Technical Delivery | Client Communication",
  GENERAL_FRONTEND: "Senior Frontend Developer | JavaScript | TypeScript | Product UI"
};

/** Verified FBF bullets by domain (cv.md + knowledge/*.md). */
const FBF_BULLETS = {
  SHOPIFY: [
    "Built and customized Shopify themes with Liquid sections, custom blocks, and Admin-configurable storefront components for client brands",
    "Delivered homepage, product, and collection/PLP work, including custom product logic and responsive theme components from Figma to storefront",
    "Improved e-commerce frontend performance and conversion-oriented UX on Shopify storefronts (Glasy.pl, Ascent, Warmsome, Pixel25, Berg's)",
    "Worked in a multi-project agency environment delivering concurrent Shopify theme and section work alongside other client platforms"
  ],
  REACT_FRONTEND: [
    "Led development and delivery of multiple production web applications across e-commerce, marketplace, recruitment, and platform domains",
    "Built scalable frontend architecture and reusable UI component systems using React, Next.js, and TypeScript",
    "Worked in a multi-project agency environment, balancing concurrent feature delivery, architecture refactoring, and performance optimizations",
    "Delivered end-to-end frontend solutions from requirements definition to production deployment in close collaboration with clients and cross-functional teams"
  ],
  MAGENTO_HYVA: [
    "Delivered Magento 2 storefronts including homepage, PLP, PDP, CMS, cart/checkout, and account areas for agency clients such as housetipster.com and edycja.pl",
    "Implemented Magento 2 theme, catalog, and performance work across multi-client e-commerce (fmic.pl, dreamroots.pl, hbsgroup.net, paypair.com)",
    "Worked in a multi-project agency environment balancing concurrent Magento storefront delivery, CMS structures, and frontend performance",
    "Delivered end-to-end frontend solutions from requirements definition to production deployment in close collaboration with clients and cross-functional teams"
  ],
  FULLSTACK_TYPESCRIPT_NODE: [
    "Built scalable frontend architecture and reusable UI component systems using React, Next.js, and TypeScript",
    "Delivered end-to-end frontend solutions from requirements definition to production deployment, integrating REST and GraphQL APIs",
    "Worked in a multi-project agency environment, balancing concurrent feature delivery, architecture refactoring, and performance optimizations",
    "Focused on performance optimization (Core Web Vitals), SEO improvements, and UX enhancements across client projects"
  ],
  FRONTEND_LEAD: [
    "Led development and delivery of multiple production web applications across e-commerce, marketplace, recruitment, and platform domains",
    "Delivered end-to-end frontend solutions from requirements definition to production deployment in close collaboration with clients and cross-functional teams",
    "Built scalable frontend architecture and reusable UI component systems using React, Next.js, and TypeScript",
    "Worked in a multi-project agency environment, balancing concurrent feature delivery, architecture refactoring, and performance optimizations"
  ],
  PRODUCT_ENGINEERING: [
    "Led development and delivery of multiple production web applications across e-commerce, marketplace, recruitment, and platform domains",
    "Delivered end-to-end frontend solutions from requirements definition to production deployment in close collaboration with clients and cross-functional teams",
    "Focused on performance optimization (Core Web Vitals), SEO improvements, and UX enhancements across all client projects",
    "Built scalable frontend architecture and reusable UI component systems using React, Next.js, and TypeScript"
  ],
  DELIVERY_TECHNICAL: [
    "Delivered end-to-end frontend solutions from requirements definition to production deployment in close collaboration with clients and cross-functional teams",
    "Led development and delivery of multiple production web applications across e-commerce, marketplace, recruitment, and platform domains",
    "Worked in a multi-project agency environment, balancing concurrent feature delivery, architecture refactoring, and performance optimizations",
    "Focused on performance optimization (Core Web Vitals), SEO improvements, and UX enhancements across all client projects"
  ],
  GENERAL_FRONTEND: [
    "Led development and delivery of multiple production web applications across e-commerce, marketplace, recruitment, and platform domains",
    "Built scalable frontend architecture and reusable UI component systems using React, Next.js, and TypeScript",
    "Delivered end-to-end frontend solutions from requirements definition to production deployment in close collaboration with clients and cross-functional teams",
    "Focused on performance optimization (Core Web Vitals), SEO improvements, and UX enhancements across all client projects"
  ]
};

function normalize(text) {
  return String(text || "").toLowerCase();
}

function normalizeName(name) {
  return normalize(name)
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hashSeed(str) {
  let h = 2166136261;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededShuffle(items, seed) {
  const out = [...items];
  let h = hashSeed(seed);
  for (let i = out.length - 1; i > 0; i--) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function countHits(text, patterns) {
  return patterns.reduce((sum, pattern) => {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    return sum + (text.match(new RegExp(pattern.source, flags)) || []).length;
  }, 0);
}

export function normalizePrimaryDomain(value) {
  const raw = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  const aliases = {
    REACT: "REACT_FRONTEND",
    NEXT: "REACT_FRONTEND",
    NEXTJS: "REACT_FRONTEND",
    MAGENTO: "MAGENTO_HYVA",
    HYVA: "MAGENTO_HYVA",
    HYVA_THEME: "MAGENTO_HYVA",
    FULLSTACK: "FULLSTACK_TYPESCRIPT_NODE",
    FULL_STACK: "FULLSTACK_TYPESCRIPT_NODE",
    LEAD: "FRONTEND_LEAD",
    TECH_LEAD: "FRONTEND_LEAD",
    PRODUCT: "PRODUCT_ENGINEERING",
    DELIVERY: "DELIVERY_TECHNICAL",
    GENERAL: "GENERAL_FRONTEND",
    FRONTEND: "GENERAL_FRONTEND"
  };
  if (PRIMARY_DOMAINS.includes(raw)) return raw;
  if (aliases[raw]) return aliases[raw];
  return "";
}

export function projectMatchesAliases(name, aliases) {
  const n = normalizeName(name);
  if (!n) return false;
  return aliases.some((alias) => {
    const a = normalizeName(alias);
    return n === a || n.includes(a) || a.includes(n);
  });
}

export function isShopifyProject(name) {
  return projectMatchesAliases(name, SHOPIFY_ALIASES) || matchesPortfolioProject(name, 'SHOPIFY');
}

export function isReactProject(name) {
  return projectMatchesAliases(name, REACT_ALIASES) || matchesPortfolioProject(name, 'REACT_FRONTEND');
}

export function isMagentoProject(name) {
  return projectMatchesAliases(name, MAGENTO_ALIASES) || matchesPortfolioProject(name, 'MAGENTO_HYVA');
}

export function isReactOnlyProject(name) {
  return isReactProject(name) && !isShopifyProject(name) && !isMagentoProject(name);
}

export function jdRequestsReact(text) {
  return /\breact(?:\.js|js)?\b|\bnext\.?(?:js)?\b/i.test(text || "");
}

export function jdRequestsShopify(text) {
  return /\bshopify(?:\s+plus)?\b|\bliquid\b/i.test(text || "");
}

export function jdRequestsMagento(text) {
  return /\bmagento(?:\s*2)?\b|\bhyv[aä]\b|\badobe commerce\b/i.test(text || "");
}

/**
 * Secondary domains are allowed only when the JD explicitly names that stack.
 * Generic words like "frontend" do not justify loading React knowledge on a Shopify vacancy.
 */
export function justifiedSecondaryDomains(primary, jdText = "", scores = {}) {
  const text = String(jdText || "");
  const out = [];
  const add = (domain, ok) => {
    if (!ok || !domain || domain === primary || out.includes(domain)) return;
    if (!PRIMARY_DOMAINS.includes(domain)) return;
    out.push(domain);
  };

  add("REACT_FRONTEND", jdRequestsReact(text));
  add("SHOPIFY", jdRequestsShopify(text));
  add("MAGENTO_HYVA", jdRequestsMagento(text));
  add("FULLSTACK_TYPESCRIPT_NODE", /\bfull[ -]?stack\b/i.test(text) && /\bnode\.?(?:js)?\b/i.test(text));
  add("FRONTEND_LEAD", (scores.FRONTEND_LEAD || 0) >= 2 && /\b(tech(?:nical)? lead|frontend lead|lead front-?end|staff|principal)\b/i.test(text));
  add("PRODUCT_ENGINEERING", (scores.PRODUCT_ENGINEERING || 0) >= 2 && /\bproduct engineer/i.test(text));

  if (primary === "FULLSTACK_TYPESCRIPT_NODE") add("REACT_FRONTEND", true);
  if (primary === "FRONTEND_LEAD" && jdRequestsReact(text)) add("REACT_FRONTEND", true);

  return out.slice(0, 3);
}

/**
 * Load PRIMARY knowledge first. Secondary files are included only when justified.
 * Competing platform files (Shopify vs Magento vs React) never load just because the JD says "frontend".
 */
export function selectKnowledgeFiles(primary, secondary = [], jdText = "") {
  const justified = new Set(justifiedSecondaryDomains(primary, jdText));
  const orderedSecondary = [...new Set([...(secondary || []), ...justified])].filter((d) => d !== primary && justified.has(d));
  const files = [];
  const seen = new Set();
  const push = (domain, role) => {
    const rel = DOMAIN_KNOWLEDGE_FILES[domain];
    if (!rel || seen.has(rel)) return;
    seen.add(rel);
    files.push({ domain, path: rel, role });
  };
  push(primary, "primary");
  for (const domain of orderedSecondary) push(domain, "secondary");
  return files;
}

export function classifyDomain(title = "", jd = "", extra = "") {
  const titleText = `${title}`;
  const body = `${extra}\n${jd}`;
  const all = `${titleText}\n${body}`;
  const titleLower = normalize(titleText);
  const allLower = normalize(all);

  const shopifyTitle = /\bshopify\b|\bliquid\b/.test(titleLower);
  const magentoTitle = /\bmagento(?:\s*2)?\b|\bhyv[aä]\b|\badobe commerce\b/.test(titleLower);
  const reactTitle = /\breact(?:\.js|js)?\b|\bnext\.?(?:js)?\b/.test(titleLower);
  const fullstackTitle = /\bfull[ -]?stack\b/.test(titleLower);
  const leadTitle = /\b(frontend lead|front-end lead|tech lead|technical lead|team lead|staff|principal|lead front-?end|lead frontend)\b/.test(titleLower)
    || (/\blead\b/.test(titleLower) && /\b(front[ -]?end|react|engineer|developer)\b/.test(titleLower));
  const productTitle = /\bproduct engineer\b|\bproduct frontend\b/.test(titleLower);
  const deliveryTitle = /\b(delivery manager|technical delivery|delivery lead|project manager)\b/.test(titleLower)
    && !/\b(developer|engineer|programista)\b/.test(titleLower);
  const frontendTitle = /\bfront[ -]?end\b|\bui (?:developer|engineer)\b|\bweb (?:developer|engineer)\b/.test(titleLower);
  const nodeTitle = /\bnode\.?(?:js)?\b/.test(titleLower);

  const scores = {
    SHOPIFY: countHits(all, [/\bshopify(?:\s+plus)?\b/i, /\bliquid\b/i, /\bjson templates?\b/i, /\bshopify admin\b/i]) * 2,
    MAGENTO_HYVA: countHits(all, [/\bmagento(?:\s*2)?\b/i, /\bhyv[aä]\b/i, /\badobe commerce\b/i, /\balpine\.js\b/i, /\bphtml\b/i]) * 2,
    REACT_FRONTEND: countHits(all, [/\breact(?:\.js|js)?\b/i, /\bnext\.?(?:js)?\b/i, /\btypescript\b/i, /\bgatsby\b/i]),
    FULLSTACK_TYPESCRIPT_NODE: countHits(all, [/\bfull[ -]?stack\b/i, /\bnode\.?(?:js)?\b/i, /\bnest\.?(?:js)?\b/i]),
    FRONTEND_LEAD: countHits(all, [/\btech(?:nical)? lead\b/i, /\bfrontend lead\b/i, /\blead front-?end\b/i, /\barchitecture decisions\b/i]),
    PRODUCT_ENGINEERING: countHits(all, [/\bproduct engineer\b/i, /\bproduct-minded\b/i, /\b0-?1\b/i]),
    DELIVERY_TECHNICAL: countHits(all, [/\bdelivery ownership\b/i, /\brequirements analysis\b/i, /\bstakeholder\b/i]),
    GENERAL_FRONTEND: countHits(all, [/\bfront[ -]?end\b/i, /\bjavascript\b/i, /\bhtml5\b/i, /\bcss3\b/i])
  };

  // Title is authoritative for specialized vacancies.
  let primary = "";
  if (shopifyTitle) primary = "SHOPIFY";
  else if (magentoTitle) primary = "MAGENTO_HYVA";
  else if (productTitle) primary = "PRODUCT_ENGINEERING";
  else if (deliveryTitle) primary = "DELIVERY_TECHNICAL";
  else if (fullstackTitle && (reactTitle || nodeTitle || /\btypescript\b/.test(titleLower) || /\bnode\b/.test(allLower))) {
    primary = "FULLSTACK_TYPESCRIPT_NODE";
  } else if (leadTitle) primary = "FRONTEND_LEAD";
  else if (reactTitle && (nodeTitle || (/\bfull[ -]?stack\b/.test(allLower) && /\bnode\.?(?:js)?\b/.test(allLower) && /\bfrontend[ -](?:heavy|focused)|primarily front[ -]?end/i.test(all)))) {
    primary = "FULLSTACK_TYPESCRIPT_NODE";
  } else if (reactTitle) primary = "REACT_FRONTEND";
  else if (frontendTitle) {
    if (scores.REACT_FRONTEND >= 2 && scores.SHOPIFY < 2 && scores.MAGENTO_HYVA < 2) primary = "REACT_FRONTEND";
    else primary = "GENERAL_FRONTEND";
  } else {
    const ranked = PRIMARY_DOMAINS.slice().sort((a, b) => scores[b] - scores[a] || PRIMARY_DOMAINS.indexOf(a) - PRIMARY_DOMAINS.indexOf(b));
    primary = scores[ranked[0]] > 0 ? ranked[0] : "GENERAL_FRONTEND";
    if (scores.SHOPIFY >= scores.REACT_FRONTEND && scores.SHOPIFY >= scores.MAGENTO_HYVA && scores.SHOPIFY > 0) primary = "SHOPIFY";
    if (scores.MAGENTO_HYVA > scores.SHOPIFY && scores.MAGENTO_HYVA >= scores.REACT_FRONTEND && scores.MAGENTO_HYVA > 0 && !shopifyTitle) {
      if (!reactTitle) primary = "MAGENTO_HYVA";
    }
  }

  const secondary = justifiedSecondaryDomains(primary, all, scores);

  return {
    primary,
    secondary,
    scores,
    shopifyTitle,
    magentoTitle,
    reactTitle
  };
}

export function domainProjectPool(primaryDomain) {
  const pool = DOMAIN_PROJECT_POOLS[primaryDomain] || DOMAIN_PROJECT_POOLS.GENERAL_FRONTEND;
  const domain = primaryDomain === 'FULLSTACK_TYPESCRIPT_NODE' ? 'REACT_FRONTEND' : primaryDomain;
  return [...pool, ...portfolioProjectAdditions().filter(project => project.domain === domain)];
}

export function countProjectsInPool(projects, pool) {
  const aliases = pool.flatMap((p) => p.aliases || [p.name]);
  return (projects || []).filter((p) => projectMatchesAliases(p.name || p, aliases)).length;
}

/**
 * PRIMARY pool must be >= 75% of selected projects.
 * SHOPIFY: more React-only than Shopify → fail; zero Shopify → fail.
 * MAGENTO / REACT: same majority + presence rules.
 */
export function validateDomainConsistency({ primaryDomain, projects = [], jdText = "" } = {}) {
  const primary = normalizePrimaryDomain(primaryDomain) || primaryDomain;
  const names = (projects || []).map((p) => (typeof p === "string" ? p : p.name));
  const reasons = [];
  if (!PRIMARY_DOMAINS.includes(primary)) {
    return { ok: false, reasons: [`Unknown primary domain: ${primaryDomain}`], primaryDomain: primary, counts: {} };
  }
  if (names.length < 2 || names.length > 6) {
    reasons.push(`Expected 2–6 projects (prefer 4–6), received ${names.length}`);
  }

  const shopifyCount = names.filter(isShopifyProject).length;
  const magentoCount = names.filter(isMagentoProject).length;
  const reactCount = names.filter(isReactProject).length;
  const reactOnlyCount = names.filter(isReactOnlyProject).length;
  const pool = domainProjectPool(primary);
  const inPool = countProjectsInPool(names.map((name) => ({ name })), pool);
  const ratio = names.length ? inPool / names.length : 0;
  const counts = { shopifyCount, magentoCount, reactCount, reactOnlyCount, inPool, total: names.length, ratio };

  if (names.length > 0 && ratio < 0.75) {
    reasons.push(`PRIMARY ${primary} pool must supply at least 75% of projects (have ${inPool}/${names.length})`);
  }

  if (primary === "SHOPIFY") {
    if (shopifyCount === 0) reasons.push("Shopify CV contains no Shopify-specific project");
    if (reactOnlyCount > shopifyCount) reasons.push("Shopify CV has more React-only projects than Shopify projects");
    const forbidden = names.filter((name) => SHOPIFY_FORBIDDEN_UNLESS_JD_REACT.includes(name) || isReactOnlyProject(name));
    if (forbidden.length && shopifyCount < 3 && !jdRequestsReact(jdText)) {
      reasons.push(`Shopify CV selected React-only projects without a React/Next.js JD requirement: ${forbidden.join(", ")}`);
    }
  }

  if (primary === "MAGENTO_HYVA") {
    if (magentoCount === 0) reasons.push("Magento CV contains no Magento-specific project");
    if (reactOnlyCount > magentoCount) reasons.push("Magento CV has more React-only projects than Magento projects");
  }

  if (primary === "REACT_FRONTEND" || primary === "FULLSTACK_TYPESCRIPT_NODE") {
    if (reactCount === 0) reasons.push(`${primary === "FULLSTACK_TYPESCRIPT_NODE" ? "Fullstack TypeScript" : "React"} CV contains no React/Next.js project`);
    if (shopifyCount > reactCount) reasons.push(`${primary} CV has more Shopify projects than React projects`);
    if (magentoCount > reactCount) reasons.push(`${primary} CV has more Magento projects than React projects`);
  }

  return { ok: reasons.length === 0, reasons, primaryDomain: primary, counts };
}

export function selectProjectsForDomain(primaryDomain, { title = "", jd = "", company = "", count } = {}) {
  const primary = normalizePrimaryDomain(primaryDomain) || primaryDomain || "GENERAL_FRONTEND";
  const seed = `${company}|${title}|${primary}`;
  const jdText = `${title}\n${jd}`;
  const wantsReactSupport = jdRequestsReact(jdText);

  let selected = [];
  if (primary === "SHOPIFY") {
    const rest = seededShuffle(
      PROJECT_CATALOG.shopify.filter((p) => p.name !== "Glasy.pl" && p.name !== "Diamandia"),
      seed
    );
    selected = [PROJECT_CATALOG.shopify[0], ...rest.slice(0, 2)];
    if (wantsReactSupport) {
      selected.push(PROJECT_CATALOG.react[0]);
    } else if (rest[2]) {
      selected.push(rest[2]);
    }
  } else if (primary === "MAGENTO_HYVA") {
    const rest = seededShuffle(
      PROJECT_CATALOG.magento.filter((p) => p.name !== "HUBER SE" && p.name !== "Lufed IT"),
      seed
    );
    selected = [PROJECT_CATALOG.magento[0], PROJECT_CATALOG.magento[1], rest[0]].filter(Boolean);
    if (wantsReactSupport) selected.push(PROJECT_CATALOG.react[0]);
    else if (rest[1]) selected.push(rest[1]);
  } else if (primary === "REACT_FRONTEND" || primary === "FULLSTACK_TYPESCRIPT_NODE") {
    const react = seededShuffle(PROJECT_CATALOG.react, seed);
    selected = react.slice(0, 3);
    const ecommerceRelevant = /\be-?commerce\b|\bcheckout\b|\bstorefront\b/i.test(jdText);
    if (ecommerceRelevant) selected.push(PROJECT_CATALOG.react.find((p) => p.name === "ponadczasowi.pl") || react[3]);
    else if (react[3]) selected.push(react[3]);
  } else {
    const pool = seededShuffle(domainProjectPool(primary), seed);
    selected = pool.slice(0, Math.min(4, Math.max(2, count || 4)));
  }

  selected = selected.filter(Boolean).slice(0, 4);
  if (selected.length < 2) {
    selected = domainProjectPool(primary).slice(0, 3);
  }

  return {
    primary,
    projects: selected.map(({ name, tech, description }) => ({ name, tech, description })),
    reasons: selected.map((p) => ({ name: p.name, reason: `Primary ${primary} whitelist` }))
  };
}

export function skillsForDomain(primaryDomain) {
  const primary = normalizePrimaryDomain(primaryDomain) || primaryDomain;
  return SKILL_GROUPS[primary] || SKILL_GROUPS.GENERAL_FRONTEND;
}

export function summaryForDomain(primaryDomain) {
  const primary = normalizePrimaryDomain(primaryDomain) || primaryDomain;
  return SUMMARIES[primary] || SUMMARIES.GENERAL_FRONTEND;
}

export function headlineForDomain(primaryDomain) {
  const primary = normalizePrimaryDomain(primaryDomain) || primaryDomain;
  return HEADLINES[primary] || HEADLINES.GENERAL_FRONTEND;
}

function pickBullets(entry, keywords, fallbackCount = 2) {
  const bullets = entry?.bullets || [];
  const matched = bullets.filter((b) => keywords.some((k) => normalize(b).includes(k)));
  const picked = (matched.length ? matched : bullets).slice(0, fallbackCount === 4 ? 4 : Math.min(4, Math.max(2, fallbackCount)));
  return picked.length ? picked : bullets.slice(0, 2);
}

export function selectExperienceBulletsForDomain(primaryDomain, experience = []) {
  const primary = normalizePrimaryDomain(primaryDomain) || primaryDomain;
  return experience.map((entry) => {
    const company = normalize(entry.company);
    let bullets = entry.bullets || [];
    if (company.includes("for better future")) {
      bullets = FBF_BULLETS[primary] || FBF_BULLETS.GENERAL_FRONTEND;
    } else if (company.includes("huber")) {
      if (primary === "SHOPIFY") {
        bullets = pickBullets(entry, ["customer journey", "product pages", "category", "cart", "checkout", "cms", "performance", "client"], 3);
      } else if (primary === "REACT_FRONTEND") {
        bullets = pickBullets(entry, ["ui components", "cms", "performance", "coordinating", "client"], 2);
      } else {
        bullets = pickBullets(entry, ["hyvä", "magento", "cms", "plp", "product pages", "checkout", "client", "lead"], 4);
      }
    } else if (company.includes("lufed")) {
      bullets = pickBullets(entry, primary === "MAGENTO_HYVA" ? ["architecture", "e-commerce", "cms", "performance"] : ["ui", "performance", "stakeholders"], primary === "MAGENTO_HYVA" ? 3 : 2);
    } else if (company.includes("cloudflight")) {
      bullets = pickBullets(entry, primary === "REACT_FRONTEND" ? ["ui components", "performance", "cross-functional"] : ["e-commerce", "storefront", "checkout", "cms"], 2);
    } else if (company.includes("3mk")) {
      bullets = pickBullets(entry, ["e-commerce", "ui", "ux", "conversion"], 2);
    } else if (company.includes("orba")) {
      bullets = pickBullets(entry, ["magento", "e-commerce", "performance"], 2);
    } else {
      bullets = bullets.slice(0, 2);
    }
    return {
      company: entry.company,
      role: entry.role,
      location: entry.location,
      dates: entry.dates,
      bullets
    };
  });
}

export function skillsMatchDomain(skills, primaryDomain) {
  const blob = (skills || []).map((s) => `${s.category} ${s.items}`).join(" ").toLowerCase();
  if (primaryDomain === "SHOPIFY") {
    if (!/\bshopify\b/.test(blob) || !/\bliquid\b/.test(blob)) return false;
    const magentoHits = countHits(blob, [/\bmagento\b/g, /\bhyv/g]);
    const shopifyHits = countHits(blob, [/\bshopify\b/g, /\bliquid\b/g]);
    if (magentoHits > shopifyHits) return false;
  }
  if (primaryDomain === "REACT_FRONTEND") {
    if (!/\breact\b/.test(blob)) return false;
    if (/\bshopify\b/.test(blob) && !/\breact\b/.test(blob)) return false;
  }
  if (primaryDomain === "MAGENTO_HYVA") {
    if (!/\bmagento\b/.test(blob) && !/\bhyv/.test(blob)) return false;
  }
  return true;
}

export function summaryMatchesDomain(summary, primaryDomain) {
  const s = normalize(summary);
  if (primaryDomain === "SHOPIFY") return s.includes("shopify");
  if (primaryDomain === "MAGENTO_HYVA") return /magento|hyv[aä]/.test(s);
  if (primaryDomain === "REACT_FRONTEND") return /react|next\.js/.test(s);
  if (primaryDomain === "FULLSTACK_TYPESCRIPT_NODE") return /fullstack|full-stack|typescript|node/.test(s);
  return true;
}

export class DomainValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "DomainValidationError";
    this.details = details;
  }
}

/**
 * Post-LLM gate: JD classification is authoritative.
 * Wrong project pools FAIL generation — they are not silently rewritten.
 */
export function domainConsistencyValidation(aiResult, job = {}, fullJd = "") {
  const classified = classifyDomain(job.title || job.role || "", fullJd, job.extra || "");
  const primary = classified.primary;
  const validation = validateDomainConsistency({
    primaryDomain: primary,
    projects: aiResult?.projects || [],
    jdText: `${job.title || job.role || ""}\n${fullJd}`
  });
  if (!validation.ok) {
    throw new DomainValidationError(
      `DOMAIN CONSISTENCY FAILED — PDF not generated. PRIMARY=${primary}. ${validation.reasons.join("; ")}`,
      { ...validation, classified, primaryDomain: primary, secondaryDomains: classified.secondary }
    );
  }
  return { ...validation, ok: true, classified, primaryDomain: primary, secondaryDomains: classified.secondary };
}

/**
 * Stamp the classified primary domain onto an LLM result after domainConsistencyValidation().
 * Does not rewrite project selection.
 */
export function enforceDomainConsistency(aiResult, job = {}, fullJd = "") {
  const check = domainConsistencyValidation(aiResult, job, fullJd);
  const primary = check.primaryDomain;
  const secondary = check.secondaryDomains;
  const projects = Array.isArray(aiResult?.projects) ? aiResult.projects : [];

  let summary = aiResult.summary;
  let skills = aiResult.skills;
  let headline = aiResult.headline;
  if (!summaryMatchesDomain(summary, primary)) {
    summary = summaryForDomain(primary);
    headline = headlineForDomain(primary);
  }
  if (!skillsMatchDomain(skills, primary)) {
    skills = skillsForDomain(primary);
  }

  const tailoring_diff = {
    ...(aiResult.tailoring_diff || {}),
    primary_domain: primary,
    secondary_domains: secondary
  };

  return {
    result: {
      ...aiResult,
      primary_domain: primary,
      secondary_domains: secondary,
      headline,
      summary,
      skills,
      projects,
      tailoring_diff
    },
    validation: check,
    classified: check.classified,
    corrected: false
  };
}

export function buildDomainDryRun(job = {}, experience = []) {
  const classified = classifyDomain(job.title || "", job.jd || job.extra || "", job.extra || "");
  const selected = selectProjectsForDomain(classified.primary, {
    title: job.title || "",
    jd: job.jd || "",
    company: job.company || ""
  });
  const structure = {
    primary_domain: classified.primary,
    secondary_domains: classified.secondary,
    headline: headlineForDomain(classified.primary),
    summary: summaryForDomain(classified.primary),
    skills: skillsForDomain(classified.primary),
    projects: selected.projects,
    experience: selectExperienceBulletsForDomain(classified.primary, experience)
  };
  const validation = validateDomainConsistency({
    primaryDomain: structure.primary_domain,
    projects: structure.projects,
    jdText: `${job.title || ""}\n${job.jd || ""}`
  });
  return { ...structure, classified, validation };
}

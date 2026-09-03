const RN_SENTINEL = " __REACT_NATIVE__ ";

const MOBILE_CORE = [
  /\breact[\s-]?native\b/i,
  /\bexpo\b/i,
  /\bflutter\b/i,
  /\bswift(?:ui)?\b/i,
  /\bkotlin\s+mobile\b/i,
  /\bmobile(?:\s+application|\s+app|\s+development|\s+engineer|\s+developer|\s+first)\b/i,
  /\b(?:native\s+)?(?:ios|android)\s+(?:and|&|\/|,)\s+(?:android|ios)\b/i,
  /\b(?:ios|android)\s+(?:developer|engineer|app|application|native|sdk)\b/i
];

const BACKEND_STACKS = [
  { id: "Java/Spring", patterns: [/\bjava\b(?!script)/i, /\bspring(?:\s+boot)?\b/i] },
  { id: "Kotlin", patterns: [/\bkotlin\b/i] },
  { id: ".NET/C#", patterns: [/\.net\b/i, /\bc#\b/i, /\basp\.net\b/i] },
  { id: "Python", patterns: [/\bpython\b/i, /\bdjango\b/i, /\bfastapi\b/i] },
  { id: "Go", patterns: [/\bgolang\b/i, /\bgo\s+(?:services?|microservices?|backend|developer|engineer|apis?)\b/i] },
  { id: "Ruby", patterns: [/\bruby\b/i, /\brails\b/i] },
  { id: "PHP", patterns: [/\bphp\b/i, /\blaravel\b/i, /\bsymfony\b/i] }
];

const OPTIONAL_CUE = /\b(optional|nice[ -]to[ -]have|preferred|bonus|advantage|(?:a|as a) plus|desirable|familiarity|exposure|mile widziane)\b/i;
const MANDATORY_CUE = /\b(must|required|requirements?|mandatory|essential|need(?:ed)?|at least|minimum|proficien(?:t|cy)|strong experience|expertise|commercial experience|you have|we expect|wymagan|bardzo dobra znajomość)\b/i;
const RESPONSIBILITY_CUE = /\b(build|develop|design|own|ownership|architect|maintain|deliver|implement|responsib|services?|apis?|microservices?|backend|frontend|user interface|web application)\b/i;
const FLUENT_LANG_CUE = /\b(c1|c2|fluent|fluency|native|mandatory|required|must|j\.\s*niemieckim|niemieckim|german-speaking|deutschkenntnisse)\b/i;

function occurrences(text, patterns) {
  return patterns.reduce((sum, pattern) => {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    return sum + (text.match(new RegExp(pattern.source, flags)) || []).length;
  }, 0);
}

function matchingClauses(text, patterns) {
  return String(text || "")
    .split(/\n|(?<=[.!?;])\s+/)
    .filter((clause) => patterns.some((pattern) => pattern.test(clause)));
}

function requirementSignal(title, description, patterns) {
  const titleHit = patterns.some((pattern) => pattern.test(title));
  const clauses = matchingClauses(description, patterns);
  const mandatory = titleHit || clauses.some((clause) => MANDATORY_CUE.test(clause) && !OPTIONAL_CUE.test(clause));
  const optionalOnly = !titleHit && clauses.length > 0 && clauses.every((clause) => OPTIONAL_CUE.test(clause));
  return { present: titleHit || clauses.length > 0, mandatory, optionalOnly, clauses };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function maskReactNative(text) {
  return String(text || "")
    .replace(/react(?:\.js|js)?\s*[+/&,]\s*react[\s-]?native/gi, RN_SENTINEL)
    .replace(/react[\s-]?native/gi, RN_SENTINEL);
}

function parseResponsibilityPercents(text) {
  const backendIds = "java|spring|kotlin|\\.net|c#|python|django|fastapi|golang|go|ruby|rails|php|backend";
  const frontendIds = "react|next\\.?js|typescript|frontend|front-end|front end";
  const pairs = [...String(text || "").matchAll(/(\d{1,3})\s*%\s*(?:[+\-/,&]?\s*)([A-Za-z.#]+(?:\s+[A-Za-z.#]+)?)/gi)];
  let backendPct = 0;
  let frontendPct = 0;
  for (const [, rawPct, rawLabel] of pairs) {
    const pct = Number(rawPct);
    const label = rawLabel.toLowerCase();
    if (new RegExp(`^(?:${backendIds})`).test(label)) backendPct = Math.max(backendPct, pct);
    if (new RegExp(`^(?:${frontendIds})`).test(label)) frontendPct = Math.max(frontendPct, pct);
  }
  return { backendPct, frontendPct };
}

function detectEcommerce(title, text) {
  const all = `${title}\n${text}`;
  const inTitle = (pattern) => pattern.test(title);
  const primaryMention = (pattern) => inTitle(pattern) || occurrences(all, [pattern]) >= 2;
  return unique([
    inTitle(/\bmagento|adobe commerce/i) || /\bmagento\s*2\b/i.test(all) || /adobe commerce/i.test(all) ? "Magento 2" : "",
    primaryMention(/\bhyv[aä]\b/i) ? "Hyvä" : "",
    primaryMention(/\bshopify(?:\s+plus)?\b/i) ? "Shopify" : "",
    /\bliquid\b/i.test(all) && /\b(shopify|theme|storefront)\b/i.test(all) ? "Liquid" : ""
  ]);
}

function detectLanguages(title, description) {
  const hay = `${title}\n${description}`;
  const specs = [
    ["German", /\b(?:german|deutsch|niemieckim|niemiecki)\b/i],
    ["Finnish", /\bfinnish\b/i],
    ["Swedish", /\bswedish\b/i],
    ["French", /\bfrench\b/i],
    ["Dutch", /\bdutch\b/i]
  ];
  return specs
    .map(([name, pattern]) => {
      const signal = requirementSignal(title, description, [pattern]);
      const titleFluent = pattern.test(title) && FLUENT_LANG_CUE.test(title);
      const clauseFluent = signal.clauses.some((clause) => FLUENT_LANG_CUE.test(clause) && !OPTIONAL_CUE.test(clause));
      const locationOnly = !titleFluent && !clauseFluent && !signal.mandatory;
      return {
        name,
        mandatory: (signal.mandatory && !signal.optionalOnly) || titleFluent || clauseFluent,
        optionalOnly: signal.optionalOnly && !titleFluent,
        locationOnly
      };
    })
    .filter((signal) => signal.mandatory);
}

function stackBits(textWithoutNative) {
  return {
    react: occurrences(textWithoutNative, [/\breact(?:\.js|js)?\b/i, /\breact\s+web\b/i]),
    next: occurrences(textWithoutNative, [/\bnext\.?(?:js)?\b/i]),
    ts: occurrences(textWithoutNative, [/\btypescript\b/i]),
    node: occurrences(textWithoutNative, [/\bnode\.?(?:js)?\b/i, /\bnest\.?(?:js)?\b/i])
  };
}

export function sanitizeJobDescription(text) {
  const raw = String(text || "");
  const cut = raw.search(/\b(similar offers|recommended by just join|oferty podobne)\b/i);
  return (cut === -1 ? raw : raw.slice(0, cut)).trim();
}

export function formatMatchReason(classification, reason, compatibilityPercent) {
  const pct = Number.isFinite(compatibilityPercent) ? ` | ${compatibilityPercent}% compatible` : "";
  return `${classification} Reason: ${reason}${pct}`;
}

/**
 * Explainable, deterministic first-pass ranking. Full JD text should be supplied
 * whenever available; title/location/extra remain a safe low-cost fallback.
 */
export function analyzeJobMatch(job, fullDescription = "") {
  const title = String(job?.title || "");
  const fallback = [job?.company, job?.location, job?.extra].filter(Boolean).join(". ");
  const description = sanitizeJobDescription(fullDescription || fallback);
  const allText = `${title}\n${description}`;
  const titleMasked = maskReactNative(title);
  const allMasked = maskReactNative(allText);
  const hasFullJd = String(fullDescription || "").trim().length >= 80;

  const nativeSignal = requirementSignal(title, description, MOBILE_CORE);
  const bits = stackBits(allMasked);
  const titleBits = stackBits(titleMasked);
  const frontendCount = occurrences(allMasked, [
    /\bfront[ -]?end\b/i, /\bweb application/i, /\buser interface/i, /\bui\b/i,
    /\bcomponent(?:s| library| system)?\b/i, /\bdesign system\b/i,
    /\baccessibilit/i, /\bcore web vitals\b/i, /\bseo\b/i,
    /\breact(?:\.js|js)?\b/i, /\bnext\.?(?:js)?\b/i, /\btypescript\b/i
  ]);

  const backendSignals = BACKEND_STACKS.map((stack) => ({
    ...stack,
    ...requirementSignal(title, description, stack.patterns),
    count: occurrences(allText, stack.patterns)
  })).filter((stack) => stack.present);
  const mandatoryBackend = backendSignals.filter((stack) => stack.mandatory && !stack.optionalOnly);
  const backendCount = backendSignals.reduce((sum, stack) => sum + stack.count, 0)
    + occurrences(allText, [/\bback[ -]?end\b/i, /\bmicroservices?\b/i, /\bserver[ -]?side\b/i, /\bdistributed systems?\b/i]);

  const ecommerce = detectEcommerce(title, description);
  const leadership = /\b(lead|technical lead|tech lead|team lead|staff|principal|architect)\b/i.test(title);
  const productEngineer = /\bproduct engineer/i.test(title);
  const frontendTitle = /\bfront[ -]?end|web (?:developer|engineer)|ui (?:developer|engineer|architect)\b/i.test(titleMasked)
    || (/\breact(?:\.js|js)?|next\.?(?:js)?\b/i.test(titleMasked) && !/__REACT_NATIVE__/i.test(maskReactNative(title)));
  const handsOnTechnicalTitle = /\b(developer|engineer|architect|programista|fejlesztő|technical lead|tech lead|product engineer)\b/i.test(title);
  const nonEngineeringTitle = /\b(qa|quality assurance|tester|analyst|analityk|project manager|delivery manager|product owner|coo|director|engineering manager)\b/i.test(title);
  const alternateFrontendTitle = /\b(vue(?:\.js)?|angular|svelte)\b/i.test(title) && !/\breact|next\.?(?:js)?\b/i.test(titleMasked);
  const fullstack = /\bfull[ -]?stack\b/i.test(allText);
  const explicitFrontendHeavy = /\b(frontend[ -](?:heavy|focused|leaning)|front[ -]?end focus|primarily front[ -]?end|mostly front[ -]?end|frontend-dominant)\b/i.test(allText);
  const pureBackendTitle = /\bbackend|back-end\b/i.test(title) && !/\bfront[ -]?end|react|next|full[ -]?stack\b/i.test(titleMasked);
  const backendOwnership = matchingClauses(description, [/\bmicroservices?\b/i, /\bback[ -]?end\b/i])
    .some((clause) => RESPONSIBILITY_CUE.test(clause) && !OPTIONAL_CUE.test(clause));
  const { backendPct, frontendPct } = parseResponsibilityPercents(allText);
  const percentBackendDominant = backendPct >= 50 && (frontendPct === 0 || frontendPct <= backendPct);
  const percentFrontendDominant = frontendPct >= 60 && frontendPct > backendPct;

  const mobileCount = occurrences(allText, MOBILE_CORE);
  const frontendDominance = explicitFrontendHeavy || percentFrontendDominant
    || frontendCount >= Math.max(3, backendCount * 1.5);
  const backendDominance = pureBackendTitle || backendOwnership || percentBackendDominant
    || backendCount >= Math.max(3, frontendCount * 1.25);
  const mobileInTitle = MOBILE_CORE.some((pattern) => pattern.test(title)) || /\bmobile\b/i.test(title);
  const mobileDominance = nativeSignal.mandatory || mobileInTitle || mobileCount >= Math.max(2, bits.react + bits.next);

  const languageSignals = detectLanguages(title, description);
  const nodeSignificant = bits.node >= 3 && !explicitFrontendHeavy && !frontendTitle;

  const strengths = [];
  const gaps = [];
  const missingMandatorySkills = [];
  if (bits.react) strengths.push("React web");
  if (bits.next) strengths.push("Next.js");
  if (bits.ts) strengths.push("TypeScript");
  if (frontendDominance) strengths.push("Frontend-dominant responsibilities");
  if (bits.node) strengths.push("Node.js-compatible fullstack");
  if (ecommerce.length) strengths.push(`${ecommerce.join(" + ")} commercial specialization`);
  if (leadership) strengths.push("Hands-on technical leadership");

  if (mobileDominance) {
    gaps.push("React Native / mobile-first responsibilities");
    missingMandatorySkills.push("Native mobile development");
  }
  if (mandatoryBackend.length) {
    const names = mandatoryBackend.map((stack) => stack.id);
    gaps.push(`${names.join(" + ")} backend mandatory`);
    missingMandatorySkills.push(...names);
  }
  if (backendDominance) gaps.push("Backend ownership is the primary responsibility");
  if (languageSignals.length) {
    const names = languageSignals.map((signal) => signal.name);
    gaps.push(`${names.join(" / ")} mandatory`);
    missingMandatorySkills.push(...names.map((name) => `${name} language`));
  }

  let classification = "POSSIBLE MATCH";
  let tier = "B";
  let compatibilityPercent = 58;
  let recommendation = "REVIEW";
  let reason = "Relevant engineering overlap, but the primary stack needs review";

  const webCore = Boolean(bits.react || bits.next);
  const webTs = Boolean(bits.ts);
  const frontendWebTitle = frontendTitle && webCore;
  const leadershipFrontend = (leadership || productEngineer) && webCore && frontendDominance && !backendDominance && !mobileDominance;
  const ecommerceHandsOn = ecommerce.length > 0 && !backendDominance && !nonEngineeringTitle && (handsOnTechnicalTitle || frontendDominance);
  const titleOnlyExplicitWeb = !hasFullJd && frontendTitle && titleBits.react && (titleBits.next || titleBits.ts) && !fullstack;
  const canBestMatch = !mobileDominance && !mandatoryBackend.length && !languageSignals.length && !backendDominance && !alternateFrontendTitle && !pureBackendTitle && !nonEngineeringTitle;

  if (mobileDominance) {
    classification = "SKIP";
    tier = "D";
    compatibilityPercent = nativeSignal.mandatory || mobileInTitle ? 12 : 20;
    recommendation = "SKIP";
    reason = "React Native / mobile-first";
  } else if (pureBackendTitle && bits.react + bits.next === 0) {
    classification = "SKIP";
    tier = "D";
    compatibilityPercent = 15;
    recommendation = "SKIP";
    reason = "Pure backend role; frontend web is incidental or absent";
  } else if (mandatoryBackend.length) {
    classification = "LOW MATCH";
    tier = "C";
    compatibilityPercent = backendDominance || percentBackendDominant ? 28 : 36;
    recommendation = "SKIP";
    reason = `${mandatoryBackend.map((stack) => stack.id).join(" + ")} backend mandatory | React secondary`;
  } else if (languageSignals.length) {
    classification = "LOW MATCH";
    tier = "C";
    compatibilityPercent = 30;
    recommendation = "SKIP";
    reason = `${languageSignals.map((signal) => signal.name).join(" / ")} language mandatory`;
  } else if (backendDominance && !explicitFrontendHeavy) {
    classification = "LOW MATCH";
    tier = "C";
    compatibilityPercent = 32;
    recommendation = "SKIP";
    reason = "Backend-dominant responsibilities | frontend secondary";
  } else if (alternateFrontendTitle) {
    classification = "LOW MATCH";
    tier = "C";
    compatibilityPercent = 38;
    recommendation = "REVIEW";
    reason = "Primary frontend framework is not React / Next.js";
  } else if (canBestMatch && ecommerceHandsOn) {
    classification = "BEST MATCH";
    tier = "A";
    compatibilityPercent = Math.min(98, 90 + ecommerce.length * 2);
    recommendation = "APPLY";
    reason = `${ecommerce.join(" + ")} | direct commercial specialization`;
  } else if (canBestMatch && (explicitFrontendHeavy || frontendWebTitle || leadershipFrontend || titleOnlyExplicitWeb) && webCore && (webTs || bits.next || ecommerce.length || frontendDominance)) {
    classification = "BEST MATCH";
    tier = "A";
    compatibilityPercent = 92;
    recommendation = "APPLY";
    const stack = unique([
      bits.react ? "React" : "",
      bits.next ? "Next.js" : "",
      bits.ts ? "TypeScript" : "",
      bits.node ? "Node.js" : ""
    ]).join(" + ");
    reason = `${stack || "React / TypeScript web"} | frontend-dominant`;
  } else if (canBestMatch && fullstack && webCore && bits.node) {
    classification = explicitFrontendHeavy ? "BEST MATCH" : "STRONG MATCH";
    tier = "A";
    compatibilityPercent = explicitFrontendHeavy ? 90 : 82;
    recommendation = "APPLY";
    reason = `React${bits.next ? " + Next.js" : ""} + Node.js | ${explicitFrontendHeavy ? "frontend-dominant" : "compatible TypeScript fullstack"}`;
  } else if (canBestMatch && webCore && webTs && !fullstack) {
    classification = "BEST MATCH";
    tier = "A";
    compatibilityPercent = 92;
    recommendation = "APPLY";
    reason = `${unique([bits.react ? "React" : "", bits.next ? "Next.js" : "", "TypeScript"]).join(" + ")} | frontend-dominant`;
  } else if ((frontendTitle || productEngineer || leadership) && (webCore || webTs) && !backendDominance && !mobileDominance && !mandatoryBackend.length) {
    classification = webCore && webTs ? "STRONG MATCH" : "POSSIBLE MATCH";
    tier = classification === "STRONG MATCH" ? "A" : "B";
    compatibilityPercent = classification === "STRONG MATCH" ? (nodeSignificant ? 78 : 80) : 66;
    recommendation = classification === "STRONG MATCH" ? "APPLY" : "REVIEW";
    reason = `${leadership ? "Hands-on frontend leadership" : "Frontend/product engineering"} | core web overlap`;
  } else if (ecommerce.length || frontendTitle || productEngineer || (leadership && frontendDominance)) {
    classification = "POSSIBLE MATCH";
    tier = "B";
    compatibilityPercent = nonEngineeringTitle ? 55 : 68;
    recommendation = "REVIEW";
    reason = ecommerce.length
      ? `${ecommerce.join(" + ")} domain overlap | role is not clearly hands-on frontend engineering`
      : "Relevant frontend/product title | full stack evidence needs review";
  }

  const primaryStack = unique([
    ...ecommerce,
    bits.react ? "React" : "",
    bits.next ? "Next.js" : "",
    bits.ts ? "TypeScript" : "",
    bits.node ? "Node.js" : "",
    ...backendSignals.map((stack) => stack.id),
    mobileDominance ? "Mobile" : ""
  ]);
  const fitScore = Math.round((1 + compatibilityPercent / 25) * 10) / 10;
  const reasonDisplay = formatMatchReason(classification, reason, compatibilityPercent);

  return {
    fitScore: Math.min(5, fitScore),
    compatibilityPercent,
    matchClassification: classification,
    compatibilityTier: tier,
    recommendation,
    reason,
    reasonDisplay,
    strengths: unique(strengths),
    gaps: unique(gaps),
    missingMandatorySkills: unique(missingMandatorySkills),
    primaryStack,
    responsibilitySplit: {
      frontend: frontendDominance && backendDominance ? "mixed" : frontendDominance ? "dominant" : backendDominance ? "secondary" : "mixed/unknown",
      backend: frontendDominance && backendDominance ? "mixed" : backendDominance ? "dominant" : frontendDominance ? "secondary" : "mixed/unknown",
      platform: mobileDominance ? "mobile" : "web"
    },
    signals: {
      reactWebCount: bits.react,
      reactNativeOrMobileCount: mobileCount,
      frontendCount,
      backendCount,
      backendPct,
      frontendPct,
      mandatoryBackend: mandatoryBackend.map((stack) => stack.id),
      mandatoryLanguages: languageSignals.map((signal) => signal.name),
      requiredYears: unique([...allText.matchAll(/\b(\d{1,2})\+?\s+years?(?:\s+of)?\s+(?:commercial |professional |relevant )?experience\b/gi)].map((match) => Number(match[1]))).sort((a, b) => b - a)
    },
    evaluatedFrom: hasFullJd ? "full-jd" : "pipeline-summary",
    evaluatedAt: new Date().toISOString()
  };
}

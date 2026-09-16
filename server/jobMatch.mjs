import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { getCareerOpsRoot } from "../path-resolver.mjs";

let policyCache;
function rankingPolicy() {
  const file = path.join(getCareerOpsRoot(), "config/profile.yml");
  const stamp = fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0;
  if (policyCache?.file !== file || policyCache?.stamp !== stamp) {
    const profile = stamp ? yaml.load(fs.readFileSync(file, "utf8")) : {};
    policyCache = { file, stamp, value: profile?.evaluation_rules?.frontend_ranking || null };
  }
  return policyCache.value;
}

const RN_SENTINEL = " __REACT_NATIVE__ ";

export function jobMatchPolicyKey() {
  return JSON.stringify(rankingPolicy());
}

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
  { id: "Go", patterns: [/\bGo\b/, /\bgolang\b/i, /\bgo\s+(?:services?|microservices?|backend|developer|engineer|apis?)\b/i] },
  { id: "Salesforce/Apex", patterns: [/\bapex\b/i, /\blwc\b/i] },
  { id: "Ruby", patterns: [/\bruby\b/i, /\brails\b/i] },
  { id: "PHP", patterns: [/\bphp\b/i, /\blaravel\b/i, /\bsymfony\b/i] }
];

const WEB_APP_FRONTEND_TITLES = [
  /\b(?:senior\s+|lead\s+|staff\s+|principal\s+)?web\s+application\s+(?:developer|engineer)\b/i,
  /\b(?:senior\s+|lead\s+|staff\s+|principal\s+)?web\s+(?:software\s+)?(?:developer|engineer)\b/i,
  /\b(?:senior\s+|lead\s+|staff\s+|principal\s+)?ui\s+(?:developer|engineer|architect)\b/i,
  /\b(?:senior\s+|lead\s+|staff\s+|principal\s+)?application\s+engineer\s*(?:[-–—/]\s*react|\(react\)|\s+react\b)/i,
  /\b(?:senior\s+|lead\s+|staff\s+|principal\s+)?product\s+engineer\s*(?:[-–—/]\s*react|\(react\)|\s+react\b)/i,
  /\b(?:senior\s+|lead\s+|staff\s+|principal\s+)?front[ -]?end\s+application\s+(?:developer|engineer)\b/i
];

const STRONG_FRONTEND_EVIDENCE_PATTERNS = [
  /\breact(?:\.js|js)?\b/i,
  /\btypescript\b/i,
  /\bjavascript\b/i,
  /\bcomplex\s+web\s+apps?(?:lications?)?\b/i,
  /\binteractive\s+(?:ui|user\s+interfaces?)\b/i,
  /\b(?:application\s+state|state\s+management)\b/i,
  /\bcomponent\s+(?:architecture|patterns?|system|librar)/i,
  /\bfront[ -]?end\s+integrations?\b/i,
  /\b(?:browser|client[ -]side)\s+(?:logic|performance|architecture|applications?)\b/i,
  /\bproduct\s+(?:ui|work)\b/i
];

const OPTIONAL_CUE = /\b(optional|nice[ -]to[ -]have|preferred|bonus|advantage|(?:a|as a) plus|desirable|familiarity|exposure|good to have|w(?:u|ü)nschenswert|von vorteil|basic|fundamental(?:s)?)\b|mile\s+widziane|dodatkowym\s+atutem|atutem\s+b(?:e|ę)dzie|dobrze,?\s+je(?:s|ś)li|opcjonalnie|podstawowa\s+znajomo(?:s|ś)(?:ć|c)|znajomo(?:s|ś)(?:ć|c)\s+podstaw|podstawy|familiar\s+with|awareness\s+of/i;
const MANDATORY_CUE = /\b(must|required|requirements?|mandatory|essential|need(?:ed)?|at least|minimum|proficien(?:t|cy)|strong experience|expertise|commercial experience|you have|we expect|wymagan|bardzo dobra znajomość)\b/i;
const OPTIONAL_SECTION_HEADING = /^(?:optional|nice[ -]to[ -]have|preferred(?:\s+skills|\s+qualifications|\s+only)?|bonus(?:\s+points)?|good[ -]to[ -]have|advantage|desirable|additional\s+(?:assets|skills)|mile\s+widziane|dodatkowym\s+atutem|atutem\s+b(?:e|ę)dzie|dobrze,?\s+je(?:s|ś)li|opcjonalnie|w(?:u|ü)nschenswert|von\s+vorteil)\b/i;
const SECTION_HEADING = /^(?:(?:core\s+)?mandatory\s+)?(?:requirements?|qualifications?|responsibilities?|what you(?:'|’)ll do|your role|skills?|technologies?|wymagania|obowi(?:ą|a)zki|zakres obowi(?:ą|a)zk(?:o|ó)w|do(?:s|ś)wiadczenie|umiej(?:ę|e)tno(?:s|ś)ci|mile\s+widziane|dodatkowym\s+atutem|atutem\s+b(?:e|ę)dzie|opcjonalnie|w(?:u|ü)nschenswert|von\s+vorteil)\b/i;
const RESPONSIBILITY_CUE = /\b(build|develop|design|own|ownership|architect|maintain|deliver|implement|responsib|services?|apis?|microservices?|server[ -]?side|backend architecture|backend systems?)\b|(?:rozw(?:o|ó)j|tworzenie|implementacja|projektowanie|utrzymanie|budowa|w(?:d|y)ro(?:z|ż)enie|tworzenie)\s+(?:backendu|us(?:l|ł)ug backendowych|api|mikroserwis(?:o|ó)w)/i;
const BACKEND_OWNERSHIP_CUE = /\b(build|develop|design|own|ownership|architect|maintain|implement|create|write|deliver|responsib|services?|apis?|microservices?|server[ -]?side|backend architecture|backend systems?)\b|(?:rozw(?:o|ó)j|tworzenie|implementacja|projektowanie|utrzymanie|budowa|w(?:d|y)ro(?:z|ż)enie)\s+(?:backendu|us(?:l|ł)ug backendowych|api|mikroserwis(?:o|ó)w)/i;
const BACKEND_COLLABORATION_CUE = /\b(collaborat(?:e|ion)|cooperat(?:e|ion)|work(?:s|ing)?\s+with|coordinate|support|integrat(?:e|ion)\s+with|consum(?:e|ing)|communicat(?:e|ion)\s+with)\b|wsp(?:o|ó)(?:l|ł)prac(?:a|y|uj)|integracj(?:a|e|i)\s+(?:z|ze)|komunikacj(?:a|e)\s+z|wsp(?:o|ó)(?:l|ł)prac(?:a|y|uj)\s+z/i;
const LIGHT_BACKEND_CUE = /\b(light|minor|small|limited|basic|fundamental|fundamentals?|familiarity|exposure)\b|podstaw(?:owa|y)|niewielk/i;
const API_INTEGRATION_CUE = /(?:rest\s+|graphql\s+)?api\s+integration|(?:rest|graphql|oauth|jwt)\s+(?:api\s+)?integration|connect\s+client[ -]side|consum(?:e|ing)\s+backend|integrat(?:e|ion|ing)\s+(?:with\s+)?(?:backend|microservices)|front[ -]?end\s+integrations?|integracj(?:a|e|i)\s+(?:z|ze)?\s*(?:usługami\s+)?rest\s*api/i;
const FRONTEND_ACTION = /(?:build|design|develop|maintain|implement|deliver|optimi[sz]e).{0,100}(?:front[ -]?end|web app|client[ -]side|interfaces?|ui\b|components?)|front[ -]?end\s+(?:architecture|sdk|testing|integrations?)|component\s+(?:architecture|patterns|librar)|design\s+systems?|(?:client[ -]side|browser)\s+(?:performance|logic)|core web vitals|accessibilit|wcag|ui\/ux|ux\/ui|interactive\s+ui|complex\s+web\s+apps?(?:lications?)?|application\s+state|product\s+(?:ui|work)|aplikacj.{0,10}frontendow|rozwiązań frontendowych|dostępnych interfejsów|wydajności aplikacji/i;
const DIRECT_BACKEND_ACTION = /(?:build|develop|design|own|architect|maintain|implement|create|write|deliver)\w*\s+(?:(?:the|our|scalable|distributed|robust|secure|new)\s+)*(?:backend|back-end|server[ -]side|node(?:\.js)?|nestjs|java|spring|python|go\b|microservices|(?:rest\s+)?apis?\b)|(?:mandatory|required).{0,30}ownership.{0,30}backend|backend\s+(?:ownership|architecture)|(?:rozwój|tworzenie|projektowanie|utrzymanie|budowa)\s+(?:backendu|usług backendowych|mikroserwisów)/i;
const FLUENT_LANG_CUE = /\b(c1|c2|fluent|fluency|native|mandatory|required|must|j\.\s*niemieckim|niemieckim|german-speaking|deutschkenntnisse)\b/i;

function occurrences(text, patterns) {
  return patterns.reduce((sum, pattern) => {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    return sum + (text.match(new RegExp(pattern.source, flags)) || []).length;
  }, 0);
}

function clauseEntries(text) {
  let optionalSection = false;
  // Restore headings in flattened browser text before assigning optionality.
  const normalized = String(text || "")
    .replace(/(Responsibilities|Requirements|Qualifications|Nice[ -]to[ -]have|Preferred(?:\s+Skills|\s+Qualifications|\s+only)?|Bonus(?:\s+Points)?|What [Yy]ou[’']ll [Dd]o|What [Ww]e[’']re [Ll]ooking [Ff]or|You're ideal for this role if you have|It is a strong plus if you have)/g, "\n$1:\n")
    .replace(/(Mile widziane|Twój wkład do projektu|Realizację projektu ułatwi Ci|Bonus Points[^?]*\?|What You’ll Be Doing|What We’re Looking For|Why You’ll Love It Here)/g, "\n$1\n")
    .replace(/([a-z)])(?=(?:Build|Develop|Design|Create|Maintain|Integrate|Collaborate|Strong|Experience|Solid|Hands-on|Good|Ability|Upper-intermediate|Familiarity|Knowledge)\b)/g, "$1\n")
    .replace(/([.!?])(?=[A-Z][a-z])/g, "$1\n")
    .replace(/([a-ząćęłńóśźż)])(?=(?:Doświadczenie|Znajomość|Praktyczna|Podstawowa|Wiedza|Projektowanie|Tworzenie|Współpraca|Optymalizacja|Budowanie|Dbanie)\b)/g, "$1\n");
  return normalized.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    const headingText = trimmed.replace(/^[#>*\-\s]+/, "").replace(/[:：].*$/, "").trim();
    if (/^(?:Twój wkład|Realizację projektu|What you[’']ll|What we[’']re|Why You’ll|You're ideal)/i.test(headingText)) optionalSection = false;
    if (/^It is a strong plus/i.test(headingText)) optionalSection = true;
    if ((SECTION_HEADING.test(headingText) && !/^(?:doświadczenie|umiejętności)\s+\S/i.test(headingText)) || OPTIONAL_SECTION_HEADING.test(headingText)) {
      optionalSection = OPTIONAL_SECTION_HEADING.test(headingText);
      const inline = trimmed.replace(/^[#>*\-\s]+/, "").replace(/^[^:：]+[:：]/, "").trim();
      if (!inline || !/[:：]/.test(trimmed)) return [];
    }
    return trimmed.split(/(?<=[.!?;])\s+|\s+(?:and|but)\s+(?=(?:own|build|develop|maintain|implement)\b)/i).filter(Boolean).map((clause) => ({ text: clause, optionalSection }));
  });
}

function matchingClauses(text, patterns) {
  return clauseEntries(text)
    .filter(({ text: clause }) => patterns.some((pattern) => pattern.test(clause)))
    .map(({ text: clause }) => clause);
}

function requirementSignal(title, description, patterns) {
  const titleHit = patterns.some((pattern) => pattern.test(title));
  const entries = clauseEntries(description).filter(({ text: clause }) => patterns.some((pattern) => pattern.test(clause)));
  const clauses = entries.map(({ text: clause }) => clause);
  const mandatory = titleHit || entries.some(({ text: clause, optionalSection }) => !optionalSection && MANDATORY_CUE.test(clause) && !OPTIONAL_CUE.test(clause));
  const optionalOnly = !titleHit && entries.length > 0 && entries.every(({ text: clause, optionalSection }) => optionalSection || OPTIONAL_CUE.test(clause) || BACKEND_COLLABORATION_CUE.test(clause));
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
    next: occurrences(textWithoutNative, [/\bnext\.?js\b/i]),
    ts: occurrences(textWithoutNative, [/\btypescript\b/i]),
    node: occurrences(textWithoutNative, [/\bnode\.?(?:js)?\b/i, /\bnest\.?(?:js)?\b/i])
  };
}

export function sanitizeJobDescription(text) {
  const raw = String(text || "");
  const cut = raw.search(/similar offers|recommended by just join|oferty podobne/i);
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
    /\bcomponent(?:s| library| system)?\b/i, /\bdesign system\b/i, /\bdesign systems?\b/i,
    /\baccessibilit|wcag|wai-aria/i, /\bcore web vitals\b/i, /\bseo\b/i,
    /\bunit(?:y)?\s*(?:\/|and|&)\s*integration testing\b/i, /\bfrontend testing\b/i,
    /\b(browser|chrome devtools|performance|code quality|rest api integration)\b/i,
    /\b(aplikacj(?:e|i) frontendow|rozw(?:o|ó)j frontendu|rozwi(?:ą|a)zania frontendowe|interfejsy|dost(?:e|ę)pno(?:s|ś)(?:c|ć)|wydajno(?:s|ś)(?:c|ć) aplikacji internetowych|tworzenie komponent(?:o|ó)w|testy frontendowe|integracja rest api|jako(?:s|ś)(?:c|ć) kodu frontendowego)\b/i,
    /\bcomplex\s+web\s+apps?(?:lications?)?|interactive\s+ui|application\s+state|front[ -]?end\s+integrations?|client[ -]side\s+logic|product\s+ui\b/i,
    /\breact(?:\.js|js)?\b/i, /\bnext\.?(?:js)?\b/i, /\btypescript\b/i, /\bjavascript\b/i
  ]);

  const backendSignals = BACKEND_STACKS.map((stack) => ({
    ...stack,
    ...requirementSignal(title, description, stack.patterns),
    count: occurrences(allText, stack.patterns)
  })).filter((stack) => stack.present);
  const backendTechPattern = /\b(?:node(?:\.js)?|nestjs|java|spring|kotlin|\.net|c#|python|django|fastapi|golang|go|ruby|rails|php|laravel|symfony|back[ -]?end|microservices?|server[ -]?side|apis?)\b/i;
  const backendEntries = clauseEntries(description).filter(({ text: clause }) => backendTechPattern.test(clause));
  const backendCollaborationSignals = backendEntries
    .filter(({ text: clause }) => BACKEND_COLLABORATION_CUE.test(clause) || API_INTEGRATION_CUE.test(clause) || /work alongside backend/i.test(clause))
    .map(({ text: clause }) => clause);
  const backendOwnershipSignals = backendEntries
    .filter(({ text: clause, optionalSection }) => !optionalSection && !OPTIONAL_CUE.test(clause) && !LIGHT_BACKEND_CUE.test(clause)
      && (DIRECT_BACKEND_ACTION.test(clause) || (BACKEND_STACKS.some(stack => stack.patterns.some(p => p.test(clause))) && BACKEND_OWNERSHIP_CUE.test(clause) && MANDATORY_CUE.test(clause)))
      && !BACKEND_COLLABORATION_CUE.test(clause) && !API_INTEGRATION_CUE.test(clause) && !/work alongside backend/i.test(clause))
    .map(({ text: clause }) => clause);
  const backendMandatoryDevelopmentCount = backendOwnershipSignals.length;
  const backendOptionalCount = backendEntries.filter(({ text: clause, optionalSection }) => optionalSection || OPTIONAL_CUE.test(clause)).length;
  const backendCollaborationCount = backendCollaborationSignals.length;
  const mandatoryBackend = backendSignals.filter((stack) =>
    (stack.mandatory || backendOwnershipSignals.some(clause => stack.patterns.some(pattern => pattern.test(clause)))) && !stack.optionalOnly
    && ((/full[ -]?stack|back[ -]?end/i.test(title) && stack.patterns.some(pattern => pattern.test(title)))
      || backendOwnershipSignals.some((clause) => stack.patterns.some((pattern) => pattern.test(clause)))
      || clauseEntries(description).some(({ text: clause, optionalSection }) => !optionalSection && MANDATORY_CUE.test(clause)
        && stack.patterns.some(pattern => pattern.test(clause)) && !OPTIONAL_CUE.test(clause)
        && !BACKEND_COLLABORATION_CUE.test(clause) && !API_INTEGRATION_CUE.test(clause)))
  );
  // Weighted signals: optional technologies and collaboration are context, not
  // ownership. Raw PHP/Go/backend mention counts never drive dominance.
  const backendCount = backendMandatoryDevelopmentCount * 3 + backendOptionalCount * 0.15;

  const ecommerce = detectEcommerce(title, description);
  const leadership = /\b(lead|technical lead|tech lead|team lead|staff|principal|architect)\b/i.test(title);
  const webAppTitle = WEB_APP_FRONTEND_TITLES.some((p) => p.test(titleMasked));
  const productEngineer = /\bproduct engineer/i.test(title);
  const explicitReactInTitle = /\breact(?:\.js|js)?|next\.?(?:js)?\b/i.test(titleMasked) && !/__REACT_NATIVE__/i.test(maskReactNative(title));
  const frontendTitle = /\bfront[ -]?end|web (?:developer|engineer)|ui (?:developer|engineer|architect)\b/i.test(titleMasked)
    || explicitReactInTitle
    || webAppTitle;
  const handsOnTechnicalTitle = /\b(developer|engineer|architect|programista|fejlesztő|technical lead|tech lead|product engineer)\b/i.test(title);
  const nonEngineeringTitle = /\b(qa|quality assurance|tester|analyst|analityk|project manager|delivery manager|product owner|coo|director|engineering manager)\b/i.test(title);
  const alternateFrontendTitle = /\b(vue(?:\.js)?|angular|svelte)\b/i.test(title) && !/\breact|next\.?(?:js)?\b/i.test(titleMasked);
  const fullstack = /\bfull[ -]?stack\b/i.test(title);
  const dedicatedFrontendTitle = /\b(?:senior\s+|lead\s+|staff\s+|principal\s+|mid\s+)?(?:front[ -]?end\s+(?:developer|engineer|architect|lead|specialist)|(?:react|next\.?(?:js)?)\s+(?:developer|engineer))\b/i.test(titleMasked);
  const pureFrontendTitle = (dedicatedFrontendTitle || (frontendTitle && !webAppTitle && !productEngineer))
    && !fullstack && !/\b(?:backend|back-end|node(?:\.js)?)\s+(?:developer|engineer)/i.test(title);
  const explicitFrontendHeavy = /\b(frontend[ -](?:heavy|focused|leaning)|front[ -]?end focus|primarily front[ -]?end|mostly front[ -]?end|frontend-dominant)\b/i.test(allText);
  const pureBackendTitle = /\bbackend|back-end\b/i.test(title) && !/\bfront[ -]?end|react|next|full[ -]?stack\b/i.test(titleMasked);
  const backendOwnership = backendMandatoryDevelopmentCount > 0;
  const { backendPct, frontendPct } = parseResponsibilityPercents(allText);
  const percentBackendDominant = backendPct >= 50 && (frontendPct === 0 || frontendPct <= backendPct);
  const percentFrontendDominant = frontendPct >= 60 && frontendPct > backendPct;

  const nonOptionalEntries = clauseEntries(description).filter(({ optionalSection }) => !optionalSection);
  const strongFrontendHits = STRONG_FRONTEND_EVIDENCE_PATTERNS.filter((pattern) =>
    nonOptionalEntries.some(({ text }) => pattern.test(text))
  );
  const jdConfirmsReactWebUi = (bits.react > 0 || bits.next > 0)
    && (strongFrontendHits.length >= 2 || occurrences(allMasked, [/\bcomplex\s+web\s+apps?(?:lications?)?|interactive\s+ui|application\s+state|front[ -]?end\s+integrations?|client[ -]side\s+logic|product\s+ui\b/i]) > 0);

  const mobileCount = occurrences(allText, MOBILE_CORE);
  const frontendEvidencePattern = /(?:complex\s+web\s+apps?(?:lications?)?|interactive\s+(?:ui|user\s+interfaces?)|application\s+state|state\s+management|component\s+(?:architecture|patterns?)|front[ -]?end\s+integrations?|(?:browser|client[ -]side)\s+logic|product\s+(?:ui|work))/i;
  const frontendActions = clauseEntries(description).filter(({ text, optionalSection }) => !optionalSection && (
    FRONTEND_ACTION.test(text)
    || API_INTEGRATION_CUE.test(text)
    || frontendEvidencePattern.test(text)
    || /front[ -]?end web applications|(?:build|develop).{0,50}(?:storefront|themes)/i.test(text)
  ));
  const frontendOwnershipScore = frontendActions.length * 3 + (strongFrontendHits.length >= 3 ? 3 : 0);
  const backendDominanceScore = backendMandatoryDevelopmentCount * 3 + (percentBackendDominant ? 5 : 0);
  const hasStrongFrontendEvidence = !percentBackendDominant && (
    explicitFrontendHeavy || percentFrontendDominant
    || (webAppTitle && jdConfirmsReactWebUi && backendMandatoryDevelopmentCount === 0)
    || (strongFrontendHits.length >= 3 && (bits.react > 0 || bits.next > 0) && backendMandatoryDevelopmentCount === 0)
  );
  const frontendDominance = !percentBackendDominant && (
    hasStrongFrontendEvidence
    || frontendOwnershipScore >= Math.max(3, backendDominanceScore * 1.5)
  );
  const heavyBackendOwnership = backendOwnershipSignals.some(clause => /backend architecture|distributed (?:services|systems|microservices)|heavy.{0,20}(?:node|backend)/i.test(clause));
  const backendDominance = pureBackendTitle || heavyBackendOwnership || (backendOwnership && !frontendDominance) || percentBackendDominant
    || (backendMandatoryDevelopmentCount >= 2 && backendDominanceScore >= frontendOwnershipScore * 1.25);
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
  if (bits.node && explicitFrontendHeavy) strengths.push("Node.js secondary scope");
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
  if (backendOptionalCount > 0 && backendSignals.length > 0) {
    gaps.push(`Preferred ${backendSignals.map((stack) => stack.id).join(" / ")} backend knowledge`);
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
  } else if (canBestMatch && !webAppTitle && (explicitFrontendHeavy || frontendWebTitle || leadershipFrontend || titleOnlyExplicitWeb) && webCore && (webTs || bits.next || ecommerce.length || frontendDominance)) {
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
  } else if (canBestMatch && webCore && webTs && !fullstack && !webAppTitle) {
    classification = "BEST MATCH";
    tier = "A";
    compatibilityPercent = 92;
    recommendation = "APPLY";
    reason = `${unique([bits.react ? "React" : "", bits.next ? "Next.js" : "", "TypeScript"]).join(" + ")} | frontend-dominant`;
  } else if ((frontendTitle || productEngineer || leadership || webAppTitle) && (webCore || webTs) && !backendDominance && !mobileDominance && !mandatoryBackend.length) {
    classification = webCore && webTs ? "STRONG MATCH" : "POSSIBLE MATCH";
    tier = classification === "STRONG MATCH" ? "A" : "B";
    compatibilityPercent = classification === "STRONG MATCH" ? (webAppTitle ? 84 : nodeSignificant ? 78 : 80) : 66;
    recommendation = classification === "STRONG MATCH" ? "APPLY" : "REVIEW";
    reason = `${webAppTitle ? "Frontend-dominant web application engineering" : leadership ? "Hands-on frontend leadership" : "Frontend/product engineering"} | core web overlap`;
  } else if (ecommerce.length || frontendTitle || productEngineer || (leadership && frontendDominance)) {
    classification = "POSSIBLE MATCH";
    tier = "B";
    compatibilityPercent = nonEngineeringTitle ? 55 : 68;
    recommendation = "REVIEW";
    reason = ecommerce.length
      ? `${ecommerce.join(" + ")} domain overlap | role is not clearly hands-on frontend engineering`
      : "Relevant frontend/product title | full stack evidence needs review";
  }

  const policy = rankingPolicy();
  let scoreBreakdown;
  let rankingCategory = mobileDominance ? "mobile" : backendDominance ? "backend-heavy" : "unconfirmed";
  if (policy?.enabled) {
    const nodeTitle = /\b(?:node\.?js|nestjs)\b/i.test(title) && !fullstack && !pureFrontendTitle;
    const mixed = fullstack || backendOwnership || nodeTitle;
    const confirmedFrontend = frontendDominance && (frontendActions.length > 0 || strongFrontendHits.length >= 2) && (webCore || ecommerceHandsOn) && !nonEngineeringTitle;
    const primary = confirmedFrontend && !mixed;
    const frontendHeavy = mixed && confirmedFrontend && !backendDominance;
    rankingCategory = mobileDominance ? "mobile" : backendDominance || nodeTitle ? "backend-heavy"
      : primary ? (pureFrontendTitle ? "pure-frontend" : "frontend-dominant-web")
      : frontendHeavy ? "frontend-heavy-fullstack"
      : fullstack ? "balanced-fullstack" : "unconfirmed";
    const quality = [/front[ -]?end architecture|component|design system|frontend sdk/i,
      /performance|core web vitals|wydajności|scalable web|complex\s+web\s+app/i,
      /test|playwright|wcag|accessibilit|figma|ui\/ux|ux\/ui|interactive\s+ui/i].filter(p => p.test(description)).length / 3;
    const domain = ecommerce.length > 0 || /e-commerce|ecommerce|commerce workflows|headless commerce|high[ -]traffic/i.test(description);
    const optionalOverlap = clauseEntries(description).filter(e => e.optionalSection || OPTIONAL_CUE.test(e.text))
      .some(e => /storybook|playwright|design system|headless commerce|figma|testing/i.test(e.text));
    const corePoints = Math.min(25, (webCore ? 14 : ecommerceHandsOn ? 18 : 0) + (bits.ts ? 5 : 0)
      + (bits.react && bits.next ? 3 : 0) + [/javascript/i, /\bcss\b/i, /\bhtml\b/i].filter(p => p.test(description)).length);
    const fractions = {
      // 30 points for a pure primary title, 27 for web application / frontend-adjacent title, plus JD-confirmed scope.
      primaryRole: primary ? (pureFrontendTitle ? 1 : 0.9) : frontendHeavy ? 0.9 : fullstack ? (frontendActions.length ? 0.65 : 0.5) : pureFrontendTitle ? 2 / 3 : 0.2,
      coreStack: corePoints / 25,
      responsibilities: confirmedFrontend ? 1 : fullstack && frontendActions.length ? 0.65 : 0.5,
      architecturePerformanceQuality: Math.max(0.5, quality),
      domain: domain ? 1 : 0.5,
      seniority: /senior|lead|principal|staff/i.test(title) ? 1 : /junior/i.test(title) ? 0.4 : 0.8,
      niceToHave: optionalOverlap ? 1 : 0.5
    };
    const defaults = { primaryRole: 30, coreStack: 25, responsibilities: 20, architecturePerformanceQuality: 10, domain: 5, seniority: 5, niceToHave: 5 };
    const weights = { ...defaults, ...policy.weights };
    scoreBreakdown = Object.fromEntries(Object.entries(fractions).map(([key, fraction]) => [key, {
      weight: weights[key], earned: Math.round(weights[key] * fraction * 10) / 10
    }]));
    const rawScore = Math.round(Object.values(scoreBreakdown).reduce((sum, part) => sum + part.earned, 0));
    const ceilings = { pureFrontend: 98, webApplication: 88, frontendHeavyFullstack: 89, balancedFullstack: 78, nodeHeavy: 60, unconfirmed: 79, ...policy.ceilings };
    const blocked = mobileDominance || mandatoryBackend.length || languageSignals.length || alternateFrontendTitle || pureBackendTitle
      || (backendDominance && !(backendPct === 50 && frontendPct === 50 && !heavyBackendOwnership));
    if (!blocked) {
      const cap = (primary && pureFrontendTitle) ? ceilings.pureFrontend
        : (primary && webAppTitle) ? (ceilings.webApplication || 88)
        : primary ? ceilings.pureFrontend
        : frontendHeavy ? ceilings.frontendHeavyFullstack
        : nodeTitle ? ceilings.nodeHeavy : fullstack ? ceilings.balancedFullstack : ceilings.unconfirmed;
      compatibilityPercent = Math.min(pureFrontendTitle && webCore ? Math.max(60, rawScore) : rawScore, cap);
      const canBestMatchRole = primary && pureFrontendTitle && !webAppTitle;
      classification = canBestMatchRole && compatibilityPercent >= 85 ? "BEST MATCH"
        : compatibilityPercent >= 80 ? "STRONG MATCH" : compatibilityPercent >= 60 ? "POSSIBLE MATCH" : "LOW MATCH";
      recommendation = compatibilityPercent >= 80 ? "APPLY" : "REVIEW";
      tier = compatibilityPercent >= 80 ? "A" : compatibilityPercent >= 60 ? "B" : "C";
      reason = `${rankingCategory.replaceAll("-", " ")} | ${primary ? (webAppTitle ? "frontend-dominant web application role; core web and React scope aligned" : "primary frontend title and JD scope aligned") : frontendHeavy ? "frontend-first; Node/backend is secondary" : "scope or stack needs review"}`;
    } else if (backendDominance && bits.node && !mandatoryBackend.length && !mobileDominance && !languageSignals.length && !alternateFrontendTitle) {
      compatibilityPercent = Math.min(ceilings.nodeHeavy, Math.max(40, rawScore));
      classification = "LOW MATCH";
      recommendation = "SKIP";
      tier = "C";
    }
    scoreBreakdown.rawScore = rawScore;
    scoreBreakdown.adjustment = compatibilityPercent - rawScore;
    scoreBreakdown.finalScore = compatibilityPercent;
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
  const primaryDomain = ecommerce.length
    ? ecommerce[0]
    : mobileDominance ? "MOBILE" : webCore ? (fullstack ? "FULLSTACK_TYPESCRIPT" : "FRONTEND_WEB")
      : backendDominance ? "BACKEND" : "GENERAL";
  const skillSignals = [
    ["React", /\breact(?:\.js|js)?\b/i], ["Next.js", /\bnext\.?js?\b/i], ["TypeScript", /\btypescript\b/i],
    ["WCAG / accessibility", /wcag|wai-aria|accessibilit|dost(?:e|ę)pno(?:s|ś)(?:c|ć)/i],
    ["Core Web Vitals", /core web vitals/i], ["REST API", /rest\s+api|api integration/i],
    ["Design Systems", /design system|component library/i], ["Playwright", /playwright/i],
    ["PHP", /\bphp\b/i], ["Go", /\b(?:golang|go)\b/i], ["Docker", /\bdocker\b/i],
    ["CI/CD", /\bci\/cd\b|continuous integration/i], ["Figma / UX", /\bfigma\b|ux\/?ui/i],
    ["SEO", /\bseo\b/i], ["AI-assisted development", /ai-assisted|ai assisted|llm|coding assistant|ai agents?/i]
  ];
  const skillState = (pattern) => requirementSignal(title, description, [pattern]);
  const mandatorySkills = unique(skillSignals.filter(([, pattern]) => {
    const state = skillState(pattern); return state.mandatory && !state.optionalOnly;
  }).map(([name]) => name));
  const optionalSkills = unique(skillSignals.filter(([, pattern]) => skillState(pattern).optionalOnly).map(([name]) => name));

  return {
    fitScore: Math.min(5, fitScore),
    compatibilityPercent,
    matchClassification: classification,
    compatibilityTier: tier,
    recommendation,
    reason,
    reasonDisplay,
    primaryRole: title,
    rankingCategory,
    scoreBreakdown,
    frontendDominance,
    primaryDomain,
    mandatorySkills,
    optionalSkills,
    frontendOwnershipSignals: unique(clauseEntries(description)
      .filter(({ text: clause }) => /front[ -]?end|react|next|typescript|web application|component|wcag|core web vitals|design system|interfejs|dost(?:e|ę)pno/i.test(clause))
      .map(({ text: clause }) => clause)).slice(0, 20),
    backendOwnershipSignals,
    backendCollaborationSignals,
    frontendDominanceScore: frontendOwnershipScore,
    backendDominanceScore,
    strengths: unique(strengths),
    gaps: unique(gaps),
    missingMandatorySkills: unique(missingMandatorySkills),
    primaryStack,
    responsibilitySplit: {
      frontend: frontendDominance && backendDominance ? "mixed" : frontendDominance ? "dominant" : backendDominance ? "secondary" : "mixed/unknown",
      backend: frontendDominance && backendDominance ? "mixed" : backendDominance ? "dominant" : frontendDominance ? (backendOwnership ? "secondary" : "collaboration/integration only") : "mixed/unknown",
      platform: mobileDominance ? "mobile" : "web"
    },
    signals: {
      reactWebCount: bits.react,
      reactNativeOrMobileCount: mobileCount,
      frontendCount,
      backendCount,
      backendMandatoryDevelopmentCount,
      backendOptionalCount,
      backendCollaborationCount: backendCollaborationSignals.length,
      backendPct,
      frontendPct,
      mandatoryBackend: mandatoryBackend.map((stack) => stack.id),
      mandatoryLanguages: languageSignals.map((signal) => signal.name),
      requiredYears: unique([...allText.matchAll(/\b(?:minimum|min\.?|at\s+least)?\s*(\d{1,2})\+?\s+years?(?:\s+of)?\s+(?:commercial |professional |relevant )?experience\b/gi)].map((match) => Number(match[1]))).sort((a, b) => b - a)
    },
    evaluatedFrom: hasFullJd ? "full-jd" : "pipeline-summary",
    evaluatedAt: new Date().toISOString()
  };
}

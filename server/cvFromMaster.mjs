import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import {
  classifyDomain,
  selectProjectsForDomain,
  skillsForDomain,
  summaryForDomain,
  headlineForDomain,
  selectExperienceBulletsForDomain
} from "./cvDomainRouting.mjs";

const WORKSPACE_ROOT = path.resolve(process.cwd());

export function toContactLink(value) {
  if (!value) return undefined;
  if (typeof value === "string") {
    const url = value.trim();
    if (!url) return undefined;
    return { url, display: displayUrl(url) };
  }
  if (typeof value === "object" && typeof value.url === "string" && value.url.trim()) {
    const url = value.url.trim();
    const display = typeof value.display === "string" && value.display.trim()
      ? value.display.trim()
      : displayUrl(url);
    return { url, display };
  }
  return undefined;
}

function displayUrl(url) {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

function loadProfile() {
  let raw = {};
  try {
    raw = yaml.load(fs.readFileSync(path.join(WORKSPACE_ROOT, "config", "profile.yml"), "utf8")) || {};
  } catch {
    raw = {};
  }
  const candidate = raw.candidate || {};
  return {
    name: String(candidate.full_name || "Career-Ops Candidate"),
    email: String(candidate.email || ""),
    phone: String(candidate.phone || ""),
    location: String(candidate.public_location_header || candidate.location || ""),
    linkedin: String(candidate.linkedin || ""),
    portfolio: String(candidate.portfolio_url || candidate.portfolio || ""),
    github: String(candidate.github || ""),
    headline: String(raw.narrative?.headline || raw.target_roles?.primary?.[0] || "Candidate"),
    outputLanguage: String(raw.language?.output || "en")
  };
}

function candidateSlug(name) {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "candidate";
}

function section(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return "";
  const end = lines.findIndex((line, index) => index > start && /^## /.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

function parseTitleOrgYear(line) {
  const match = line.match(/^\s*-\s+\*\*(.+?)\*\*\s*--\s*(.+)$/);
  if (!match) return null;
  const title = match[1].trim();
  const rest = match[2].trim();
  const yearInParens = rest.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (yearInParens) {
    return { title, org: yearInParens[1].trim(), year: yearInParens[2].trim() };
  }
  if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{4})/i.test(rest)) {
    return { title, org: "", year: rest };
  }
  return { title, org: rest, year: "" };
}

export function parseCvMarkdown(markdown) {
  const titleMatch = markdown.match(/\*\*Title:\*\*\s*(.+)/i);
  const summary = section(markdown, "Professional Summary")
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");

  const skills = section(markdown, "Technical Skills")
    .split("\n")
    .map((line) => {
      const match = line.match(/^\s*-\s+\*\*(.+?):?\*\*:?\s*(.+)$/);
      if (!match) return null;
      return { category: match[1].replace(/:$/, "").trim(), items: match[2].trim() };
    })
    .filter(Boolean);

  const experience = section(markdown, "Work Experience")
    .split(/^### /m)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      const header = (lines[0] || "").trim();
      const dash = header.indexOf(" -- ");
      const company = (dash === -1 ? header : header.slice(0, dash)).trim();
      const location = dash === -1 ? "" : header.slice(dash + 4).trim();
      const role = (lines.find((line) => /^\*\*.+\*\*/.test(line.trim())) || "")
        .replace(/\*\*/g, "")
        .trim();
      const dates = (lines.find((line) => /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}/i.test(line.trim())) || "").trim();
      const bullets = lines
        .filter((line) => /^\s*-\s+/.test(line))
        .map((line) => line.replace(/^\s*-\s+/, "").replace(/\*\*/g, "").trim())
        .filter(Boolean);
      return { company, role, location, dates, bullets };
    })
    .filter((entry) => entry.company && entry.role);

  const projects = section(markdown, "Key Projects")
    .split("\n")
    .map((line) => {
      const match = line.match(/^\s*-\s+\*\*(.+?)\*\*\s*--\s*(.+)$/);
      if (!match) return null;
      return { name: match[1].trim(), tech: "", description: match[2].trim() };
    })
    .filter(Boolean);

  const education = section(markdown, "Education").split("\n").map(parseTitleOrgYear).filter(Boolean);
  const certifications = section(markdown, "Courses & Continuous Learning").split("\n").map(parseTitleOrgYear).filter(Boolean);
  const languages = section(markdown, "Languages")
    .split("\n")
    .map((line) => {
      const match = line.match(/^\s*-\s+\*\*(.+?):?\*\*:?\s*(.+)$/);
      return match ? `${match[1].replace(/:$/, "").trim()} (${match[2].trim()})` : "";
    })
    .filter(Boolean);

  return {
    headline: titleMatch ? titleMatch[1].trim() : "",
    summary,
    skills,
    experience,
    projects,
    education,
    certifications,
    languages
  };
}

export function readMasterCvMarkdown() {
  return fs.readFileSync(path.join(WORKSPACE_ROOT, "cv.md"), "utf8");
}

export function loadParsedMasterCv() {
  const parsed = parseCvMarkdown(readMasterCvMarkdown());
  const profile = yaml.load(fs.readFileSync(path.join(WORKSPACE_ROOT, "config", "profile.yml"), "utf8")) || {};
  const locations = profile.cv?.experience_locations || {};
  parsed.experience = parsed.experience.map(entry => ({
    ...entry,
    location: locations[entry.company] || entry.location
  }));
  return parsed;
}

// The model selects evidence; identity, chronology and engagement locations
// remain canonical even if a provider returns stale or reordered metadata.
export function canonicalTailoredExperience(experience, master = loadParsedMasterCv().experience) {
  if (!Array.isArray(experience) || experience.length !== master.length) {
    throw new Error("Tailored CV must preserve every master employer.");
  }
  return master.map(entry => {
    const matches = experience.filter(item => item.company === entry.company);
    if (matches.length !== 1 || !Array.isArray(matches[0].bullets) || !matches[0].bullets.length) {
      throw new Error(`Missing or duplicate tailored experience: ${entry.company}`);
    }
    return { ...entry, bullets: matches[0].bullets };
  });
}

export function selectProfessionalDevelopment(certifications, jdText = "") {
  const tokens = jdText.toLowerCase().match(/[a-z][a-z.+-]*/g) || [];
  const relevant = new Set(tokens.filter(token => token.length > 2));
  return certifications.map((entry, index) => ({
    entry, index,
    score: (entry.title.toLowerCase().match(/[a-z][a-z.+-]*/g) || []).filter(token => relevant.has(token)).length
  })).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 3)
    .sort((a, b) => a.index - b.index).map(item => item.entry);
}

export function candidateContactFields(candidate = loadProfile()) {
  return {
    name: candidate.name,
    email: candidate.email,
    phone: candidate.phone,
    location: candidate.location,
    linkedin: toContactLink(candidate.linkedin),
    portfolio: toContactLink(candidate.portfolio),
    github: toContactLink(candidate.github)
  };
}

export function buildMasterCvPayload(overrides = {}) {
  const candidate = loadProfile();
  const parsed = loadParsedMasterCv();
  const headline = overrides.headline || candidate.headline || parsed.headline;
  return {
    lang: candidate.outputLanguage || "en",
    page_format: "a4",
    candidate: {
      ...candidateContactFields(candidate),
      title: headline,
      headline
    },
    sections: {
      summary: "",
      skills: "Technical Skills",
      experience: "Work Experience",
      projects: "Projects",
      education: "Education",
      certifications: "Professional Development",
      interests: "Languages"
    },
    summary: parsed.summary,
    skills: parsed.skills,
    experience: parsed.experience,
    projects: parsed.projects,
    education: parsed.education,
    certifications: parsed.certifications,
    interests: parsed.languages.length ? [parsed.languages.join(" · ")] : []
  };
}

export function buildSimpleTailorResult(job = {}) {
  const parsed = loadParsedMasterCv();
  const candidate = loadProfile();
  const classified = classifyDomain(job.title || "", job.extra || "", job.extra || "");
  const selected = selectProjectsForDomain(classified.primary, {
    title: job.title || "",
    jd: job.extra || "",
    company: job.company || ""
  });
  const skills = skillsForDomain(classified.primary);
  const summary = summaryForDomain(classified.primary);
  const headline = job.title || headlineForDomain(classified.primary) || candidate.headline || parsed.headline;
  const experience = selectExperienceBulletsForDomain(classified.primary, parsed.experience);
  return {
    primary_domain: classified.primary,
    secondary_domains: classified.secondary,
    headline,
    summary,
    skills,
    experience,
    projects: selected.projects,
    _fallbackUsed: true,
    tailoring_diff: {
      primary_domain: classified.primary,
      secondary_domains: classified.secondary,
      summary_focus: `Fallback: domain-routed CV for PRIMARY=${classified.primary} from cv.md + verified project whitelist (AI tailoring did not complete).`,
      skills_promoted: skills.map((skill) => skill.category),
      skills_omitted: [{ domain: "Off-domain stacks", reason: `Omitted stacks that do not match PRIMARY=${classified.primary}.` }],
      projects_selected: selected.reasons,
      jd_keywords_matched: [],
      experience_emphasis: `Chronology from cv.md; For Better Future bullets routed to PRIMARY=${classified.primary}.`
    }
  };
}

export function masterOutputPaths() {
  const slug = candidateSlug(loadProfile().name);
  return {
    htmlPath: path.join(WORKSPACE_ROOT, "output", `cv-${slug}-master.html`),
    pdfPath: path.join(WORKSPACE_ROOT, "output", `cv-${slug}-master.pdf`)
  };
}

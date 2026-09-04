import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { parseCvMarkdown } from "./cvFromMaster.mjs";

const WORKSPACE_ROOT = path.resolve(process.cwd());

export interface DashboardProfile {
  name: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  portfolio: string;
  github: string;
  headline: string;
  outputLanguage: string;
}

export function loadDashboardProfile(): DashboardProfile {
  let raw: any = {};
  try {
    raw = yaml.load(fs.readFileSync(path.join(WORKSPACE_ROOT, "config", "profile.yml"), "utf8")) || {};
  } catch {
    // doctor.mjs owns missing-profile guidance; the dashboard remains readable.
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

export function loadCvSupportingSections() {
  try {
    const parsed = parseCvMarkdown(fs.readFileSync(path.join(WORKSPACE_ROOT, "cv.md"), "utf8"));
    return {
      education: parsed.education,
      certifications: parsed.certifications,
      languages: parsed.languages
    };
  } catch {
    return { education: [], certifications: [], languages: [] };
  }
}

export function candidateFileSlug(name: string) {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "candidate";
}

export function resolveMasterPdfPath() {
  const generated = path.join(WORKSPACE_ROOT, "output", `cv-${candidateFileSlug(loadDashboardProfile().name)}-master.pdf`);
  if (fs.existsSync(generated)) return generated;
  let configured = "";
  try {
    const raw: any = yaml.load(fs.readFileSync(path.join(WORKSPACE_ROOT, "config", "profile.yml"), "utf8")) || {};
    configured = String(raw.cv?.master_pdf || "");
  } catch { /* fall through */ }
  if (configured) return path.resolve(WORKSPACE_ROOT, configured);
  const rootPdf = fs.readdirSync(WORKSPACE_ROOT).find((name) => name.toLowerCase().endsWith(".pdf"));
  return path.join(WORKSPACE_ROOT, rootPdf || "cv.pdf");
}

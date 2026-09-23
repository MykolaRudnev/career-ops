import path from "node:path";
import fs from "node:fs";

const WORKSPACE_ROOT = path.resolve(process.cwd());

export function jobArtifactSlug(company: string, title: string): string {
  const clean = (value: string) => value.toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${clean(company)}-${clean(title)}`.slice(0, 50) || "job";
}

export function normalizedCvRole(title: string): string {
  const senior = /\bsenior\b/i.test(title) ? "Senior " : "";
  if (/shopify|liquid/i.test(title)) return "Shopify Developer";
  if (/magento|hyv[aä]|adobe commerce/i.test(title)) return "Magento Developer";
  if (/full[ -]?stack/i.test(title)) return `${senior}Fullstack Engineer`;
  if (/lead|architect/i.test(title) && /front[ -]?end|react|next|\bui\b/i.test(title)) return "Frontend Tech Lead";
  if (/front[ -]?end|\bui\b|product engineer|next\.?js/i.test(title)) {
    return `${senior}Frontend ${/engineer/i.test(title) ? "Engineer" : "Developer"}`;
  }
  if (/react/i.test(title)) return `${senior}React Developer`;
  return `${senior}Software Engineer`;
}

const slug = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function tailoredPdfFilename(name: string, title: string): string {
  const cleanName = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "") || "Candidate";
  return `${cleanName}_${normalizedCvRole(title).replaceAll(" ", "_")}.pdf`;
}

export function artifactDirectories(): string[] {
  const result: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (!fs.existsSync(dir)) return;
    if (["metadata.json", "artifact-job.json", "cover-letter-metadata.json"].some(name => fs.existsSync(path.join(dir, name)))) result.push(dir);
    if (depth === 0) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) walk(path.join(dir, entry.name), depth - 1);
    }
  };
  walk(path.join(WORKSPACE_ROOT, "outputs"), 2);
  return result;
}

export function jobArtifactDir(job: { company: string; title: string; url?: string }, options: { create?: boolean } = {}): string {
  const company = slug(job.company.replace(/\bsp\.?\s*z\.?\s*o\.?\s*o\.?\s*$/i, "").replace(/\b(?:inc|llc|ltd|gmbh)\.?\s*$/i, "")) || "company";
  const parent = path.join(WORKSPACE_ROOT, "outputs", company);
  const role = slug(normalizedCvRole(job.title));
  let dir = path.join(parent, role);
  for (let n = 1; fs.existsSync(dir); n++, dir = path.join(parent, `${role}-${n}`)) {
    const identityFile = ["artifact-job.json", "metadata.json", "cover-letter-metadata.json"]
      .map(name => path.join(dir, name)).find(file => fs.existsSync(file));
    if (identityFile) {
      const identity = JSON.parse(fs.readFileSync(identityFile, "utf8"));
      if (job.url && identity.url ? job.url === identity.url : job.title === (identity.title || identity.role)) return dir;
    }
  }
  const legacy = path.join(WORKSPACE_ROOT, "outputs", jobArtifactSlug(job.company, job.title));
  if (!options.create && fs.existsSync(legacy)) return legacy;
  if (options.create) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "artifact-job.json"), JSON.stringify(job, null, 2), "utf8");
  }
  return dir;
}

export function restructureLegacyArtifactDirs(baseOutputsDir = path.join(WORKSPACE_ROOT, "outputs")): void {
  if (!fs.existsSync(baseOutputsDir)) return;
  const entries = fs.readdirSync(baseOutputsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const legacyPath = path.join(baseOutputsDir, entry.name);

    let children: fs.Dirent[] = [];
    try {
      children = fs.readdirSync(legacyPath, { withFileTypes: true });
    } catch {
      continue;
    }

    const subdirs = children.filter((c) => c.isDirectory() && !c.name.startsWith("."));
    if (subdirs.length > 0) continue; // Already hierarchical

    const metaFile = path.join(legacyPath, "metadata.json");
    const jobFile = path.join(legacyPath, "artifact-job.json");
    const coverMetaFile = path.join(legacyPath, "cover-letter-metadata.json");

    let company = "";
    let role = "";
    let url = "";

    if (fs.existsSync(metaFile)) {
      try {
        const m = JSON.parse(fs.readFileSync(metaFile, "utf8"));
        company = m.company || "";
        role = m.role || m.title || "";
        url = m.url || "";
      } catch { /* ignore */ }
    }
    if (!company && fs.existsSync(jobFile)) {
      try {
        const j = JSON.parse(fs.readFileSync(jobFile, "utf8"));
        company = j.company || "";
        role = j.title || j.role || "";
        url = j.url || "";
      } catch { /* ignore */ }
    }
    if (!company && fs.existsSync(coverMetaFile)) {
      try {
        const c = JSON.parse(fs.readFileSync(coverMetaFile, "utf8"));
        company = c.company || "";
        role = c.role || "";
      } catch { /* ignore */ }
    }
    if (!company && entry.name.includes("snow-dog")) {
      company = "Snow Dog";
      role = "Senior Magento 2 Hyva Frontend Developer";
    }

    if (!company || !role) continue;

    const companySlug = slug(company.replace(/\bsp\.?\s*z\.?\s*o\.?\s*$/i, "").replace(/\b(?:inc|llc|ltd|gmbh)\.?\s*$/i, "")) || "company";
    const roleSlug = slug(normalizedCvRole(role));
    const targetParent = path.join(baseOutputsDir, companySlug);
    const targetDir = path.join(targetParent, roleSlug);

    if (targetDir === legacyPath) continue;

    fs.mkdirSync(targetDir, { recursive: true });

    for (const child of children) {
      const src = path.join(legacyPath, child.name);
      const dst = path.join(targetDir, child.name);
      if (!fs.existsSync(dst)) {
        try {
          fs.renameSync(src, dst);
        } catch {
          try {
            fs.copyFileSync(src, dst);
            fs.unlinkSync(src);
          } catch { /* ignore */ }
        }
      }
    }

    const targetMetaPath = path.join(targetDir, "metadata.json");
    if (fs.existsSync(targetMetaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(targetMetaPath, "utf8"));
        const pdfFiles = fs.readdirSync(targetDir).filter((f) => f.endsWith(".pdf"));
        const chosenPdf = pdfFiles.find((f) => !f.startsWith("tailored-cv") && !f.includes("master")) || pdfFiles.find((f) => f === "tailored-cv.pdf") || pdfFiles[0];
        if (chosenPdf) {
          meta.pdfPath = path.join(targetDir, chosenPdf);
        }
        const htmlFile = path.join(targetDir, "tailored-cv.html");
        if (fs.existsSync(htmlFile)) {
          meta.htmlPath = htmlFile;
        }
        meta.company = meta.company || company;
        meta.role = meta.role || role;
        fs.writeFileSync(targetMetaPath, JSON.stringify(meta, null, 2), "utf8");
      } catch { /* ignore */ }
    }

    const targetJobPath = path.join(targetDir, "artifact-job.json");
    if (!fs.existsSync(targetJobPath)) {
      fs.writeFileSync(targetJobPath, JSON.stringify({ company, title: role, url }, null, 2), "utf8");
    }

    try {
      if (fs.readdirSync(legacyPath).length === 0) {
        fs.rmdirSync(legacyPath);
      }
    } catch { /* ignore */ }
  }
}

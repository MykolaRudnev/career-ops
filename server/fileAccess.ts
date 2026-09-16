import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveMasterPdfPath } from "./profile.ts";
import { inferJobCountries } from "./jobCountry.mjs";
import { acquireTrackerLock, trackerLockDirFor, writeFileAtomic } from "../tracker-utils.mjs";
import { resolveTrackerPathForWrite } from "../path-resolver.mjs";
import { withPipelineLock } from "../pipeline-lock.mjs";
import { artifactDirectories, restructureLegacyArtifactDirs } from "./jobArtifacts.ts";

export const WORKSPACE_ROOT = path.resolve(process.cwd());

/**
 * Validate that candidate path resolves strictly within WORKSPACE_ROOT
 */
export function assertSafePath(targetPath: string): string {
  const abs = path.isAbsolute(targetPath) ? targetPath : path.resolve(WORKSPACE_ROOT, targetPath);
  const rel = path.relative(WORKSPACE_ROOT, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Security violation: path escapes workspace root: ${targetPath}`);
  }
  return abs;
}

export interface PipelineJob {
  id: string;
  url: string;
  company: string;
  title: string;
  location: string;
  countries: string[];
  workModel: string;
  date: string;
  status: "pending" | "reviewed" | "applied" | "skipped";
  extra: string;
  bid?: string;
  fitScore?: number;
  recommendation?: "APPLY" | "REVIEW" | "SKIP";
  strengths?: string[];
  gaps?: string[];
  missingMandatorySkills?: string[];
  compatibilityPercent?: number;
  matchClassification?: "BEST MATCH" | "STRONG MATCH" | "POSSIBLE MATCH" | "LOW MATCH" | "SKIP";
  compatibilityTier?: "A" | "B" | "C" | "D";
  reason?: string;
  reasonDisplay?: string;
  primaryStack?: string[];
  responsibilitySplit?: { frontend: string; backend: string; platform: string };
  evaluatedFrom?: "full-jd" | "pipeline-summary";
  salary?: string;
  hasTailoredCv?: boolean;
  tailoredPdfPath?: string;
  source?: string;
  sourceType?: string;
  manualEntry?: boolean;
  addedAt?: string;
  description?: string;
  sourceName?: string;
  notes?: string;
}

export function parsePipeline(): { pending: PipelineJob[]; processed: PipelineJob[] } {
  const pipelinePath = path.join(WORKSPACE_ROOT, "data", "pipeline.md");
  if (!fs.existsSync(pipelinePath)) {
    return { pending: [], processed: [] };
  }

  const content = fs.readFileSync(pipelinePath, "utf8");
  const lines = content.split("\n");

  const pending: PipelineJob[] = [];
  const processed: PipelineJob[] = [];
  let currentSection: "pending" | "processed" | "" = "";

  // Check which tailored PDFs exist in output/
  const outputFiles = getTailoredCvs();
  const pdfNameMap = new Map<string, string>();
  for (const f of outputFiles) {
    pdfNameMap.set(f.filename.toLowerCase(), f.filePath);
  }
  const manualById = new Map<string, any>();
  const manualPath = path.join(WORKSPACE_ROOT, "data", "manual-jobs.json");
  if (fs.existsSync(manualPath)) {
    try {
      for (const row of JSON.parse(fs.readFileSync(manualPath, "utf8"))) manualById.set(row.id, row);
    } catch { /* malformed optional store: keep parsing the normal pipeline */ }
  }

  let index = 0;
  for (const line of lines) {
    if (line.startsWith("## Pending")) {
      currentSection = "pending";
      continue;
    } else if (line.startsWith("## Processed")) {
      currentSection = "processed";
      continue;
    }

    const trimmed = line.trim();
    if (trimmed.startsWith("- [ ]") || trimmed.startsWith("- [x]")) {
      const raw = trimmed.substring(5).trim();
      const parts = raw.split(" | ").map(p => p.trim());
      if (parts.length >= 3) {
        const url = parts[0];
        const company = parts[1];
        const title = parts[2];
        const location = parts[3] || "";
        const extra = parts.slice(4).join(" | ");

        let workModel = "Office";
        const locLower = (location + " " + extra).toLowerCase();
        if (locLower.includes("remote") || locLower.includes("zdalnie")) {
          workModel = "Remote";
        } else if (locLower.includes("hybrid") || locLower.includes("hybryd")) {
          workModel = "Hybrid";
        }

        let date = "";
        const dateMatch = extra.match(/posted:\s*(\d{4}-\d{2}-\d{2})/i) || extra.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) date = dateMatch[1];

        let status: "pending" | "reviewed" | "applied" | "skipped" = currentSection === "pending" ? "pending" : "reviewed";
        if (extra.includes("applied")) status = "applied";
        if (extra.includes("skipped")) status = "skipped";

        // Check if there is a tailored PDF matching company
        const compClean = company.toLowerCase().replace(/[^a-z0-9]/g, "");
        let hasTailoredCv = false;
        let tailoredPdfPath: string | undefined;

        for (const [fname, fpath] of pdfNameMap.entries()) {
          if (fname.includes(compClean)) {
            hasTailoredCv = true;
            tailoredPdfPath = fpath;
            break;
          }
        }
        const exactCv = outputFiles.find(file => file.jobUrl === url)
          || outputFiles.find(file => file.company === company && file.role === title);
        if (exactCv) {
          hasTailoredCv = true;
          tailoredPdfPath = exactCv.filePath;
        }

        const manualId = extra.match(/manual-id:\s*([^|\s]+)/i)?.[1] || "";
        const manual = manualById.get(manualId);
        const bidMatch = extra.match(/\b(?:bid|rate|proposed-rate|proposed-salary):\s*([^|]+)/i);
        const bid = manual?.bid || (bidMatch ? bidMatch[1].trim() : (manual?.salary || ""));
        const job: PipelineJob = {
          id: manual?.id || `job-${index++}`,
          url,
          company,
          title,
          location,
          countries: inferJobCountries(location),
          workModel,
          date,
          status,
          extra,
          bid,
          hasTailoredCv,
          tailoredPdfPath,
          ...(manual ? {
            source: "manual",
            sourceType: "MANUAL",
            manualEntry: true,
            addedAt: manual.addedAt,
            description: manual.description,
            sourceName: manual.sourceName,
            notes: manual.notes,
            salary: manual.salary || ""
          } : {})
        };

        if (currentSection === "pending") {
          pending.push(job);
        } else {
          processed.push(job);
        }
      }
    }
  }

  return { pending, processed };
}

export async function updatePipelineStatus(targetUrl: string, newStatus: "reviewed" | "applied" | "skipped"): Promise<boolean> {
  const pipelinePath = path.join(WORKSPACE_ROOT, "data", "pipeline.md");
  if (!fs.existsSync(pipelinePath)) return false;

  const content = fs.readFileSync(pipelinePath, "utf8");
  const lines = content.split("\n");
  let found = false;
  let inPending = false;
  let inProcessed = false;

  const newPendingLines: string[] = [];
  const processedLinesToAdd: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## Pending")) {
      inPending = true;
      inProcessed = false;
      newPendingLines.push(line);
      continue;
    }
    if (line.startsWith("## Processed")) {
      inPending = false;
      inProcessed = true;
      newPendingLines.push(line);
      continue;
    }

    if (inPending && (line.trim().startsWith("- [ ]") || line.trim().startsWith("- [x]"))) {
      if (line.includes(targetUrl)) {
        found = true;
        // Transform line to processed entry
        const raw = line.trim().substring(5).trim();
        const updated = `- [x] ${raw} | status: ${newStatus}`;
        processedLinesToAdd.push(updated);
        continue;
      }
    }
    newPendingLines.push(line);
  }

  if (found) {
    // Insert into processed section
    const procIdx = newPendingLines.findIndex(l => l.startsWith("## Processed"));
    if (procIdx !== -1) {
      newPendingLines.splice(procIdx + 1, 0, ...processedLinesToAdd);
    }
    fs.writeFileSync(pipelinePath, newPendingLines.join("\n"), "utf8");

    const manualPath = path.join(WORKSPACE_ROOT, "data", "manual-jobs.json");
    if (fs.existsSync(manualPath)) {
      try {
        const manualJobs = JSON.parse(fs.readFileSync(manualPath, "utf8"));
        const manual = manualJobs.find((job: any) => job.url === targetUrl);
        if (manual) {
          manual.status = newStatus;
          fs.writeFileSync(manualPath, JSON.stringify(manualJobs, null, 2), "utf8");
          const trackerPath = resolveTrackerPathForWrite(WORKSPACE_ROOT);
          if (fs.existsSync(trackerPath)) {
            const lock = await acquireTrackerLock(trackerLockDirFor(trackerPath), { tracker: trackerPath });
            try {
              const trackerLines = fs.readFileSync(trackerPath, "utf8").split("\n");
              const header = trackerLines.find((line) => /^\|\s*#\s*\|/.test(line));
              const statusIndex = header ? header.split("|").map((part) => part.trim().toLowerCase()).indexOf("status") : 6;
              const canonical = newStatus === "applied" ? "Applied" : newStatus === "skipped" ? "SKIP" : "Evaluated";
              const updatedTracker = trackerLines.map((line) => {
                if (!line.includes(`manual-id: ${manual.id}`)) return line;
                const parts = line.split("|");
                if (statusIndex > 0 && statusIndex < parts.length) parts[statusIndex] = ` ${canonical} `;
                return parts.join("|");
              }).join("\n");
              writeFileAtomic(trackerPath, updatedTracker);
            } finally {
              lock.release();
            }
          }
        }
      } catch { /* pipeline status remains authoritative if optional enrichment fails */ }
    }
    return true;
  }

  return false;
}

export async function updateJobBid(targetUrl: string, bid: string, jobId?: string): Promise<boolean> {
  const pipelinePath = path.join(WORKSPACE_ROOT, "data", "pipeline.md");
  const cleanBid = bid.trim();
  let found = false;

  if (fs.existsSync(pipelinePath)) {
    await withPipelineLock(pipelinePath, () => {
      const content = fs.readFileSync(pipelinePath, "utf8");
      const lines = content.split("\n");
      const newLines = lines.map((line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("- [ ]") && !trimmed.startsWith("- [x]")) return line;
        const matchesUrl = targetUrl && line.includes(targetUrl);
        const matchesJobId = jobId && line.includes(jobId);
        if (!matchesUrl && !matchesJobId) return line;

        found = true;
        if (/\b(?:bid|rate|proposed-rate):\s*[^|]+/i.test(line)) {
          return cleanBid
            ? line.replace(/\b(?:bid|rate|proposed-rate):\s*[^|]+/i, `bid: ${cleanBid}`)
            : line.replace(/\s*\|\s*\b(?:bid|rate|proposed-rate):\s*[^|]+/i, "");
        } else if (cleanBid) {
          return `${line.trimEnd()} | bid: ${cleanBid}`;
        }
        return line;
      });
      if (found) {
        writeFileAtomic(pipelinePath, newLines.join("\n"));
      }
    });
  }

  const manualPath = path.join(WORKSPACE_ROOT, "data", "manual-jobs.json");
  if (fs.existsSync(manualPath)) {
    try {
      const manualJobs = JSON.parse(fs.readFileSync(manualPath, "utf8"));
      const manual = manualJobs.find((j: any) => (targetUrl && j.url === targetUrl) || (jobId && j.id === jobId));
      if (manual) {
        manual.bid = cleanBid;
        const tmp = `${manualPath}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(manualJobs, null, 2), "utf8");
        fs.renameSync(tmp, manualPath);
      }
    } catch { /* ignore */ }
  }

  const trackerPath = resolveTrackerPathForWrite(WORKSPACE_ROOT);
  if (fs.existsSync(trackerPath)) {
    const lock = await acquireTrackerLock(trackerLockDirFor(trackerPath), { tracker: trackerPath });
    try {
      const trackerLines = fs.readFileSync(trackerPath, "utf8").split("\n");
      const header = trackerLines.find((line) => /^\|\s*#\s*\|/.test(line));
      const notesIndex = header ? header.split("|").map((part) => part.trim().toLowerCase()).indexOf("notes") : 8;
      const updatedTracker = trackerLines.map((line) => {
        const matchesUrl = targetUrl && line.includes(targetUrl);
        const matchesJobId = jobId && line.includes(jobId);
        if (!matchesUrl && !matchesJobId) return line;

        const parts = line.split("|");
        if (notesIndex > 0 && notesIndex < parts.length) {
          let notes = parts[notesIndex].trim();
          if (/\b(?:Rate\s*\/\s*Bid|Bid|Proposed Rate):\s*[^;]+/i.test(notes)) {
            notes = cleanBid
              ? notes.replace(/\b(?:Rate\s*\/\s*Bid|Bid|Proposed Rate):\s*[^;]+/i, `Rate / Bid: ${cleanBid}`)
              : notes.replace(/\b(?:Rate\s*\/\s*Bid|Bid|Proposed Rate):\s*[^;]+;?\s*/i, "").trim();
          } else if (cleanBid) {
            notes = notes ? `${notes}; Rate / Bid: ${cleanBid}` : `Rate / Bid: ${cleanBid}`;
          }
          parts[notesIndex] = ` ${notes} `;
        }
        return parts.join("|");
      }).join("\n");
      writeFileAtomic(trackerPath, updatedTracker);
    } finally {
      lock.release();
    }
  }

  return true;
}

export function getMasterCvStatus() {
  const mdPath = path.join(WORKSPACE_ROOT, "cv.md");
  const pdfPath = resolveMasterPdfPath();

  const mdExists = fs.existsSync(mdPath);
  const pdfExists = fs.existsSync(pdfPath);

  let mdModified = null;
  let mdSize = 0;
  if (mdExists) {
    const stat = fs.statSync(mdPath);
    mdModified = stat.mtime.toISOString();
    mdSize = stat.size;
  }

  let pdfModified = null;
  let pdfSize = 0;
  if (pdfExists) {
    const stat = fs.statSync(pdfPath);
    pdfModified = stat.mtime.toISOString();
    pdfSize = stat.size;
  }

  return {
    mdExists,
    mdPath,
    mdModified,
    mdSize,
    pdfExists,
    pdfPath,
    pdfModified,
    pdfSize,
    pdfFilename: path.basename(pdfPath)
  };
}

export interface TailoredCvFile {
  jobUrl?: string;
  company?: string;
  role?: string;
  displayName: string;
  folderPath: string;
  filename: string;
  filePath: string;
  sizeBytes: number;
  modified: string;
  isPdf: boolean;
}

export function getTailoredCvs(): TailoredCvFile[] {
  try {
    restructureLegacyArtifactDirs();
  } catch { /* non-fatal migration helper */ }

  const outDir = path.join(WORKSPACE_ROOT, "output");
  const files = fs.existsSync(outDir) ? fs.readdirSync(outDir) : [];
  const cvs: TailoredCvFile[] = [];

  for (const file of files) {
    if (file.endsWith(".pdf") && file.startsWith("cv-") && !file.includes("-master.")) {
      const full = path.join(outDir, file);
      const stat = fs.statSync(full);
      const cleanName = file.replace(/^cv-[^-]+-[^-]+-/, "").replace(/\.pdf$/, "");
      const parts = cleanName.split("-");
      const companyPart = parts.slice(0, Math.min(2, parts.length)).join(" ");
      const rolePart = parts.slice(Math.min(2, parts.length)).join(" ");
      cvs.push({
        filename: file,
        displayName: `${companyPart} / ${rolePart || "Tailored CV"}`,
        folderPath: outDir,
        filePath: full,
        sizeBytes: stat.size,
        modified: stat.mtime.toISOString(),
        isPdf: true
      });
    }
  }

  for (const dir of artifactDirectories()) {
    let company = "";
    let role = "";
    let jobUrl = "";
    let pdfPath = "";

    const metaPath = path.join(dir, "metadata.json");
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
        company = meta.company || "";
        role = meta.role || meta.title || "";
        jobUrl = meta.url || "";
        if (meta.pdfPath && fs.existsSync(assertSafePath(meta.pdfPath))) {
          pdfPath = assertSafePath(meta.pdfPath);
        }
      } catch { /* ignore */ }
    }

    const jobPath = path.join(dir, "artifact-job.json");
    if ((!company || !role) && fs.existsSync(jobPath)) {
      try {
        const j = JSON.parse(fs.readFileSync(jobPath, "utf8"));
        company = company || j.company || "";
        role = role || j.title || "";
        jobUrl = jobUrl || j.url || "";
      } catch { /* ignore */ }
    }

    if (!pdfPath || !fs.existsSync(pdfPath)) {
      const dirFiles = fs.readdirSync(dir);
      const pdfs = dirFiles.filter((f) => f.endsWith(".pdf"));
      const candidatePdf = pdfs.find((f) => !f.startsWith("tailored-cv") && !f.includes("master")) || pdfs.find((f) => f === "tailored-cv.pdf") || pdfs[0];
      if (candidatePdf) {
        pdfPath = path.join(dir, candidatePdf);
      }
    }

    if (!pdfPath || !fs.existsSync(pdfPath)) continue;

    const stat = fs.statSync(pdfPath);

    if (!company || !role) {
      const rel = path.relative(path.join(WORKSPACE_ROOT, "outputs"), dir);
      const segs = rel.split(path.sep);
      if (segs.length >= 2) {
        company = company || segs[0].replace(/-/g, " ");
        role = role || segs[1].replace(/-/g, " ");
      } else if (segs.length === 1) {
        company = company || segs[0].replace(/-/g, " ");
      }
    }

    const displayName = company && role ? `${company} / ${role}` : (company || role || path.basename(dir));
    const record: TailoredCvFile = {
      filename: path.basename(pdfPath),
      displayName,
      folderPath: dir,
      filePath: pdfPath,
      sizeBytes: stat.size,
      modified: stat.mtime.toISOString(),
      isPdf: true,
      jobUrl,
      company,
      role
    };

    const existing = cvs.findIndex((cv) => cv.filePath === pdfPath || (Boolean(company && cv.company === company) && Boolean(role && cv.role === role)));
    if (existing >= 0) cvs[existing] = record;
    else cvs.push(record);
  }
  cvs.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
  return cvs;
}

export function getLastScanInfo() {
  const runsPath = path.join(WORKSPACE_ROOT, "data", "scan-runs.tsv");
  if (!fs.existsSync(runsPath)) {
    return { lastRun: null, totalAdded: 0, totalDiscovered: 0, totalFiltered: 0, totalDuplicates: 0 };
  }

  const lines = fs.readFileSync(runsPath, "utf8").trim().split("\n");
  if (lines.length <= 1) return { lastRun: null, totalAdded: 0, totalDiscovered: 0, totalFiltered: 0, totalDuplicates: 0 };

  const lastLine = lines[lines.length - 1];
  const parts = lastLine.split("\t");
  const found = parseInt(parts[4] || "0", 10);
  const dupes = parseInt(parts[12] || "0", 10);
  const added = parseInt(parts[13] || "0", 10);
  const filtered = found > 0 ? (found - dupes - added) : 0;

  return {
    lastRun: parts[0] || null,
    totalDiscovered: found,
    totalFiltered: filtered,
    totalDuplicates: dupes,
    totalAdded: added
  };
}

export function openLocalTarget(type: "master-cv" | "master-pdf" | "master-folder" | "cv-folder" | "tailored-cv" | "url", payload?: string): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    let target = "";

    switch (type) {
      case "master-cv":
        target = assertSafePath("cv.md");
        break;
      case "master-pdf":
        target = assertSafePath(resolveMasterPdfPath());
        break;
      case "master-folder":
        target = WORKSPACE_ROOT;
        break;
      case "cv-folder": {
        if (payload) {
          const safe = assertSafePath(payload);
          let targetDir = safe;
          if (fs.existsSync(safe) && fs.statSync(safe).isFile()) {
            targetDir = path.dirname(safe);
          }
          if (!["output", "outputs"].some((dir) => targetDir === path.join(WORKSPACE_ROOT, dir) || targetDir.startsWith(path.join(WORKSPACE_ROOT, dir) + path.sep))) {
            return resolve({ success: false, message: "Can only open folders in output/outputs directory" });
          }
          target = targetDir;
        } else {
          target = assertSafePath("outputs");
        }
        break;
      }
      case "tailored-cv": {
        if (!payload) {
          return resolve({ success: false, message: "Missing CV path parameter" });
        }
        // Accept both legacy output/ and company-organized outputs/ artifacts.
        const safe = assertSafePath(payload);
        if (!["output", "outputs"].some((dir) => safe.startsWith(path.join(WORKSPACE_ROOT, dir) + path.sep))) {
          return resolve({ success: false, message: "Can only open files in output directory" });
        }
        target = safe;
        break;
      }
      case "url": {
        if (!payload || (!payload.startsWith("http://") && !payload.startsWith("https://"))) {
          return resolve({ success: false, message: "Invalid URL" });
        }
        target = payload;
        break;
      }
      default:
        return resolve({ success: false, message: "Unknown open type" });
    }

    if (type !== "url" && !fs.existsSync(target)) {
      return resolve({ success: false, message: `File not found: ${target}` });
    }

    try {
      const child = spawn("xdg-open", [target], { detached: true, stdio: "ignore" });
      child.unref();
      resolve({ success: true, message: `Opened ${target}` });
    } catch (err: any) {
      resolve({ success: false, message: `Failed to open ${target}: ${err.message}` });
    }
  });
}

export function getTailoringDiff(company: string, title?: string): any {
  return artifactDirectories().flatMap(dir => {
    const file = path.join(dir, "metadata.json");
    if (!fs.existsSync(file)) return [];
    return [JSON.parse(fs.readFileSync(file, "utf8"))];
  }).filter(meta => meta.company?.toLowerCase() === company.toLowerCase() && (!title || meta.role === title))
    .sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)))[0] || null;
}

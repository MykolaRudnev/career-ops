import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { WORKSPACE_ROOT, type PipelineJob } from "./fileAccess.ts";
import { acquireTrackerLock, cell, trackerLockDirFor, writeFileAtomic } from "../tracker-utils.mjs";
import { withPipelineLock } from "../pipeline-lock.mjs";
import { resolveTrackerPathForWrite } from "../path-resolver.mjs";
import { analyzeJobMatch } from "./jobMatch.mjs";
import { jobArtifactDir } from "./jobArtifacts.ts";

export interface ManualJobInput {
  title: string;
  company: string;
  description: string;
  url?: string;
  location?: string;
  workModel?: string;
  salary?: string;
  sourceName?: string;
  notes?: string;
}

export interface ManualJobRecord extends PipelineJob {
  source: "manual";
  sourceType: "MANUAL";
  manualEntry: true;
  addedAt: string;
  description: string;
  jdFingerprint: string;
  sourceName: string;
  notes: string;
}

const STORE_PATH = path.join(WORKSPACE_ROOT, "data", "manual-jobs.json");

function slug(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42) || "job";
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function fingerprintJobDescription(description: string): string {
  const normalized = normalize(description).replace(/\s+/g, " ");
  return createHash("sha256").update(normalized).digest("hex");
}

export function loadManualJobs(): ManualJobRecord[] {
  if (!fs.existsSync(STORE_PATH)) return [];
  try {
    const rows = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function saveManualJobs(rows: ManualJobRecord[]) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2), "utf8");
  fs.renameSync(tmp, STORE_PATH);
}

export function findManualDuplicates(input: ManualJobInput): ManualJobRecord[] {
  const company = normalize(input.company);
  const title = normalize(input.title);
  const url = String(input.url || "").trim().toLowerCase();
  const fingerprint = fingerprintJobDescription(input.description);
  return loadManualJobs().filter((job) =>
    (normalize(job.company) === company && normalize(job.title) === title)
    || Boolean(url && job.url.toLowerCase() === url)
    || job.jdFingerprint === fingerprint
  );
}

function pipelineLine(job: ManualJobRecord): string {
  const safe = (value: string) => cell(value).replace(/\s+/g, " ");
  const details = [
    `manual-id: ${job.id}`,
    "source: manual",
    `source-name: ${safe(job.sourceName)}`,
    `added: ${job.addedAt}`,
    job.salary ? `salary: ${safe(job.salary)}` : "",
    job.notes ? `notes: ${safe(job.notes)}` : ""
  ].filter(Boolean).join(" | ");
  return `- [ ] ${safe(job.url)} | ${safe(job.company)} | ${safe(job.title)} | ${safe(job.location)} | ${details}`;
}

async function appendPipeline(job: ManualJobRecord) {
  const pipelinePath = path.join(WORKSPACE_ROOT, "data", "pipeline.md");
  fs.mkdirSync(path.dirname(pipelinePath), { recursive: true });
  await withPipelineLock(pipelinePath, () => {
    let content = fs.existsSync(pipelinePath)
      ? fs.readFileSync(pipelinePath, "utf8")
      : "# Pipeline — Pending URLs\n\n## Pending\n\n## Processed\n";
    const marker = "## Pending";
    const markerIndex = content.indexOf(marker);
    if (markerIndex < 0) throw new Error("data/pipeline.md has no Pending section");
    const insertAt = content.indexOf("\n", markerIndex) + 1;
    content = `${content.slice(0, insertAt)}\n${pipelineLine(job)}${content.slice(insertAt)}`;
    const tmp = `${pipelinePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, pipelinePath);
  });
}

async function appendTracker(job: ManualJobRecord, evaluation?: any) {
  const trackerPath = resolveTrackerPathForWrite(WORKSPACE_ROOT);
  if (!fs.existsSync(trackerPath)) {
    fs.mkdirSync(path.dirname(trackerPath), { recursive: true });
    writeFileAtomic(trackerPath, "# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n");
  }
  const lock = await acquireTrackerLock(trackerLockDirFor(trackerPath), { tracker: trackerPath });
  try {
    let content = fs.readFileSync(trackerPath, "utf8");
    if (content.includes(`manual-id: ${job.id}`)) return;
    const numbers = [...content.matchAll(/^\|\s*(\d+)\s*\|/gm)].map((match) => Number(match[1]));
    const next = (numbers.length ? Math.max(...numbers) : 0) + 1;
    const score = Number.isFinite(evaluation?.fitScore) ? `${Number(evaluation.fitScore).toFixed(1)}/5` : "—";
    const notes = cell([
      "Source: Manual",
      `manual-id: ${job.id}`,
      job.url.startsWith("http") ? `URL: ${job.url}` : "",
      job.location ? `Location: ${job.location}` : "",
      job.workModel ? `Work model: ${job.workModel}` : "",
      job.salary ? `Salary: ${job.salary}` : "",
      job.notes
    ].filter(Boolean).join("; "));
    const row = `| ${next} | ${job.date} | ${cell(job.company)} | ${cell(job.title)} | ${score} | Evaluated | ❌ | — | ${notes} |`;
    content = `${content.trimEnd()}\n${row}\n`;
    writeFileAtomic(trackerPath, content);
  } finally {
    lock.release();
  }
}

export async function createManualJob(input: ManualJobInput, options: { addAnyway?: boolean; evaluation?: any } = {}) {
  const title = String(input.title || "").trim();
  const company = String(input.company || "").trim();
  const description = String(input.description || "").trim();
  if (!title || !company || !description) throw new Error("Job title, company, and job description are required");
  if (description.length < 40) throw new Error("Job description is too short to tailor reliably");
  const duplicates = findManualDuplicates({ ...input, title, company, description });
  if (duplicates.length && !options.addAnyway) return { created: false, duplicate: true, duplicates };

  const now = new Date();
  const id = `manual-${now.getTime()}-${slug(`${company}-${title}`)}`;
  const externalUrl = String(input.url || "").trim();
  if (externalUrl && !/^https?:\/\//i.test(externalUrl)) throw new Error("Job URL must start with http:// or https://");
  const location = String(input.location || "").trim();
  const workModel = String(input.workModel || "").trim() || (/remote|zdal/i.test(location) ? "Remote" : /hybrid|hybryd/i.test(location) ? "Hybrid" : "Office");
  const job: ManualJobRecord = {
    id,
    url: externalUrl || `manual://${id}`,
    company,
    title,
    description,
    location,
    countries: [],
    workModel,
    date: now.toISOString().slice(0, 10),
    status: "pending",
    extra: String(input.notes || "").trim(),
    salary: String(input.salary || "").trim(),
    source: "manual",
    sourceType: "MANUAL",
    manualEntry: true,
    addedAt: now.toISOString(),
    jdFingerprint: fingerprintJobDescription(description),
    sourceName: String(input.sourceName || "Manual").trim() || "Manual",
    notes: String(input.notes || "").trim()
  };

  const rows = loadManualJobs();
  rows.push(job);
  saveManualJobs(rows);
  await appendPipeline(job);
  const initialEvaluation = options.evaluation || analyzeJobMatch(job, description);
  await appendTracker(job, initialEvaluation);

  const artifactDir = jobArtifactDir(job);
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, "job-description.md"), description, "utf8");
  return { created: true, duplicate: false, job, initialEvaluation };
}

import fs from "node:fs";
import path from "node:path";
import { exec, spawn } from "node:child_process";
import { WORKSPACE_ROOT, assertSafePath, type PipelineJob } from "./fileAccess.ts";
import {
  getFullJobDescription,
  runAiTailoring,
  renderAndValidateTailoredCv,
  renderMasterCv,
  type TailoringDiff
} from "./aiTailor.ts";
import { buildSimpleTailorResult } from "./cvFromMaster.mjs";
import { DomainValidationError } from "./cvDomainRouting.mjs";
import { analyzeJobMatch } from "./jobMatch.mjs";
import { operationManager, type OperationRecord } from "./operations.ts";
import { OperationCancelledError, ProcessTimeoutError } from "./process.ts";
import { generateCoverLetter as generateCoverArtifact } from "./coverLetter.ts";

const JOB_MATCH_VERSION = 3;

function findLocalJobDescription(job: { url?: string; company?: string; title?: string; description?: string }): string {
  if (String(job.description || "").trim().length >= 40) return String(job.description).trim();
  const outputsDir = path.join(WORKSPACE_ROOT, "outputs");
  if (!fs.existsSync(outputsDir)) return "";
  const needleUrl = String(job.url || "").trim();
  const needleCompany = String(job.company || "").toLowerCase();
  const needleTitle = String(job.title || "").toLowerCase();
  for (const entry of fs.readdirSync(outputsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(outputsDir, entry.name);
    const jdPath = path.join(dir, "job-description.md");
    if (!fs.existsSync(jdPath)) continue;
    const metaPath = path.join(dir, "metadata.json");
    let matched = false;
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
        matched = Boolean(needleUrl && meta.url === needleUrl)
          || (String(meta.company || "").toLowerCase() === needleCompany && String(meta.role || "").toLowerCase() === needleTitle);
      } catch {
        matched = false;
      }
    }
    if (!matched) continue;
    const text = fs.readFileSync(jdPath, "utf8").trim();
    if (text.length >= 80) return text.split(/\b(similar offers|recommended by just join|oferty podobne)\b/i)[0].trim();
  }
  return "";
}

export interface ActivityEntry {
  id: string;
  name: string;
  status: "running" | "success" | "failed" | "cancelled";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  stdout: string;
  stderr: string;
  summary: string;
}

class CareerOpsManager {
  private currentOp: ActivityEntry | null = null;
  private recentOps: ActivityEntry[] = [];
  private evalCache = new Map<string, any>();

  constructor() {
    this.loadEvalCache();
  }

  private loadEvalCache() {
    const cachePath = path.join(WORKSPACE_ROOT, "scratch", "dashboard_eval_cache.json");
    if (fs.existsSync(cachePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(cachePath, "utf8"));
        for (const [k, v] of Object.entries(data)) {
          this.evalCache.set(k, v);
        }
      } catch (e) {
        // ignore
      }
    }
  }

  private saveEvalCache() {
    try {
      const scratchDir = path.join(WORKSPACE_ROOT, "scratch");
      if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
      const obj: Record<string, any> = {};
      for (const [k, v] of this.evalCache.entries()) obj[k] = v;
      fs.writeFileSync(path.join(scratchDir, "dashboard_eval_cache.json"), JSON.stringify(obj, null, 2), "utf8");
    } catch (e) {
      // ignore
    }
  }

  public getEvaluationForDisplay(job: { url: string; company: string; title: string; location: string; extra?: string }) {
    const cached = this.evalCache.get(job.url);
    if (cached?.matchVersion === JOB_MATCH_VERSION) return cached;
    const localJd = findLocalJobDescription(job);
    return { ...analyzeJobMatch(job, localJd), matchVersion: JOB_MATCH_VERSION };
  }

  public getActivity() {
    return {
      currentOp: this.currentOp,
      lastOp: this.recentOps.length > 0 ? this.recentOps[0] : null,
      history: this.recentOps.slice(0, 10)
    };
  }

  private recordOpStart(name: string, summary: string, id?: string): ActivityEntry {
    const op: ActivityEntry = {
      id: id || `op-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name,
      status: "running",
      startedAt: new Date().toISOString(),
      stdout: "",
      stderr: "",
      summary
    };
    this.currentOp = op;
    return op;
  }

  private recordOpEnd(op: ActivityEntry, status: "success" | "failed" | "cancelled", stdout: string, stderr: string, summary?: string) {
    op.status = status;
    op.completedAt = new Date().toISOString();
    op.durationMs = new Date(op.completedAt).getTime() - new Date(op.startedAt).getTime();
    op.stdout = stdout.trim();
    op.stderr = stderr.trim();
    if (summary) op.summary = summary;
    this.currentOp = null;
    this.recentOps.unshift(op);
    if (this.recentOps.length > 20) this.recentOps.pop();
  }

  /**
   * Run real scan via allowlisted script scan.mjs
   */
  public async runScan(): Promise<{ success: boolean; data?: any; error?: string }> {
    if (this.currentOp) {
      throw new Error(`Another operation is currently running: ${this.currentOp.name}`);
    }

    const op = this.recordOpStart("Job Search Scan", "Running standard Career-Ops zero-token scanner");

    return new Promise((resolve) => {
      const startTime = Date.now();
      exec("node scan.mjs --json", { cwd: WORKSPACE_ROOT, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          this.recordOpEnd(op, "failed", stdout, stderr, `Scan failed: ${err.message}`);
          return resolve({ success: false, error: err.message });
        }

        try {
          const receipt = JSON.parse(stdout);
          const summary = `Scan completed: ${receipt.found} found, ${receipt.added} new eligible added, ${receipt.filtered} filtered, ${receipt.duplicates} duplicates`;
          this.recordOpEnd(op, "success", stdout, stderr, summary);
          resolve({ success: true, data: receipt });
        } catch (parseErr) {
          this.recordOpEnd(op, "success", stdout, stderr, "Scan finished");
          resolve({ success: true, data: { raw: stdout } });
        }
      });
    });
  }

  /**
   * Run bulk action: deep sweep across all portals to find and filter new offers
   */
  public async runBulkScan(): Promise<{ success: boolean; data?: any; error?: string }> {
    if (this.currentOp) {
      throw new Error(`Another operation is currently running: ${this.currentOp.name}`);
    }

    const op = this.recordOpStart("Bulk Job Discovery Sweep", "Sweeping all portals and ATS sources for new offers");

    return new Promise((resolve) => {
      exec("node scan.mjs --json", { cwd: WORKSPACE_ROOT, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          this.recordOpEnd(op, "failed", stdout, stderr, `Bulk sweep failed: ${err.message}`);
          return resolve({ success: false, error: err.message });
        }

        try {
          const receipt = JSON.parse(stdout);
          const summary = `Bulk sweep finished: ${receipt.found} offers scanned across all portals, ${receipt.added} new eligible added to pipeline`;
          this.recordOpEnd(op, "success", stdout, stderr, summary);
          resolve({ success: true, data: receipt });
        } catch (parseErr) {
          this.recordOpEnd(op, "success", stdout, stderr, "Bulk sweep finished");
          resolve({ success: true, data: { raw: stdout } });
        }
      });
    });
  }

  /**
   * Evaluate a job against cv.md rules
   */
  public async evaluateJob(job: { url: string; company: string; title: string; location: string; extra?: string }, force = false) {
    const cached = this.evalCache.get(job.url);
    if (!force && cached?.matchVersion === JOB_MATCH_VERSION && cached?.evaluatedFrom === "full-jd") return cached;

    const fallback = `${job.title} at ${job.company}. Location: ${job.location || "Unknown"}. ${job.extra || ""}`;
    const localJd = findLocalJobDescription(job);
    const { text: fullJd, source: jdSource } = localJd
      ? { text: localJd, source: "local-output" as const }
      : await getFullJobDescription(job.url, fallback);
    const usableJd = fullJd && fullJd.trim().length >= 80 ? fullJd : "";
    const result = {
      ...analyzeJobMatch(job, usableJd),
      jdSource: usableJd ? jdSource : "fallback",
      matchVersion: JOB_MATCH_VERSION
    };

    this.evalCache.set(job.url, result);
    this.saveEvalCache();
    return result;
  }

  public startTailoredCv(job: PipelineJob, options: { providerId?: string; model?: string } = {}): OperationRecord {
    if (this.currentOp) throw new Error(`Another operation is currently running: ${this.currentOp.name}`);
    const operation = operationManager.create(job.id);
    operationManager.run(operation.operationId, async ({ signal, updateStage }) => {
      const result = await this.generateTailoredCv(job, options, { operationId: operation.operationId, signal, updateStage });
      if (!result.success) throw new Error(result.error || "CV generation failed");
      return result;
    });
    return operation;
  }

  public startCoverLetter(job: PipelineJob, options: { providerId?: string; model?: string } = {}): OperationRecord {
    if (this.currentOp) throw new Error(`Another operation is currently running: ${this.currentOp.name}`);
    const operation = operationManager.create(job.id, "COVER_LETTER");
    operationManager.run(operation.operationId, async ({ signal, updateStage }) => {
      const result = await this.generateCoverLetter(job, options, { operationId: operation.operationId, signal, updateStage });
      if (!result.success) throw new Error(result.error || "Cover Letter generation failed");
      return result;
    });
    return operation;
  }

  public async generateCoverLetter(
    job: PipelineJob,
    options: { providerId?: string; model?: string },
    operation: { operationId: string; signal: AbortSignal; updateStage: (stage: string) => void }
  ): Promise<any> {
    const op = this.recordOpStart("Generate Cover Letter", `Preparing an on-demand Cover Letter for ${job.company} (${job.title})`, operation.operationId);
    const stage = (value: string) => {
      op.summary = value;
      operation.updateStage(value);
    };
    try {
      stage("Loading Job Description");
      const fallback = `${job.title} at ${job.company}. Location: ${job.location || "not specified"}. ${job.extra || ""}`;
      const localJd = findLocalJobDescription(job);
      const { text: fullJd } = localJd
        ? { text: localJd }
        : await getFullJobDescription(job.url, fallback, operation.signal);
      stage("Loading Candidate Context");
      const evaluation = this.getEvaluationForDisplay(job);
      const artifact = await generateCoverArtifact(job, fullJd, evaluation, {
        providerId: options.providerId,
        model: options.model,
        signal: operation.signal,
        operationId: operation.operationId,
        onProgress: stage
      });
      this.recordOpEnd(op, "success", artifact.textPath, "", `Cover Letter ready for ${job.company}`);
      return { success: true, artifact };
    } catch (error: any) {
      if (error instanceof OperationCancelledError || operation.signal.aborted) {
        this.recordOpEnd(op, "cancelled", "", "", "Cover Letter generation cancelled");
        throw new OperationCancelledError();
      }
      this.recordOpEnd(op, "failed", "", error?.message || String(error), `Cover Letter generation failed: ${error?.message || error}`);
      throw error;
    }
  }

  public async rerankJobs(jobs: Array<{ url: string; company: string; title: string; location: string; extra?: string }>, fullJdLimit = 60) {
    const preliminary = jobs.map((job) => {
      const localJd = findLocalJobDescription(job);
      return { job, evaluation: analyzeJobMatch(job, localJd) };
    });
    for (const { job, evaluation } of preliminary) {
      this.evalCache.set(job.url, { ...evaluation, matchVersion: JOB_MATCH_VERSION });
    }

    const candidates = preliminary
      .filter(({ evaluation }) => evaluation.matchClassification !== "SKIP")
      .sort((a, b) => b.evaluation.compatibilityPercent - a.evaluation.compatibilityPercent)
      .slice(0, Math.max(0, Math.min(100, fullJdLimit)));

    let cursor = 0;
    const workers = Array.from({ length: Math.min(4, candidates.length) }, async () => {
      while (cursor < candidates.length) {
        const current = candidates[cursor++];
        await this.evaluateJob(current.job, true);
      }
    });
    await Promise.all(workers);
    this.saveEvalCache();

    const ranked = jobs.map((job) => ({ job, evaluation: this.getEvaluationForDisplay(job) }))
      .sort((a, b) => b.evaluation.compatibilityPercent - a.evaluation.compatibilityPercent);
    return { total: jobs.length, fullJdEvaluated: candidates.length, ranked };
  }

  /**
   * Generate tailored CV using Career-Ops standard pipeline
   */
  public async generateTailoredCv(job: PipelineJob, options?: { providerId?: string; model?: string }): Promise<{
    success: boolean;
    htmlPath: string;
    pdfPath: string;
    filename: string;
    factPass: boolean;
    pages: number;
    primaryDomain?: string;
    tailoredWithAi: boolean;
    fallbackUsed?: boolean;
    fallbackReason?: string;
    aiProvider: string;
    aiModel: string;
    tailoringDiff?: TailoringDiff;
    jobDir?: string;
    error?: string;
  }>;
  public async generateTailoredCv(
    job: PipelineJob,
    options: { providerId?: string; model?: string },
    operation: { operationId: string; signal: AbortSignal; updateStage: (stage: string) => void }
  ): Promise<any>;
  public async generateTailoredCv(
    job: PipelineJob,
    options: { providerId?: string; model?: string } = {},
    operation?: { operationId: string; signal: AbortSignal; updateStage: (stage: string) => void }
  ): Promise<any> {
    if (!operation && this.currentOp) throw new Error(`Another operation is currently running: ${this.currentOp.name}`);

    const op = this.recordOpStart("Generate Tailored CV", `Starting AI tailoring for ${job.company} (${job.title})`, operation?.operationId);
    const stage = (value: string) => {
      op.summary = value;
      operation?.updateStage(value.replace(/^\[\d+\/\d+\]\s*/, ""));
    };
    const providerEvents: string[] = [];
    let fallbackReason = "";

    try {
      stage("[1/5] Loading Job Description");
      const fallbackText = `${job.title} at ${job.company}. Location: ${job.location || "Remote"}. ${job.extra || ""}`;
      const localJd = findLocalJobDescription(job);
      const { text: fullJd, source: jdSource } = localJd
        ? { text: localJd, source: "manual/local" as const }
        : await getFullJobDescription(job.url, fallbackText, operation?.signal);

      stage("[2/5] Loading Candidate Knowledge");

      const selectedProvider = options.providerId || "configured provider";
      let aiResult: Awaited<ReturnType<typeof runAiTailoring>> | null = null;
      try {
        stage("[3/5] Classifying Domain");
        stage(`[3/5] AI Tailoring with ${selectedProvider}`);
        aiResult = await runAiTailoring(
          job,
          fullJd,
          options,
          (progress) => {
            stage(`[3/5] ${progress}`);
          },
          (event) => {
            const line = `[AI ${event.type.toUpperCase()}] ${event.message}`;
            providerEvents.push(line);
            op.stdout = providerEvents.join("\n");
          },
          operation?.signal
        );
      } catch (aiErr: any) {
        if (aiErr instanceof OperationCancelledError || aiErr instanceof ProcessTimeoutError || operation?.signal.aborted) throw aiErr;
        if (aiErr instanceof DomainValidationError || aiErr?.name === "DomainValidationError") {
          throw aiErr;
        }
        fallbackReason = aiErr.message || String(aiErr);
        providerEvents.push(`[FALLBACK] AI tailoring failed: ${fallbackReason}`);
        stage("[3/5] AI failed — generating a simple CV from cv.md");
      }

      let renderResult: Awaited<ReturnType<typeof renderAndValidateTailoredCv>>;
      if (aiResult) {
        try {
          stage("[4/5] Fact Validation");
          renderResult = await renderAndValidateTailoredCv(job, fullJd, aiResult, (progress) => {
            stage(progress);
          }, { operationId: operation?.operationId, signal: operation?.signal });
        } catch (renderErr: any) {
          if (renderErr instanceof OperationCancelledError || renderErr instanceof ProcessTimeoutError || operation?.signal.aborted) throw renderErr;
          if (renderErr instanceof DomainValidationError || renderErr?.name === "DomainValidationError") {
            throw renderErr;
          }
          fallbackReason = renderErr.message || String(renderErr);
          providerEvents.push(`[FALLBACK] AI CV render failed: ${fallbackReason}`);
          aiResult = null;
        }
      }

      if (!aiResult) {
        stage("[4/5] Building HTML and PDF from cv.md");
        const simple = buildSimpleTailorResult(job);
        renderResult = await renderAndValidateTailoredCv(job, fullJd, simple, (progress) => {
          stage(progress);
        }, { operationId: operation?.operationId, signal: operation?.signal });
      }

      const tailoredWithAi = !fallbackReason;
      const summary = tailoredWithAi
        ? `Tailored CV generated with ${renderResult!.metadata.aiProvider} for ${job.company} (${renderResult!.metadata.pages} pages)`
        : `AI tailoring failed; generated a simple CV from cv.md for ${job.company}`;
      const combinedLogs = `--- PROVIDER EVENTS ---\n${providerEvents.join("\n")}\n--- JD SOURCE ---\n${jdSource} (${fullJd.length} chars)\n--- FALLBACK ---\n${fallbackReason || "none"}\n--- AI PROVIDER ---\n${renderResult!.metadata.provider}\n--- FACT CHECK ---\n${renderResult!.metadata.factValidation}\n--- METADATA ---\n${JSON.stringify(renderResult!.metadata.tailoringDiff, null, 2)}`;
      this.recordOpEnd(op, "success", combinedLogs, "", summary);

      return {
        success: true,
        htmlPath: renderResult!.htmlPath,
        pdfPath: renderResult!.pdfPath,
        filename: path.basename(renderResult!.pdfPath),
        factPass: true,
        pages: renderResult!.metadata.pages,
        primaryDomain: renderResult!.metadata.primaryDomain,
        tailoredWithAi,
        fallbackUsed: Boolean(fallbackReason),
        fallbackReason: fallbackReason || undefined,
        aiProvider: renderResult!.metadata.aiProvider,
        aiModel: renderResult!.metadata.aiModel,
        tailoringDiff: renderResult!.metadata.tailoringDiff,
        jobDir: renderResult!.jobDir
      };
    } catch (err: any) {
      if (err instanceof OperationCancelledError || operation?.signal.aborted) {
        this.recordOpEnd(op, "cancelled", "", "", "Generation cancelled");
        throw new OperationCancelledError();
      }
      if (err instanceof ProcessTimeoutError) {
        this.recordOpEnd(op, "failed", "", err.message, err.message);
        throw err;
      }
      const msg = err.stdout ? err.stdout.toString() : err.message;
      this.recordOpEnd(op, "failed", "", String(msg), `CV generation failed: ${err.message}`);
      return {
        success: false,
        htmlPath: "",
        pdfPath: "",
        filename: "",
        factPass: false,
        pages: 0,
        primaryDomain: undefined,
        tailoredWithAi: false,
        fallbackUsed: false,
        aiProvider: options.providerId || "configured provider",
        aiModel: options.model || "default",
        error: String(msg)
      };
    }
  }

  public generateMasterCv(): {
    success: boolean;
    htmlPath: string;
    pdfPath: string;
    filename: string;
    error?: string;
  } {
    if (this.currentOp) {
      throw new Error(`Another operation is currently running: ${this.currentOp.name}`);
    }
    const op = this.recordOpStart("Generate Master CV", "Rendering ATS PDF from cv.md");
    try {
      const result = renderMasterCv((stage) => {
        op.summary = stage;
      });
      this.recordOpEnd(op, "success", result.pdfPath, "", `Master ATS CV generated: ${result.filename}`);
      return { success: true, ...result };
    } catch (err: any) {
      const msg = err.message || String(err);
      this.recordOpEnd(op, "failed", "", msg, `Master CV generation failed: ${msg}`);
      return { success: false, htmlPath: "", pdfPath: "", filename: "", error: msg };
    }
  }
}

export const careerOps = new CareerOpsManager();

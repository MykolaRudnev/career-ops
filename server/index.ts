import fs from "node:fs";
import { readProviderHealth } from "../discovery/health.mjs";
import express from "express";
import cors from "cors";
import path from "node:path";
import {
  WORKSPACE_ROOT,
  parsePipeline,
  updatePipelineStatus,
  updateJobBid,
  getMasterCvStatus,
  getTailoredCvs,
  getLastScanInfo,
  openLocalTarget,
  getTailoringDiff
} from "./fileAccess.ts";
import { careerOps } from "./careerOps.ts";
import { aiProviderRegistry } from "./ai/providerRegistry.ts";
import { loadDashboardProfile } from "./profile.ts";
import { createManualJob, loadManualJobs } from "./manualJobs.ts";
import { operationManager } from "./operations.ts";
import { applicationCoverContext, loadCoverLetter, saveCoverLetterEdit } from "./coverLetter.ts";

const app = express();
const PORT = 3001;
const HOST = "127.0.0.1"; // Security: localhost only

app.use(cors({
  origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
  methods: ["GET", "POST", "PUT"]
}));

app.use(express.json({ limit: "2mb" }));

app.get("/api/discovery/health", (_req, res) => {
  try { res.json(readProviderHealth()); } catch { res.status(500).json({error:"Source health unavailable"}); }
});

// AI providers are backend-owned allowlisted implementations; the browser never supplies commands.
app.get("/api/ai/providers", async (req, res) => {
  try {
    const health = await aiProviderRegistry.getHealth();
    res.json({ success: true, ...health });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put("/api/ai/config", (req, res) => {
  try {
    const { defaultProvider, fallbackEnabled, providerId, model } = req.body || {};
    const config = aiProviderRegistry.saveConfig({ defaultProvider, fallbackEnabled, providerId, model });
    res.json({ success: true, config });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post("/api/ai/providers/:providerId/test", async (req, res) => {
  try {
    const result = await aiProviderRegistry.testProvider(req.params.providerId, req.body?.model);
    res.status(result.success ? 200 : 503).json(result);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 1. Overall System Status
app.get("/api/status", (req, res) => {
  try {
    const masterCv = getMasterCvStatus();
    const lastScan = getLastScanInfo();
    const tailoredCvs = getTailoredCvs();
    const pipelineData = parsePipeline();
    const activity = careerOps.getActivity();

    res.json({
      success: true,
      candidate: loadDashboardProfile(),
      masterCv,
      lastScan,
      tailoredCount: tailoredCvs.length,
      pipelineCounts: {
        pending: pipelineData.pending.length,
        processed: pipelineData.processed.length
      },
      activity
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Pipeline Jobs
app.get("/api/pipeline", (req, res) => {
  try {
    const { pending, processed } = parsePipeline();

    // Attach cached evaluations
    const enrich = (job: any) => {
      const evalData = careerOps.getEvaluationForDisplay(job);
      if (evalData) {
        return { ...job, ...evalData };
      }
      return job;
    };

    res.json({
      success: true,
      pending: pending.map(enrich),
      processed: processed.map(enrich)
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Trigger Real Scan
app.post("/api/scan", async (req, res) => {
  try {
    const result = await careerOps.runScan();
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 3b. Trigger Bulk Scan to Look for New Offers
app.post("/api/scan/bulk", async (req, res) => {
  try {
    const result = await careerOps.runBulkScan();
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 4. Evaluate Single Job
app.post("/api/evaluate", async (req, res) => {
  try {
    const { job } = req.body;
    if (!job || !job.url) {
      return res.status(400).json({ success: false, error: "Missing job object or url" });
    }
    const evalResult = await careerOps.evaluateJob(job);
    res.json({ success: true, evaluation: evalResult });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/evaluate/all", async (req, res) => {
  try {
    const { pending } = parsePipeline();
    const limit = Number.isFinite(Number(req.body?.fullJdLimit)) ? Number(req.body.fullJdLimit) : 60;
    const result = await careerOps.rerankJobs(pending, limit);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Generate Tailored CV
app.post("/api/tailor-cv", async (req, res) => {
  try {
    const { job, providerId, model } = req.body;
    if (!job || !job.company || !job.title) {
      return res.status(400).json({ success: false, error: "Missing job company or title" });
    }
    const operation = careerOps.startTailoredCv(job, { providerId, model });
    res.status(202).json({ success: true, operation });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Cover Letters are deliberately on-demand. No scan, evaluation, CV, manual-job,
// or apply endpoint calls this route implicitly.
app.post("/api/cover-letter/generate", (req, res) => {
  try {
    const { job, providerId, model } = req.body || {};
    if (!job?.id || !job?.company || !job?.title) {
      return res.status(400).json({ success: false, error: "Missing job id, company, or title" });
    }
    const operation = careerOps.startCoverLetter(job, { providerId, model });
    res.status(202).json({ success: true, operation });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post("/api/cover-letter/status", (req, res) => {
  try {
    const { job } = req.body || {};
    if (!job?.company || !job?.title) return res.status(400).json({ success: false, error: "Missing job" });
    res.json({ success: true, artifact: loadCoverLetter(job) });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put("/api/cover-letter", (req, res) => {
  try {
    const { job, content } = req.body || {};
    if (!job?.company || !job?.title) return res.status(400).json({ success: false, error: "Missing job" });
    res.json({ success: true, artifact: saveCoverLetterEdit(job, content) });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get("/api/cover-letter/download", (req, res) => {
  const job = { company: String(req.query.company || ""), title: String(req.query.title || "") };
  const artifact = loadCoverLetter(job);
  if (!artifact) return res.status(404).json({ success: false, error: "Cover Letter not found" });
  res.download(artifact.textPath, "cover-letter.txt");
});

app.post("/api/cover-letter/application-context", (req, res) => {
  try {
    const { job, maxChars } = req.body || {};
    const content = applicationCoverContext(job || {}, Number(maxChars) || 0);
    if (!content) return res.status(404).json({ success: false, error: "Cover Letter not found" });
    res.json({ success: true, content });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get("/api/operations", (_req, res) => {
  res.json({ success: true, operations: operationManager.list() });
});

app.get("/api/operations/:operationId", (req, res) => {
  const operation = operationManager.get(req.params.operationId);
  if (!operation) return res.status(404).json({ success: false, error: "Operation not found" });
  res.json({ success: true, operation });
});

app.post("/api/operations/:operationId/cancel", (req, res) => {
  try {
    const operation = operationManager.cancel(req.params.operationId);
    res.json({ success: true, operation });
  } catch (err: any) {
    res.status(404).json({ success: false, error: err.message });
  }
});

app.get("/api/manual-jobs", (_req, res) => {
  res.json({ success: true, jobs: loadManualJobs() });
});

app.post("/api/manual-jobs", async (req, res) => {
  try {
    const { job: input, addAnyway, generateCv, providerId, model } = req.body || {};
    const created = await createManualJob(input || {}, { addAnyway: addAnyway === true });
    if (!created.created) {
      return res.status(409).json({ success: false, duplicate: true, existingJobs: created.duplicates });
    }
    const job = created.job!;
    const evaluation = await careerOps.evaluateJob(job);
    const operation = generateCv === true ? careerOps.startTailoredCv(job, { providerId, model }) : undefined;
    res.status(201).json({ success: true, job: { ...job, ...evaluation }, evaluation, operation });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post("/api/master-cv", (req, res) => {
  try {
    const result = careerOps.generateMasterCv();
    res.status(result.success ? 200 : 500).json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5b. Get Tailoring Diff and Metadata
app.get("/api/tailor-cv/diff", (req, res) => {
  try {
    const company = (req.query.company as string) || "";
    const title = (req.query.title as string) || "";
    const diff = getTailoringDiff(company, title);
    if (!diff) {
      return res.status(404).json({ success: false, error: "No tailoring metadata found for this job" });
    }
    res.json({ success: true, data: diff });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Update Job Status in pipeline.md
app.post("/api/pipeline/status", async (req, res) => {
  try {
    const { url, status } = req.body;
    if (!url || !status) {
      return res.status(400).json({ success: false, error: "Missing url or status" });
    }
    const updated = await updatePipelineStatus(url, status);
    res.json({ success: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6b. Update Job Proposed Rate / Bid
app.post("/api/job/bid", async (req, res) => {
  try {
    const { url, bid, jobId } = req.body || {};
    if (!url && !jobId) {
      return res.status(400).json({ success: false, error: "Missing url or jobId" });
    }
    const updated = await updateJobBid(url || "", bid || "", jobId);
    res.json({ success: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Open Local Target (xdg-open)
app.post("/api/open", async (req, res) => {
  try {
    const { type, payload } = req.body;
    const result = await openLocalTarget(type, payload);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 8. List Tailored CVs
app.get("/api/tailored-cvs", (req, res) => {
  try {
    const cvs = getTailoredCvs();
    res.json({ success: true, cvs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Activity Log
app.get("/api/activity", (req, res) => {
  try {
    const activity = careerOps.getActivity();
    res.json({ success: true, ...activity });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// Serve static built UI if available
const distPath = path.join(WORKSPACE_ROOT, "ui", "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    if (!req.path.startsWith("/api")) {
      res.sendFile(path.join(distPath, "index.html"));
    }
  });
}

// Start listening strictly on 127.0.0.1
app.listen(PORT, HOST, () => {
  console.log(`🚀 Career-Ops Local Backend running at http://${HOST}:${PORT}`);
});

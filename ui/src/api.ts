export interface PipelineJob {
  id: string;
  url: string;
  company: string;
  title: string;
  location: string;
  countries: string[];
  workModel: string;
  date: string;
  status: "pending" | "reviewed" | "applied" | "skipped" | "expired";
  extra: string;
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
  bid?: string;
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

export function appliedJobsJson(jobs: PipelineJob[]): string {
  return JSON.stringify(jobs.filter((job) => job.status === "applied").map((job) => ({
    company: job.company,
    title: job.title,
    url: job.url,
    location: job.location || "",
    date: job.date || "",
    status: "applied",
    bid: job.bid || "",
    source: job.sourceName || "",
    notes: job.notes || "",
  })), null, 2);
}

export type OperationStatus = "PENDING" | "RUNNING" | "CANCELLING" | "CANCELLED" | "COMPLETED" | "FAILED";

export interface OperationRecord {
  operationId: string;
  jobId: string;
  type: "TAILORED_CV" | "COVER_LETTER" | "APPLICATION";
  status: OperationStatus;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  currentStage: string;
  error?: string;
  errorType?: "FAILED" | "TIMEOUT" | "INTERRUPTED";
  result?: any;
}

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

export interface CoverLetterArtifact {
  content: string;
  markdownPath: string;
  textPath: string;
  metadataPath: string;
  cvChangedSince: boolean;
  metadata: {
    provider: string;
    model: string;
    generatedAt: string;
    durationMs: number;
    jobId: string;
    company: string;
    role: string;
    basedOnTailoredCv: boolean;
    tailoredCvModifiedAt: string | null;
    wordCount: number;
    characterCount?: number;
    format?: "short-form";
    url?: string;
    factValidation: "PASS" | "WARN";
    editedAt?: string;
    editCount?: number;
  };
}

export interface SystemStatus {
  candidate: { name: string; headline: string; location: string };
  masterCv: {
    mdExists: boolean;
    mdPath: string;
    mdModified: string | null;
    mdSize: number;
    pdfExists: boolean;
    pdfPath: string;
    pdfModified: string | null;
    pdfSize: number;
    pdfFilename: string;
  };
  lastScan: {
    lastRun: string | null;
    totalDiscovered: number;
    totalFiltered: number;
    totalDuplicates: number;
    totalAdded: number;
  };
  tailoredCount: number;
  pipelineCounts: {
    pending: number;
    processed: number;
  };
  activity: {
    currentOp: any;
    lastOp: any;
    history: any[];
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

export interface AiModelInfo {
  id: string;
  name: string;
  isDefault?: boolean;
}

export interface AiProviderInfo {
  id: string;
  name: string;
  enabled: boolean;
  available: boolean;
  status: "ready" | "not_installed" | "disabled" | "rate_limited" | "quota_exhausted" | "auth_required" | "temporary_unavailable" | "error";
  statusMessage?: string;
  models: AiModelInfo[];
  selectedModel: string;
  lastTestedAt?: string;
  responseTimeMs?: number;
}

export interface AiProvidersResponse {
  defaultProvider: string;
  fallbackEnabled: boolean;
  providers: AiProviderInfo[];
}

export interface AiProviderTestResult {
  provider: string;
  model: string;
  success: boolean;
  responseTimeMs: number;
  response?: string;
  status: string;
  error?: string;
}

const API_BASE = "";

export async function fetchStatus(): Promise<SystemStatus> {
  const res = await fetch(`${API_BASE}/api/status`);
  if (!res.ok) throw new Error("Failed to fetch status");
  const data = await res.json();
  return data;
}

export async function fetchPipeline(): Promise<{ pending: PipelineJob[]; processed: PipelineJob[] }> {
  const res = await fetch(`${API_BASE}/api/pipeline`);
  if (!res.ok) throw new Error("Failed to fetch pipeline");
  const data = await res.json();
  return { pending: data.pending, processed: data.processed };
}

export async function runJobSearch(): Promise<any> {
  const res = await fetch(`${API_BASE}/api/scan`, { method: "POST" });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || "Search failed");
  return data.data;
}

export async function runBulkJobSearch(): Promise<any> {
  const res = await fetch(`${API_BASE}/api/scan/bulk`, { method: "POST" });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || "Bulk search failed");
  return data.data;
}

export function isBestMatchOffer(job: PipelineJob): boolean {
  return job.matchClassification === "BEST MATCH";
}

export async function rerankPipeline(fullJdLimit = 60): Promise<any> {
  const res = await fetch(`${API_BASE}/api/evaluate/all`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fullJdLimit })
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || "Re-ranking failed");
  return data;
}

export async function evaluateJob(job: PipelineJob): Promise<any> {
  const res = await fetch(`${API_BASE}/api/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job })
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || "Evaluation failed");
  return data.evaluation;
}

export async function generateTailoredCv(job: PipelineJob, providerId: string, model?: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/tailor-cv`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job, providerId, model })
  });
  const data = await res.json();
  if (!res.ok || !data?.success) throw new Error(data.error || "Tailoring failed");
  return data.operation as OperationRecord;
}

export async function generateCoverLetter(job: PipelineJob, providerId: string, model?: string): Promise<OperationRecord> {
  const res = await fetch(`${API_BASE}/api/cover-letter/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job, providerId, model })
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || "Cover Letter generation failed");
  return data.operation;
}

export async function fetchCoverLetter(job: PipelineJob): Promise<CoverLetterArtifact | null> {
  const res = await fetch(`${API_BASE}/api/cover-letter/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job })
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || "Could not load Cover Letter");
  return data.artifact || null;
}

export async function saveCoverLetter(job: PipelineJob, content: string): Promise<CoverLetterArtifact> {
  const res = await fetch(`${API_BASE}/api/cover-letter`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job, content })
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || "Could not save Cover Letter");
  return data.artifact;
}

export function coverLetterDownloadUrl(job: PipelineJob): string {
  return `${API_BASE}/api/cover-letter/download?company=${encodeURIComponent(job.company)}&title=${encodeURIComponent(job.title)}&url=${encodeURIComponent(job.url)}`;
}

export async function fetchApplicationCoverContext(job: PipelineJob, maxChars = 0): Promise<string> {
  const res = await fetch(`${API_BASE}/api/cover-letter/application-context`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job, maxChars })
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || "Could not prepare application context");
  return data.content;
}

export async function fetchOperations(): Promise<OperationRecord[]> {
  const res = await fetch(`${API_BASE}/api/operations`);
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || "Failed to load operations");
  return data.operations || [];
}

export async function cancelOperation(operationId: string): Promise<OperationRecord> {
  const res = await fetch(`${API_BASE}/api/operations/${encodeURIComponent(operationId)}/cancel`, { method: "POST" });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || "Cancellation failed");
  return data.operation;
}

export async function createManualJob(
  job: ManualJobInput,
  options: { addAnyway?: boolean; generateCv?: boolean; providerId?: string; model?: string } = {}
): Promise<{ job: PipelineJob; evaluation: any; operation?: OperationRecord }> {
  const res = await fetch(`${API_BASE}/api/manual-jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job, ...options })
  });
  const data = await res.json();
  if (res.status === 409 && data.duplicate) {
    const error: any = new Error("A matching manual job already exists");
    error.code = "DUPLICATE";
    error.existingJobs = data.existingJobs || [];
    throw error;
  }
  if (!res.ok || !data.success) throw new Error(data.error || "Could not add manual job");
  return data;
}

export async function generateMasterCv(): Promise<any> {
  const res = await fetch(`${API_BASE}/api/master-cv`, { method: "POST" });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || "Master CV generation failed");
  return data;
}

export async function fetchAiProviders(): Promise<AiProvidersResponse> {
  const res = await fetch(`${API_BASE}/api/ai/providers`);
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || "Failed to load AI providers");
  return { defaultProvider: data.defaultProvider, fallbackEnabled: data.fallbackEnabled, providers: data.providers };
}

export async function updateAiConfig(update: {
  defaultProvider?: string;
  fallbackEnabled?: boolean;
  providerId?: string;
  model?: string;
}): Promise<void> {
  const res = await fetch(`${API_BASE}/api/ai/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update)
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || "Failed to update AI settings");
}

export async function testAiProvider(providerId: string, model?: string): Promise<AiProviderTestResult> {
  const res = await fetch(`${API_BASE}/api/ai/providers/${encodeURIComponent(providerId)}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model })
  });
  const data = await res.json();
  if (!data || typeof data.success !== "boolean") throw new Error(data.error || "Provider test failed");
  return data;
}

export async function updateJobStatus(url: string, status: "reviewed" | "applied" | "skipped"): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/pipeline/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, status })
  });
  const data = await res.json();
  return data.success;
}

export async function updateJobBid(url: string, bid: string, jobId?: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/job/bid`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, bid, jobId })
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || "Failed to update rate/bid");
  return data.success;
}

export async function openTarget(type: "master-cv" | "master-pdf" | "master-folder" | "cv-folder" | "tailored-cv" | "url", payload?: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, payload })
  });
  const data = await res.json();
  return data;
}

export async function fetchTailoredCvs(): Promise<TailoredCvFile[]> {
  const res = await fetch(`${API_BASE}/api/tailored-cvs`);
  const data = await res.json();
  return data.cvs || [];
}

export async function fetchActivity(): Promise<any> {
  const res = await fetch(`${API_BASE}/api/activity`);
  const data = await res.json();
  return data;
}

export interface TailoringDiffData {
  jobId: string;
  company: string;
  role: string;
  url: string;
  location?: string;
  generatedAt: string;
  provider?: string;
  model?: string;
  durationMs?: number;
  success?: boolean;
  factCheck?: string;
  aiProvider: string;
  aiModel: string;
  llmTailoringExecuted: boolean;
  factValidation: string;
  pages: number;
  primaryDomain?: string;
  secondaryDomains?: string[];
  tailoringDiff: {
    summary_focus: string;
    skills_promoted: string[];
    skills_omitted?: Array<{ domain: string; reason: string }>;
    projects_selected: Array<{ name: string; reason: string }>;
    jd_keywords_matched: string[];
    experience_emphasis: string;
    primary_domain?: string;
    secondary_domains?: string[];
  };
  htmlPath: string;
  pdfPath: string;
}

export async function fetchTailoringDiff(company: string, title?: string): Promise<TailoringDiffData | null> {
  const params = new URLSearchParams({ company, title: title || "" });
  const res = await fetch(`${API_BASE}/api/tailor-cv/diff?${params.toString()}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.data || null;
}

export async function fetchApplicationHistory(): Promise<any[]> {
  const res = await fetch('/api/applications');
  if (!res.ok) throw new Error('Could not load application history');
  return (await res.json()).attempts;
}
export async function startApplications(jobs: PipelineJob[], mode: 'DRY_RUN' | 'SUBMIT', providerId: string, model: string): Promise<OperationRecord> {
  const res = await fetch('/api/applications', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobs: jobs.map(({ id, url }) => ({ id, url })), mode, providerId, model })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not start applications');
  return data.operation;
}

export interface JobArtifacts {
  pdfPath: string | null;
  folderPath: string | null;
  filename: string | null;
  modified: string | null;
  coverReady: boolean;
}
export async function fetchJobArtifacts(job: PipelineJob): Promise<JobArtifacts> {
  const res = await fetch(`${API_BASE}/api/job/artifacts`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not load job artifacts");
  return data;
}

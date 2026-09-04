import fs from "node:fs";
import path from "node:path";
import { WORKSPACE_ROOT } from "./fileAccess.ts";
import { OperationCancelledError, ProcessTimeoutError } from "./process.ts";

export type OperationStatus = "PENDING" | "RUNNING" | "CANCELLING" | "CANCELLED" | "COMPLETED" | "FAILED";

export interface OperationRecord {
  operationId: string;
  jobId: string;
  type: "TAILORED_CV" | "COVER_LETTER";
  status: OperationStatus;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  currentStage: string;
  error?: string;
  errorType?: "FAILED" | "TIMEOUT" | "INTERRUPTED";
  result?: any;
}

interface ActiveOperation {
  record: OperationRecord;
  controller: AbortController;
}

const STORE_PATH = path.join(WORKSPACE_ROOT, "scratch", "dashboard-operations.json");

export class OperationManager {
  private records = new Map<string, OperationRecord>();
  private active = new Map<string, ActiveOperation>();

  constructor() {
    this.load();
  }

  private load() {
    if (!fs.existsSync(STORE_PATH)) return;
    try {
      const rows = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
      for (const record of Array.isArray(rows) ? rows : []) {
        if (["PENDING", "RUNNING", "CANCELLING"].includes(record.status)) {
          record.status = "FAILED";
          record.errorType = "INTERRUPTED";
          record.error = "Operation interrupted because the dashboard backend restarted";
          record.currentStage = "Interrupted";
          record.completedAt = new Date().toISOString();
          record.updatedAt = record.completedAt;
        }
        this.records.set(record.operationId, record);
      }
      this.persist();
    } catch {
      // A corrupt activity cache must never block the dashboard.
    }
  }

  private persist() {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    const rows = [...this.records.values()]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 100);
    const tmp = `${STORE_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rows, null, 2), "utf8");
    fs.renameSync(tmp, STORE_PATH);
  }

  create(jobId: string, type: OperationRecord["type"] = "TAILORED_CV"): OperationRecord {
    const existing = this.findActiveForJob(jobId, type);
    if (existing) throw new Error(`${type === "COVER_LETTER" ? "Cover Letter" : "CV"} generation already in progress for this job (${existing.operationId})`);
    const now = new Date().toISOString();
    const record: OperationRecord = {
      operationId: `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      jobId,
      type,
      status: "PENDING",
      startedAt: now,
      updatedAt: now,
      currentStage: "Preparing"
    };
    this.records.set(record.operationId, record);
    this.active.set(record.operationId, { record, controller: new AbortController() });
    this.persist();
    return { ...record };
  }

  run(operationId: string, task: (ctx: { signal: AbortSignal; updateStage: (stage: string) => void }) => Promise<any>): void {
    const active = this.active.get(operationId);
    if (!active) throw new Error(`Unknown active operation: ${operationId}`);
    active.record.status = "RUNNING";
    active.record.updatedAt = new Date().toISOString();
    this.persist();
    void task({
      signal: active.controller.signal,
      updateStage: (stage) => this.updateStage(operationId, stage)
    }).then((result) => {
      if (active.controller.signal.aborted) {
        active.record.status = "CANCELLED";
        active.record.currentStage = "Generation cancelled";
        active.record.error = "Cancelled by user";
        return;
      }
      active.record.status = "COMPLETED";
      active.record.currentStage = "Complete";
      active.record.result = result;
    }).catch((error: any) => {
      if (error instanceof OperationCancelledError || active.controller.signal.aborted) {
        active.record.status = "CANCELLED";
        active.record.currentStage = "Generation cancelled";
        active.record.error = "Cancelled by user";
      } else {
        active.record.status = "FAILED";
        active.record.currentStage = "Failed";
        active.record.error = error?.message || String(error);
        active.record.errorType = error instanceof ProcessTimeoutError ? "TIMEOUT" : "FAILED";
      }
    }).finally(() => {
      active.record.completedAt = new Date().toISOString();
      active.record.updatedAt = active.record.completedAt;
      this.active.delete(operationId);
      this.persist();
    });
  }

  updateStage(operationId: string, stage: string) {
    const record = this.records.get(operationId);
    if (!record || !["PENDING", "RUNNING", "CANCELLING"].includes(record.status)) return;
    record.currentStage = stage;
    record.updatedAt = new Date().toISOString();
    this.persist();
  }

  cancel(operationId: string): OperationRecord {
    const active = this.active.get(operationId);
    const record = this.records.get(operationId);
    if (!record) throw new Error(`Operation not found: ${operationId}`);
    if (!active || !["PENDING", "RUNNING", "CANCELLING"].includes(record.status)) return { ...record };
    if (record.status !== "CANCELLING") {
      record.status = "CANCELLING";
      record.currentStage = "Cancelling...";
      record.updatedAt = new Date().toISOString();
      this.persist();
      active.controller.abort(new OperationCancelledError());
    }
    return { ...record };
  }

  get(operationId: string) {
    const record = this.records.get(operationId);
    return record ? { ...record } : null;
  }

  list() {
    return [...this.records.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map((row) => ({ ...row }));
  }

  findActiveForJob(jobId: string, type?: OperationRecord["type"]) {
    return this.list().find((row) => row.jobId === jobId && (!type || row.type === type) && ["PENDING", "RUNNING", "CANCELLING"].includes(row.status));
  }
}

export const operationManager = new OperationManager();

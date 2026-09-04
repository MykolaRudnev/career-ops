import type { AiProviderStatus } from "./types.ts";
import { OperationCancelledError, ProcessTimeoutError, runCancellableCommand } from "../process.ts";

export class ProviderExecutionError extends Error {
  readonly status: AiProviderStatus;
  readonly stderr: string;

  constructor(message: string, status: AiProviderStatus = "error", stderr = "") {
    super(message);
    this.name = "ProviderExecutionError";
    this.status = status;
    this.stderr = stderr;
  }
}

export function classifyProviderError(message: string): AiProviderStatus {
  const text = message.toLowerCase();
  if (/not found|enoent|is not recognized|no such file/.test(text)) return "not_installed";
  if (/quota|resource[_ -]?exhausted|limit exhausted/.test(text)) return "quota_exhausted";
  if (/rate.?limit|too many requests|\b429\b/.test(text)) return "rate_limited";
  if (/not authenticated|authentication|unauthorized|login required|sign in|\b401\b/.test(text)) return "auth_required";
  if (/timeout|timed out|temporar|unavailable|\b502\b|\b503\b|\b504\b|econnreset|enotfound/.test(text)) {
    return "temporary_unavailable";
  }
  return "error";
}

export function usefulError(message: string, stderr = ""): string {
  const combined = [stderr.trim(), message.trim()].filter(Boolean).join("\n");
  const lines = combined.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(-8).join("\n").slice(0, 1200) || "Provider returned an unknown error";
}

export function execFileAsync(
  executable: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; maxBuffer?: number; signal?: AbortSignal } = {}
): Promise<{ stdout: string; stderr: string }> {
  return runCancellableCommand(executable, args, {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? 5 * 60_000,
    maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
    signal: options.signal
  }).catch((error: any) => {
    if (error instanceof OperationCancelledError || error instanceof ProcessTimeoutError) throw error;
    const stderr = String(error?.stderr || "");
    const summary = usefulError(error?.message || String(error), stderr);
    throw new ProviderExecutionError(summary, classifyProviderError(summary), stderr);
  });
}

export async function executableAvailable(executable: string, versionArgs = ["--version"], signal?: AbortSignal): Promise<boolean> {
  try {
    await execFileAsync(executable, versionArgs, { timeoutMs: 10_000, maxBuffer: 1024 * 1024, signal });
    return true;
  } catch (error) {
    if (error instanceof OperationCancelledError) throw error;
    return false;
  }
}

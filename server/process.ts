import { spawn, type ChildProcess } from "node:child_process";

export class OperationCancelledError extends Error {
  constructor(message = "Cancelled by user") {
    super(message);
    this.name = "OperationCancelledError";
  }
}

export class ProcessTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Provider timed out after ${Math.ceil(timeoutMs / 60_000)} minutes`);
    this.name = "ProcessTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  // child.killed only means kill() successfully sent a signal; it does not
  // mean the process has exited. Checking it here would suppress SIGKILL for
  // a process that ignored the initial SIGTERM.
  if (!child.pid || child.exitCode !== null) return;
  try {
    if (process.platform !== "win32") {
      // Every cancellable command owns its own process group, so this cannot
      // affect unrelated CLI/browser/PDF processes.
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    try { child.kill(signal); } catch { /* already exited */ }
  }
}

export function terminateProcessTree(child: ChildProcess, graceMs = 1_500): void {
  signalProcessTree(child, "SIGTERM");
  const timer = setTimeout(() => signalProcessTree(child, "SIGKILL"), graceMs);
  timer.unref();
}

export function runCancellableCommand(
  executable: string,
  args: string[],
  options: {
    cwd?: string;
    timeoutMs?: number;
    maxBuffer?: number;
    signal?: AbortSignal;
    env?: NodeJS.ProcessEnv;
  } = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new OperationCancelledError());
      return;
    }

    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const maxBuffer = options.maxBuffer ?? 10 * 1024 * 1024;
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => terminateProcessTree(child);
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes <= maxBuffer) stdout.push(chunk);
      else terminateProcessTree(child);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes <= maxBuffer) stderr.push(chunk);
      else terminateProcessTree(child);
    });

    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code, signal) => finish(() => {
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (options.signal?.aborted) return reject(new OperationCancelledError());
      if (timedOut) return reject(new ProcessTimeoutError(options.timeoutMs!));
      if (outputBytes > maxBuffer) return reject(new Error(`Process output exceeded ${maxBuffer} bytes`));
      if (code !== 0) {
        const failure: any = new Error(`${executable} exited with code ${code}${signal ? ` (${signal})` : ""}`);
        failure.stdout = out;
        failure.stderr = err;
        failure.code = code;
        return reject(failure);
      }
      resolve({ stdout: out, stderr: err });
    }));

    const timeout = options.timeoutMs && options.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          terminateProcessTree(child);
        }, options.timeoutMs)
      : undefined;
    timeout?.unref();
  });
}

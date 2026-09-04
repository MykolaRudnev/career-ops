import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");

test("manual Shopify and React JDs use the existing deterministic domain router", async () => {
  const { classifyDomain, domainProjectPool } = await import(pathToFileURL(path.join(ROOT, "server/cvDomainRouting.mjs")));
  const shopify = classifyDomain("Shopify Developer", "Build Shopify themes with Liquid, custom sections, storefront product pages, collections and checkout improvements.");
  assert.equal(shopify.primary, "SHOPIFY");
  assert.ok(domainProjectPool(shopify.primary).every((project) => ["Glasy.pl", "Ascent", "Warmsome", "Pixel25", "Berg's", "Diamandia"].includes(project.name)));

  const react = classifyDomain("Senior React Developer", "Build React and Next.js web applications with TypeScript, reusable components, accessibility, performance and REST APIs.");
  assert.equal(react.primary, "REACT_FRONTEND");
  assert.ok(domainProjectPool(react.primary).every((project) => !["Glasy.pl", "Ascent", "Warmsome", "Pixel25"].includes(project.name)));
});

test("manual job persists to rich storage, standard pipeline, tracker, and output JD", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-manual-"));
  fs.mkdirSync(path.join(workspace, "data"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "data/pipeline.md"), "# Pipeline\n\n## Pending\n\n## Processed\n", "utf8");
  const snippet = `
    const mod = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, "server/manualJobs.ts")).href)});
    const file = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, "server/fileAccess.ts")).href)});
    const input = { title: 'Shopify Developer', company: 'Manual Co', description: 'Build and maintain Shopify Liquid themes, reusable sections, product pages, collection pages, checkout UX, accessibility and storefront performance.', location: 'Remote, Poland', workModel: 'Remote', sourceName: 'Recruiter' };
    const created = await mod.createManualJob(input);
    const duplicate = await mod.createManualJob(input);
    const pipeline = file.parsePipeline();
    console.log(JSON.stringify({ created, duplicate, pipeline }));
  `;
  const out = execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", snippet], { cwd: workspace, encoding: "utf8" });
  const result = JSON.parse(out.trim());
  assert.equal(result.created.created, true);
  assert.match(result.created.job.id, /^manual-\d+-manual-co-shopify-developer$/);
  assert.equal(result.created.job.sourceType, "MANUAL");
  assert.equal(result.duplicate.duplicate, true);
  assert.equal(result.pipeline.pending[0].manualEntry, true);
  assert.equal(result.pipeline.pending[0].description, result.created.job.description);
  assert.ok(fs.existsSync(path.join(workspace, "data/manual-jobs.json")));
  assert.match(fs.readFileSync(path.join(workspace, "data/applications.md"), "utf8"), /Source: Manual/);
  assert.ok(fs.existsSync(path.join(workspace, "outputs/manual-co-shopify-developer/job-description.md")));
  fs.rmSync(workspace, { recursive: true, force: true });
});

for (const providerCase of [
  { name: "Codex", executable: "codex", module: "codexProvider.ts", exportName: "CodexProvider" },
  { name: "Gemini / Antigravity", executable: "agy", module: "geminiProvider.ts", exportName: "GeminiProvider" }
]) {
  test(`cancelling ${providerCase.name} terminates its real spawned CLI process`, async () => {
    if (process.platform === "win32") return;
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-provider-"));
    const executable = path.join(bin, providerCase.executable);
    fs.writeFileSync(executable, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo test; exit 0; fi\ntrap 'exit 143' TERM INT\nsleep 30\n", { mode: 0o755 });
    const oldPath = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
    try {
      const providerModule = await import(`${pathToFileURL(path.join(ROOT, "server/ai", providerCase.module)).href}?case=${providerCase.executable}-${Date.now()}`);
      const provider = new providerModule[providerCase.exportName]();
      const controller = new AbortController();
      const started = Date.now();
      const execution = provider.execute({ prompt: "wait", signal: controller.signal, timeoutMs: 10_000 });
      setTimeout(() => controller.abort(), 120);
      await assert.rejects(execution, (error) => error?.name === "OperationCancelledError");
      assert.ok(Date.now() - started < 4_000, "cancel should not wait for provider timeout");
    } finally {
      process.env.PATH = oldPath;
      fs.rmSync(bin, { recursive: true, force: true });
    }
  });
}

test("cancellable child-process timeout is distinct from user cancellation", async () => {
  const { runCancellableCommand } = await import(`${pathToFileURL(path.join(ROOT, "server/process.ts")).href}?timeout=${Date.now()}`);
  await assert.rejects(
    runCancellableCommand(process.execPath, ["-e", "setTimeout(()=>{}, 30000)"], { timeoutMs: 80 }),
    (error) => error?.name === "ProcessTimeoutError" && /timed out/i.test(error.message)
  );
});

test("cancellation escalates to SIGKILL when a process ignores SIGTERM", async () => {
  if (process.platform === "win32") return;
  const { runCancellableCommand } = await import(`${pathToFileURL(path.join(ROOT, "server/process.ts")).href}?kill=${Date.now()}`);
  const controller = new AbortController();
  const started = Date.now();
  const execution = runCancellableCommand(
    process.execPath,
    ["-e", "process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000)"],
    { signal: controller.signal, timeoutMs: 10_000 }
  );
  setTimeout(() => controller.abort(), 120);
  await assert.rejects(execution, (error) => error?.name === "OperationCancelledError");
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 1_400 && elapsed < 4_000, `expected forced termination after grace period, got ${elapsed}ms`);
});

test("cancelling JD extraction terminates the browser extraction process", async () => {
  if (process.platform === "win32") return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-extract-"));
  const extractor = path.join(dir, "extract.mjs");
  fs.writeFileSync(extractor, "process.on('SIGTERM',()=>process.exit(143)); setTimeout(()=>console.log(JSON.stringify({text:'late'})),30000);", "utf8");
  process.env.CAREER_OPS_BROWSER_EXTRACT = extractor;
  try {
    const { getFullJobDescription } = await import(`${pathToFileURL(path.join(ROOT, "server/aiTailor.ts")).href}?extract=${Date.now()}`);
    const controller = new AbortController();
    const extraction = getFullJobDescription("https://example.com/job", "fallback", controller.signal);
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(extraction, (error) => error?.name === "OperationCancelledError");
  } finally {
    delete process.env.CAREER_OPS_BROWSER_EXTRACT;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("cancelled regeneration never replaces a previous valid CV", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-artifacts-"));
  const staged = path.join(dir, "staged.pdf");
  const destination = path.join(dir, "tailored-cv.pdf");
  fs.writeFileSync(staged, "new partial CV", "utf8");
  fs.writeFileSync(destination, "previous valid CV", "utf8");
  const { publishGenerationArtifacts } = await import(`${pathToFileURL(path.join(ROOT, "server/aiTailor.ts")).href}?publish=${Date.now()}`);
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => publishGenerationArtifacts([{ staged, destination }], "cancel-test", controller.signal), (error) => error?.name === "OperationCancelledError");
  assert.equal(fs.readFileSync(destination, "utf8"), "previous valid CV");
  assert.equal(fs.existsSync(`${destination}.cancel-test.incoming`), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

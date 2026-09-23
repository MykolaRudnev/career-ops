import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");

test("on-demand cover letters are domain-specific, provider-selected, persisted, editable, and cancellable", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-cover-"));
  fs.writeFileSync(path.join(workspace, "cv.md"), [
    "# Candidate", "Senior Frontend Developer with React, Next.js, TypeScript, Magento 2, Hyva, Shopify and Liquid.",
    "Built ponadczasowi.pl with Next.js, React and TypeScript.", "Built Glasy.pl with Shopify and Liquid.",
    "Worked on ORBA with Magento 2 and Hyva.", "Led frontend delivery and client communication."
  ].join("\n"));
  const script = [
    "process.chdir(" + JSON.stringify(workspace) + ");",
    "const mod = await import(" + JSON.stringify(pathToFileURL(path.join(ROOT, "server/coverLetter.ts")).href) + ");",
    "const words = (core) => 'Hi, I’m interested in this role because it matches my frontend background in ' + core + '.\\n\\nI have worked on frontend delivery and client communication. I would be happy to talk about the work and how I could contribute to your team.\\n\\nThanks for taking a look. Happy to share more.';",
    "const cases = [['React / Next.js Engineer', 'React Next.js TypeScript performance and architecture.', 'React Next.js TypeScript performance and ponadczasowi.pl', 'codex'], ['Shopify Developer', 'Shopify Liquid themes and custom sections.', 'Shopify Liquid custom sections and Glasy.pl', 'gemini'], ['Magento / Hyva Developer', 'Magento 2 Hyva storefront architecture.', 'Magento 2 Hyva storefront architecture and ORBA', 'codex']];",
    "for (const [title, jd, core, provider] of cases) {",
    "  const job = { id: 'job-' + provider + title, company: 'Example ' + provider, title, location: 'Remote', url: 'manual://x', extra: '' };",
    "  const artifact = await mod.generateCoverLetter(job, jd + ' Responsibilities and requirements.', { matchClassification: 'STRONG MATCH' }, { providerId: provider, model: 'test-model', operationId: 'op-' + provider, executeAi: async (_request, selection) => ({ content: JSON.stringify({ coverLetter: words(core) }), providerId: selection.providerId, providerName: selection.providerId, model: selection.model || 'test-model', durationMs: 12 }) });",
    "  if (artifact.metadata.provider !== provider || artifact.metadata.characterCount !== artifact.content.length || artifact.content.length > 950) throw new Error('metadata mismatch');",
    "  if (!fs.existsSync(artifact.markdownPath) || !fs.existsSync(artifact.textPath) || !fs.existsSync(artifact.metadataPath)) throw new Error('artifact missing');",
    "  const edited = mod.saveCoverLetterEdit(job, artifact.content + ' Edited manually.');",
    "  if (!edited.metadata.editedAt || edited.metadata.editCount !== 1 || mod.applicationCoverContext(job, 80).length > 80) throw new Error('edit/context mismatch');",
    "}",
    "const assert = (await import('node:assert/strict')).default;",
    "let calls = 0; const repairJob = {id: 'repair', company: 'Repair', title: 'React Developer', url: 'https://justjoin.it/job-offer/repair'};",
    "const repaired = await mod.generateCoverLetter(repairJob, 'React frontend role.', {}, {operationId:'repair', executeAi: async ({prompt}) => { calls++; if (calls === 2) { assert.match(prompt, /rewrite to 500-850/); assert.match(prompt, /PREVIOUS DRAFT/); } return {content: calls === 1 ? 'I work on React frontend features. '.repeat(50) : words('React'), providerId:'test', model:'test'}; }});",
    "assert.equal(calls, 2); assert.ok(repaired.content.length <= 950);",
    "const long = 'Hi, I am interested in the frontend role.\\n\\n' + 'I work on React frontend features and talk with clients. '.repeat(30) + '\\n\\nHappy to share more.';",
    "mod.saveCoverLetterEdit(repairJob, long); assert.ok(mod.applicationCoverContext(repairJob).length <= 950);",
    "const short = mod.shortCoverLetter(long, 240); assert.ok(short.length <= 240); assert.ok(short.endsWith('Happy to share more.')); assert.ok(!short.includes('…'));",
    "assert.throws(() => mod.shortCoverLetter('a'.repeat(300), 40), /without cutting a sentence/);",
    "assert.throws(() => mod.shortCoverLetter(long, -1), /Invalid/);",
    "const job = { id: 'cancel', company: 'Cancel Co', title: 'React Developer', location: 'Remote', url: 'manual://cancel', extra: '' };",
    "const controller = new AbortController();",
    "const pending = mod.generateCoverLetter(job, 'React responsibilities and requirements.', {}, { providerId: 'codex', operationId: 'op-cancel', signal: controller.signal, executeAi: (_request) => new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(Object.assign(new Error('Cancelled by user'), { name: 'OperationCancelledError' })), { once: true })) });",
    "setTimeout(() => controller.abort(), 20);",
    "await pending.then(() => { throw new Error('cancellation did not reject'); }, (error) => { if (error.name !== 'OperationCancelledError') throw error; });",
    "console.log('ok');"
  ].join("\n");
  assert.equal(execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { cwd: workspace, encoding: "utf8" }).trim(), "ok");
  fs.rmSync(workspace, { recursive: true, force: true });
});

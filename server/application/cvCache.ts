import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getCareerOpsRoot } from '../../path-resolver.mjs';
import { jobArtifactDir } from '../jobArtifacts.ts';

const codeRoot = path.resolve(import.meta.dirname, '../..');
export function cvFingerprint(job: any, jd: string): string {
  const hash = createHash('sha256').update(JSON.stringify([job.url, job.company, job.title, jd.replace(/\s+/g, ' ').trim()]));
  for (const file of ['cv.md', 'config/profile.yml', 'modes/_profile.md', 'modes/_custom.md', 'article-digest.md']) {
    const p = path.join(getCareerOpsRoot(), file);
    hash.update(file).update(fs.existsSync(p) ? fs.readFileSync(p) : '');
  }
  for (const file of ['server/aiTailor.ts', 'server/cvFromMaster.mjs', 'server/cvDomainRouting.mjs', 'build-cv-html.mjs', 'generate-pdf.mjs', 'verify-cv-facts.mjs', ...fs.readdirSync(path.join(codeRoot, 'knowledge')).map(n => `knowledge/${n}`), ...fs.readdirSync(path.join(codeRoot, 'templates')).filter(n => n.startsWith('cv-')).map(n => `templates/${n}`), ...fs.readdirSync(path.join(codeRoot, 'templates/sections')).map(n => `templates/sections/${n}`)]) {
    const p = path.join(codeRoot, file);
    if (fs.statSync(p).isFile()) hash.update(file).update(fs.readFileSync(p));
  }
  return hash.digest('hex');
}

export function cachedTailoredCv(job: any, jd: string) {
  const dir = jobArtifactDir(job);
  const file = path.join(dir, 'metadata.json');
  if (!fs.existsSync(file)) return null;
  const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (metadata.url !== job.url || metadata.inputFingerprint !== cvFingerprint(job, jd) || !metadata.success || metadata.factCheck !== 'passed') return null;
  const pdf = metadata.pdfPath;
  if (typeof pdf !== 'string' || !fs.existsSync(pdf) || !fs.realpathSync(pdf).startsWith(fs.realpathSync(dir) + path.sep)) return null;
  if (!fs.readFileSync(pdf).subarray(0, 5).equals(Buffer.from('%PDF-'))) return null;
  return { cvPath: pdf, status: 'REUSED', generatedAt: metadata.generatedAt, provider: metadata.provider, model: metadata.model, validation: metadata.factValidation };
}

export async function ensureTailoredCv(job: any, jd: string, generate: () => Promise<any>, regenerate = false) {
  const cached = !regenerate && cachedTailoredCv(job, jd);
  if (cached) return cached;
  const fingerprint = cvFingerprint(job, jd);
  const result = await generate();
  if (cvFingerprint(job, jd) !== fingerprint) {
    const metadataPath = path.join(jobArtifactDir(job), "metadata.json");
    if (fs.existsSync(metadataPath)) {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
      delete metadata.inputFingerprint;
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    }
    throw new Error("Candidate sources changed during CV generation; retry with current profile");
  }
  if (!result.success || !result.factPass) throw new Error(result.error || 'CV validation failed');
  const ready = cachedTailoredCv(job, jd);
  if (!ready) throw new Error('Generated CV has no matching validated fingerprint');
  return { ...ready, status: 'GENERATED' };
}

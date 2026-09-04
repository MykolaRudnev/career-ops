import path from "node:path";

const WORKSPACE_ROOT = path.resolve(process.cwd());

export function jobArtifactSlug(company: string, title: string): string {
  const clean = (value: string) => value.toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${clean(company)}-${clean(title)}`.slice(0, 50) || "job";
}

export function jobArtifactDir(job: { company: string; title: string }): string {
  return path.join(WORKSPACE_ROOT, "outputs", jobArtifactSlug(job.company, job.title));
}

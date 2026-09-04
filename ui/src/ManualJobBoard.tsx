import { useState, type FormEvent } from "react";
import { ClipboardPlus, ExternalLink, Sparkles } from "lucide-react";
import { createManualJob, type ManualJobInput, type OperationRecord, type PipelineJob } from "./api";

const EMPTY: ManualJobInput = {
  title: "",
  company: "",
  description: "",
  url: "",
  location: "",
  workModel: "",
  salary: "",
  sourceName: "",
  notes: ""
};

export function ManualJobBoard(props: {
  providerId: string;
  model: string;
  providerName: string;
  disabled?: boolean;
  onSaved: (job: PipelineJob, generated: boolean) => void;
  onOperation: (operation: OperationRecord) => void;
  onOpenExisting: (job: PipelineJob) => void;
  notify: (message: string) => void;
}) {
  const [form, setForm] = useState<ManualJobInput>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [duplicates, setDuplicates] = useState<PipelineJob[]>([]);
  const [pendingGenerate, setPendingGenerate] = useState(false);

  const update = (key: keyof ManualJobInput, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const save = async (generateCv: boolean, addAnyway = false) => {
    setSaving(true);
    setPendingGenerate(generateCv);
    try {
      const result = await createManualJob(form, {
        addAnyway,
        generateCv,
        providerId: props.providerId,
        model: props.model
      });
      setDuplicates([]);
      setForm(EMPTY);
      props.onSaved(result.job, generateCv);
      if (result.operation) props.onOperation(result.operation);
      props.notify(generateCv
        ? `Manual job saved. Tailored CV started with ${props.providerName}.`
        : "Manual job saved to the normal pipeline and tracker.");
    } catch (error: any) {
      if (error.code === "DUPLICATE") {
        setDuplicates(error.existingJobs || []);
        props.notify("A matching job already exists. Open it or choose Add Anyway.");
      } else {
        props.notify(`Manual job could not be saved: ${error.message}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const submit = (event: FormEvent, generateCv: boolean) => {
    event.preventDefault();
    void save(generateCv);
  };

  return (
    <div className="manual-board">
      <div className="manual-board-intro">
        <div>
          <h3><ClipboardPlus size={18} /> Manual Job / JD</h3>
          <p>Paste a vacancy from any source. It becomes a normal Career-Ops job and uses the existing evaluator, domain routing, AI provider, fact checks, and ATS PDF renderer.</p>
        </div>
        <span className="badge badge-manual">MANUAL</span>
      </div>

      <form className="manual-form" onSubmit={(event) => submit(event, true)}>
        <label>Job Title <strong>*</strong><input required value={form.title} onChange={(e) => update("title", e.target.value)} /></label>
        <label>Company <strong>*</strong><input required value={form.company} onChange={(e) => update("company", e.target.value)} /></label>
        <label>Job URL <input type="url" placeholder="https://… (optional)" value={form.url} onChange={(e) => update("url", e.target.value)} /></label>
        <label>Location <input value={form.location} onChange={(e) => update("location", e.target.value)} /></label>
        <label>Work Model
          <select value={form.workModel} onChange={(e) => update("workModel", e.target.value)}>
            <option value="">Infer from location</option><option>Remote</option><option>Hybrid</option><option>Office</option>
          </select>
        </label>
        <label>Salary <input value={form.salary} onChange={(e) => update("salary", e.target.value)} /></label>
        <label>Source Name <input placeholder="Recruiter, LinkedIn, company site…" value={form.sourceName} onChange={(e) => update("sourceName", e.target.value)} /></label>
        <label className="manual-wide">Notes <input value={form.notes} onChange={(e) => update("notes", e.target.value)} /></label>
        <label className="manual-wide">Job Description <strong>*</strong>
          <textarea required minLength={40} rows={15} placeholder="Paste the full or partial job description…" value={form.description} onChange={(e) => update("description", e.target.value)} />
        </label>

        {duplicates.length > 0 && (
          <div className="manual-duplicate manual-wide">
            <strong>Possible duplicate found</strong>
            {duplicates.map((job) => (
              <div key={job.id}>
                <span>{job.title} — {job.company}</span>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => props.onOpenExisting(job)}><ExternalLink size={12} /> Open Existing</button>
              </div>
            ))}
            <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => void save(pendingGenerate, true)}>Add Anyway</button>
          </div>
        )}

        <div className="manual-actions manual-wide">
          <button type="button" className="btn btn-secondary" disabled={saving || props.disabled} onClick={() => void save(false)}>
            Add Without Generating CV
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving || props.disabled}>
            {saving && pendingGenerate ? <span className="spinner" /> : <Sparkles size={14} />} Add & Generate Tailored CV
          </button>
        </div>
      </form>
    </div>
  );
}

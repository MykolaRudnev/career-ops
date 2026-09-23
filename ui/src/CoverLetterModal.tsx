import { useState } from "react";
import { Copy, Download, FileText, Pencil, RefreshCw, Save, X } from "lucide-react";
import {
  coverLetterDownloadUrl,
  fetchApplicationCoverContext,
  saveCoverLetter,
  type CoverLetterArtifact,
  type PipelineJob
} from "./api";

export function CoverLetterModal(props: {
  job: PipelineJob;
  artifact: CoverLetterArtifact;
  onClose: () => void;
  onRegenerate: () => void;
  onSaved: (artifact: CoverLetterArtifact) => void;
  notify: (message: string) => void;
  generating: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.artifact.content);
  const [saving, setSaving] = useState(false);
  const visibleContent = editing ? draft : props.artifact.content;
  const chars = visibleContent.length;

  const copy = async (content = props.artifact.content, label = "Cover Letter") => {
    await navigator.clipboard.writeText(content);
    props.notify(`${label} copied to clipboard.`);
  };

  const persist = async () => {
    setSaving(true);
    try {
      const artifact = await saveCoverLetter(props.job, draft);
      props.onSaved(artifact);
      setEditing(false);
      props.notify("Cover Letter edits saved without an AI call.");
    } catch (error: any) {
      props.notify(`Save failed: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleUseInApplication = async () => {
    try {
      const content = await fetchApplicationCoverContext(props.job);
      await copy(content, "Application Cover Letter context");
    } catch (error: any) {
      props.notify(`Could not prepare application context: ${error.message}`);
    }
  };

  return (
    <div className="modal-overlay cover-modal-overlay" onClick={props.onClose}>
      <div className="modal-content cover-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title"><FileText size={18} /> Cover Letter Ready</h2>
            <div className="modal-company">{props.job.title} · {props.job.company}</div>
          </div>
          <button className="btn btn-outline btn-sm" aria-label="Close cover letter" onClick={props.onClose}><X size={16} /></button>
        </div>

        {props.artifact.cvChangedSince && (
          <div className="cover-warning">CV has changed since this Cover Letter was generated.</div>
        )}

        <div className="cover-length" aria-live="polite">
          <strong>Chars: {chars}</strong>
          <span className={chars <= 950 ? "cover-safe" : "cover-warning-text"}>Short-field safe: {chars > 0 && chars <= 950 ? "Yes" : "No"}</span>
          <span>Concise · 950 character limit</span>
        </div>
        {chars > 950 && <div className="cover-warning">This draft is too long for short fields. Regenerate for a shorter version; Use in Application keeps complete sentences within the limit.</div>}
        <div className="cover-meta">
          <span>{props.artifact.metadata.wordCount} words</span>
          <span>{props.artifact.metadata.provider} · {props.artifact.metadata.model}</span>
          <span>{props.artifact.metadata.basedOnTailoredCv ? "Based on tailored CV" : "Based on canonical CV"}</span>
          {props.artifact.metadata.editedAt && <span>Edited {new Date(props.artifact.metadata.editedAt).toLocaleString()}</span>}
        </div>

        {editing ? (
          <textarea aria-label="Cover letter text" className="cover-editor" value={draft} onChange={(event) => setDraft(event.target.value)} rows={10} />
        ) : (
          <div className="cover-preview">{props.artifact.content}</div>
        )}

        <div className="cover-actions">
          {editing ? (
            <>
              <button className="btn btn-primary" disabled={saving} onClick={() => void persist()}><Save size={14} /> {saving ? "Saving..." : "Save"}</button>
              <button className="btn btn-outline" onClick={() => { setDraft(props.artifact.content); setEditing(false); }}>Cancel Edit</button>
            </>
          ) : (
            <>
              <button className="btn btn-outline" onClick={() => void copy()}><Copy size={14} /> Copy</button>
              <button className="btn btn-outline" onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>
              <a className="btn btn-outline" href={coverLetterDownloadUrl(props.job)} download><Download size={14} /> Download TXT</a>
              <button className="btn btn-secondary" onClick={() => void handleUseInApplication()}>Use in Application</button>
              <button className="btn btn-primary" disabled={props.generating} onClick={props.onRegenerate}><RefreshCw size={14} /> Regenerate</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

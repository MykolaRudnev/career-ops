import { useEffect, useState } from 'react';
import { startApplications, fetchApplicationHistory, type PipelineJob, type OperationRecord } from './api';

const final = new Set(['SUBMITTED', 'READY_TO_SUBMIT', 'NEEDS_MANUAL', 'FAILED', 'CANCELLED', 'CLOSED', 'SKIPPED', 'ALREADY_APPLIED']);
export function useApplicationAutomation(props: {
  busy: boolean; providerId: string; model: string;
  onOperation: (op: OperationRecord) => void;
  cancel: (id: string) => void;
  notify: (text: string) => void;
}) {
  const [mode, setMode] = useState<'DRY_RUN' | 'SUBMIT'>('DRY_RUN');
  const [attempts, setAttempts] = useState<any[]>([]);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    const refresh = () => { void fetchApplicationHistory().then(setAttempts).catch(() => {}); };
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, []);
  const batchId = attempts.at(-1)?.operationId;
  const batch = attempts.filter(a => a.operationId === batchId);
  const active = batch.some(a => !final.has(a.result));
  const counts = batch.reduce<Record<string, number>>((all, a) => ({ ...all, [a.result]: (all[a.result] || 0) + 1 }), {});
  const start = async (jobs: PipelineJob[], bulk = false) => {
    if (bulk && !window.confirm(`Apply to ${jobs.length} currently visible jobs in ${mode} mode?\n\nGenerate/reuse CVs, fill supported forms${mode === 'SUBMIT' ? ' and submit where possible' : ' without final submission'}. Blocked jobs need manual review. At most one job per company will be attempted.`)) return;
    setStarting(true);
    try {
      const operation = await startApplications(jobs, mode, props.providerId, props.model);
      props.onOperation(operation);
      setAttempts(await fetchApplicationHistory());
    } catch (error: any) { props.notify(error.message); }
    finally { setStarting(false); }
  };
  const button = (job: PipelineJob) => {
    const attempt = attempts.findLast(a => a.url === job.url);
    const applied = job.status === 'applied' || ['SUBMITTED', 'ALREADY_APPLIED'].includes(attempt?.result);
    const running = attempt && !final.has(attempt.result);
    const blocked = applied || job.status === 'skipped' || attempt?.result === 'CLOSED' || attempt?.submissionAttempted;
    const label = applied ? 'Applied ✓' : running ? `${attempt.result.replaceAll('_', ' ')}…` : attempt?.result === 'CLOSED' ? 'Closed' : attempt?.result === 'NEEDS_MANUAL' ? 'Needs Manual · Retry' : ['FAILED', 'CANCELLED', 'READY_TO_SUBMIT'].includes(attempt?.result) ? 'Retry Apply' : 'Apply';
    return <button className="btn btn-success btn-sm" title={attempt?.reason || `${mode}: generate/reuse CV and apply`} disabled={props.busy || starting || active || Boolean(blocked)} onClick={() => void start([job])}>{label}</button>;
  };
  const toolbar = (jobs: PipelineJob[], total: number) => <div className="application-toolbar">
    <strong>{jobs.length} jobs visible{total > jobs.length ? ` (${total} match filters; first 100 shown)` : ''}</strong>
    <label>Application mode <select aria-label="Application mode" value={mode} disabled={active || starting} onChange={e => {
      const next = e.target.value as typeof mode;
      if (next === 'SUBMIT' && !window.confirm('Enable real submission for subsequent Apply actions? Supported forms will be submitted and verified.')) return;
      setMode(next);
    }}><option value="DRY_RUN">DRY RUN — no final submit</option><option value="SUBMIT">SUBMIT — real applications</option></select></label>
    <button className="btn btn-success" disabled={!jobs.length || props.busy || starting || active} onClick={() => void start(jobs, true)}>Apply filtered ({jobs.length})</button>
    {active && <button className="btn btn-danger" onClick={() => props.cancel(batchId)}>Cancel application queue</button>}
  </div>;
  const history = batch.length > 0 && <details className="application-history" open={active || undefined}>
    <summary>Application queue · Selected: {batch.length} · {Object.entries(counts).map(([key, count]) => `${key.replaceAll('_', ' ')}: ${count}`).join(' · ')}</summary>
    <ol>{batch.map(a => <li key={a.attemptId}>
      <strong>{a.company} — {a.role}</strong> <span className="status-badge">{a.result.replaceAll('_', ' ')}</span>
      <small>{a.applicationProvider} {a.cvStatus ? `· CV ${a.cvStatus.toLowerCase()}` : ''} · {a.reason}{a.trackerWarning ? ` · Tracker warning: ${a.trackerWarning}` : ''}</small>
      <a href={a.finalUrl || a.url} target="_blank" rel="noreferrer">Open application</a>
    </li>)}</ol>
  </details>;
  return { button, toolbar, history };
}

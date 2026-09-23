import { useEffect, useState } from 'react';
type Health = { source:string; name:string; status:string; integrationType:string; lastSuccessfulScan:string|null; jobsFetched:number; jobsRelevant?:number; newJobs:number; duplicates:number; expiredRemoved?:number; durationMs:number; errors:string[]; error?:string|null };
export function DiscoveryHealth({ compact = false, refreshKey = '' }: { compact?: boolean; refreshKey?: string }) {
  const [rows,setRows]=useState<Health[]>([]),[error,setError]=useState('');
  const refresh=()=>fetch('http://127.0.0.1:3001/api/discovery/health').then(r=>{if(!r.ok)throw new Error('Source health unavailable');return r.json();}).then(value=>{setRows(value);setError('');}).catch(e=>setError(e.message));
  useEffect(()=>{void refresh();},[refreshKey]);
  const ready=rows.filter(r=>['READY','EMPTY'].includes(r.status)).length;
  const blocked=rows.filter(r=>['BLOCKED','RATE_LIMITED'].includes(r.status)).length;
  const degraded=rows.length-ready-blocked;
  if(compact) return <details className="source-health-compact">
    <summary><strong>Source Health</strong><span>{ready} ready · {degraded} degraded · {blocked} blocked</span></summary>
    {error && <p role="alert">{error}</p>}
    <div className="source-health-list">{rows.map((r,i)=><div key={`${r.source}-${i}`}><span>{r.name||r.source}</span><span>{['READY','EMPTY'].includes(r.status)?'✓':blocked&&['BLOCKED','RATE_LIMITED'].includes(r.status)?'⚠':'·'} {r.newJobs??0} new · {r.status.toLowerCase().replaceAll('_',' ')}</span></div>)}</div>
  </details>;
  return <section className="ai-provider-panel" aria-label="Job discovery sources">
    <h3>Job discovery sources</h3><button onClick={()=>void refresh()}>Refresh source health</button>
    {error && <p role="alert">{error}</p>}
    <div style={{overflowX:'auto'}}><table><thead><tr>{['Source','Integration','Status','Last successful scan','Fetched','Relevant','New','Duplicates','Duration','Errors'].map(x=><th key={x}>{x}</th>)}</tr></thead>
    <tbody>{rows.map((r,i)=><tr key={`${r.source}-${i}`}><td>{r.name||r.source}</td><td>{r.integrationType}</td><td>{r.status}</td><td>{r.lastSuccessfulScan ? new Date(r.lastSuccessfulScan).toLocaleString() : 'Never executed'}</td><td>{r.jobsFetched??0}</td><td>{r.jobsRelevant??0}</td><td>{r.newJobs??0}</td><td>{r.duplicates??0}</td><td>{((r.durationMs||0)/1000).toFixed(1)}s</td><td>{r.errors?.join('; ')||r.error||''}</td></tr>)}</tbody></table></div>
  </section>;
}

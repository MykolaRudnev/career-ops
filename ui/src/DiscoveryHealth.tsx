import { useEffect, useState } from 'react';
type Health = { source:string; name:string; status:string; integrationType:string; lastSuccessfulScan:string|null; jobsFetched:number; newJobs:number; duplicates:number; durationMs:number; errors:string[] };
export function DiscoveryHealth() {
  const [rows,setRows]=useState<Health[]>([]),[error,setError]=useState('');
  const refresh=()=>fetch('http://127.0.0.1:3001/api/discovery/health').then(r=>{if(!r.ok)throw new Error('Source health unavailable');return r.json();}).then(setRows).catch(e=>setError(e.message));
  useEffect(()=>{void refresh();},[]);
  return <section className="ai-provider-panel" aria-label="Job discovery sources">
    <h3>Job discovery sources</h3><button onClick={()=>void refresh()}>Refresh source health</button>
    {error && <p role="alert">{error}</p>}
    <div style={{overflowX:'auto'}}><table><thead><tr>{['Source','Integration','Status','Last successful scan','Fetched','New','Duplicates','Duration','Errors'].map(x=><th key={x}>{x}</th>)}</tr></thead>
    <tbody>{rows.map((r,i)=><tr key={`${r.source}-${i}`}><td>{r.name||r.source}</td><td>{r.integrationType}</td><td>{r.status}</td><td>{r.lastSuccessfulScan ? new Date(r.lastSuccessfulScan).toLocaleString() : '—'}</td><td>{r.jobsFetched ?? 0}</td><td>{r.newJobs ?? 0}</td><td>{r.duplicates ?? 0}</td><td>{((r.durationMs||0)/1000).toFixed(1)}s</td><td>{r.errors?.join('; ')}</td></tr>)}</tbody></table></div>
  </section>;
}

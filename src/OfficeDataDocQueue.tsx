import {useCallback,useEffect,useState} from 'react';
import {Activity,AlertTriangle,CheckCircle2,Clock3,Monitor,RefreshCw,ShieldCheck} from 'lucide-react';
import {supabase} from './independentClient';
import './office-queue.css';

type OfficeRow={id:string;process_no:string;status:string;progress:number;office_execution:string;approved_at:string|null;created_at:string;updated_at:string;error_message:string|null;worker_name:string|null};
type Heartbeat={worker_name:string;machine_name:string;status:string;last_seen_at:string;details:any};
const human=(stamp:string)=>new Date(stamp).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'numeric',minute:'2-digit'});
export default function OfficeDataDocQueue({authenticated}:{authenticated:boolean}){
 const [rows,setRows]=useState<OfficeRow[]>([]);
 const [worker,setWorker]=useState<Heartbeat|null>(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const refresh=useCallback(async()=>{
  if(!supabase||!authenticated)return;
  setLoading(true);
  try{
   const {data:{user},error:authError}=await supabase.auth.getUser();
   if(authError||!user)throw Error('Sign in to view your DataDoc queue.');
   const [jobs,status]=await Promise.all([
    supabase.from('oms_jobs').select('id,process_no,status,progress,office_execution,approved_at,created_at,updated_at,error_message,worker_name')
     .eq('job_type','bill_submit').eq('user_id',user.id)
     .order('created_at',{ascending:false}).limit(35),
    supabase.from('oms_office_workers').select('worker_name,machine_name,status,last_seen_at,details')
     .eq('owner_id',user.id).maybeSingle()
   ]);
   if(jobs.error)throw jobs.error;
   if(status.error)throw status.error;
   setRows((jobs.data||[]) as OfficeRow[]);
   setWorker(status.data as Heartbeat|null);
   setError('');
  }catch(e:any){setError(e?.message||'Cannot load office worker status.')}
  finally{setLoading(false)}
 },[authenticated]);
 useEffect(()=>{
  if(!authenticated){setRows([]);setWorker(null);return}
  void refresh();
  const poll=window.setInterval(()=>void refresh(),30000);
  return()=>window.clearInterval(poll);
 },[authenticated,refresh]);
 const age=worker?Date.now()-new Date(worker.last_seen_at).getTime():Infinity;
 const connected=Boolean(worker&&age>=0&&age<120000&&['idle','busy'].includes(worker.status));
 const paused=Boolean(worker&&age>=0&&age<120000&&worker.status==='paused');
 const count=rows.filter(x=>x.status==='queued'&&x.office_execution==='auto_on_login').length;
 const active=rows.filter(x=>x.status==='running').length;
 const failed=rows.filter(x=>x.status==='failed').length;
 return <div className='oq-panel'>
  <div className='oq-top'><div><span className='oq-kicker'><Monitor size={13}/> OFFICE WORKER HANDOFF</span>
   <h3>DataDoc pending submission queue</h3>
   <p>Approve bills from your phone. They remain saved in Supabase until your office PC is logged in and the local worker is running.</p>
  </div><button type='button' disabled={loading} className='oq-refresh' onClick={()=>void refresh()}><RefreshCw size={14}/> Refresh</button></div>
  <div className='oq-overview'>
   <div><span className='oq-stat-ico blue'><Clock3 size={18}/></span><strong>{count}</strong><small>Waiting for office PC</small></div>
   <div><span className='oq-stat-ico green'><Activity size={18}/></span><strong>{active}</strong><small>Processing</small></div>
   <div><span className='oq-stat-ico orange'><AlertTriangle size={18}/></span><strong>{failed}</strong><small>Manual review needed</small></div>
   <div className='oq-worker'><span className={'oq-state '+(connected?'ok':paused?'paused':'offline')}/><div><strong>{connected?worker?.status==='busy'?'Office worker busy':'Office worker online':paused?'Worker connected · paused':'Office worker offline'}</strong>
    <small>{connected||paused?worker?.machine_name+' · last seen '+human(worker!.last_seen_at):'Submissions will remain queued'}</small></div></div>
  </div>
  {error&&<p className='oq-error' role='alert'>{error}</p>}
  <div className='oq-jobs'>
   {rows.length?rows.slice(0,12).map(row=>{
    const status=row.status==='queued'&&row.office_execution==='auto_on_login'?'Waiting for PC':
      row.status==='running'?'Processing':
      row.status==='completed'?'Submitted':
      row.status==='failed'?'Needs review':
      row.status==='cancelled'?'Cancelled':'Manual queue';
    const className=row.status==='completed'?'ok':row.status==='failed'?'bad':row.status==='running'?'busy':'waiting';
    return <div className='oq-job' key={row.id}><div><strong>Process {row.process_no}</strong>
     <small>Queued {human(row.created_at)} {row.worker_name?'· '+row.worker_name:''}</small>
     {row.error_message&&<small className='oq-job-error'>{row.error_message}</small>}
     {row.status==='running'&&Date.now()-new Date(row.updated_at).getTime()>30*60000&&<small className='oq-job-error'>Worker appears interrupted. Check DataDoc before creating a new job.</small>}
    </div><span className={'oq-job-status '+className}>{status}</span></div>
   }):<div className='oq-empty'><ShieldCheck size={17}/> No DataDoc bill jobs are queued yet. Use Approve & Queue on a verified Process to add one.</div>}
  </div>
  <div className='oq-note'><ShieldCheck size={15}/><span>Automatic execution requires one-time Windows installation and a verified live setting. Only approved <strong>Bill Submit</strong> jobs auto-run; Outlook and Delivery Proof integrations remain separate. Failed submissions never retry automatically.</span></div>
 </div>;
}

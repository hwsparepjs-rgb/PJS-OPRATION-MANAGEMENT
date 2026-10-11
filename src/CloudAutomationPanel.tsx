import {useCallback,useEffect,useMemo,useState} from 'react';
import {Activity,AlertTriangle,Check,ChevronDown,ChevronUp,Cloud,CloudOff,FileSearch,FileText,LoaderCircle,RefreshCw,ShieldCheck} from 'lucide-react';
import {cloudJobsApi,type CloudJob,type CloudJobType,type CloudWorker} from './cloudJobsApi';
import './cloud-automation.css';

const jobName=(type:CloudJobType)=>type==='process_audit'?'Process audit':'PDF field extraction';
const time=(input:string)=>new Date(input).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'numeric',minute:'2-digit'});
function Result({job}:{job:CloudJob}){
 const result=job.result||{};
 if(job.status==='failed')return <div className='ca-failure'>{job.error_message||'Cloud worker failed. Check the document and retry with a new job after review.'}</div>;
 if(job.status!=='completed')return <p className='ca-pending-message'>{job.status==='queued'?'Waiting for a scheduled free GitHub Actions worker. No PC is needed once it is enabled.':'Worker is processing this request.'}</p>;
 if(job.job_type==='process_audit'){
  const missing=Array.isArray(result.bill_missing)?result.bill_missing:[];
  return <div className='ca-result'>
   <span className={'ca-readiness '+(result.ready_for_bill_review?'ready':'needs')}>{result.ready_for_bill_review?'Required bill fields found':'Needs review'}</span>
   <div className='ca-result-figures'><span>{result.source_documents_count??0} documents found</span><span>{missing.length} missing items</span></div>
   {missing.length>0&&<div className='ca-result-warning'><b>Missing or incomplete:</b> {missing.join(' · ')}</div>}
   <small>Read-only audit. This is not confirmation of DataDoc submission.</small>
  </div>;
 }
 const docs=Array.isArray(result.documents)?result.documents:[];
 const suggestions=result.suggested_fields&&typeof result.suggested_fields==='object'?Object.entries(result.suggested_fields):[];
 const conflicts=result.conflicts&&typeof result.conflicts==='object'?Object.keys(result.conflicts):[];
 return <div className='ca-result'>
  <div className='ca-result-figures'><span>{result.files_read??0} documents read</span><span>{suggestions.length} candidate values</span></div>
  {docs.map((doc:any,i:number)=><div className='ca-document' key={i}><FileText size={14}/>
   <span>{String(doc.name||doc.kind||'PDF')}</span>
   <small>{doc.error?'Needs review':Object.keys(doc.fields||{}).length+' fields · '+(doc.method||'PDF extraction')}</small>
  </div>)}
  {suggestions.length>0&&<div className='ca-suggestions'><strong>PDF suggestions (not saved to the process)</strong>
   {suggestions.slice(0,11).map(([key,value])=><div key={key}><span>{key}</span><b>{String(value).slice(0,110)}</b></div>)}
  </div>}
  {conflicts.length>0&&<div className='ca-result-warning'>Conflicting values need manual review: {conflicts.join(', ')}</div>}
  <small>Verify against the original PDFs. The worker never modifies your master process fields.</small>
 </div>;
}

export default function CloudAutomationPanel({records,authenticated,refreshKey=0}:{
 records:any[];authenticated:boolean;refreshKey?:number;
}){
 const [jobs,setJobs]=useState<CloudJob[]>([]);
 const [workers,setWorkers]=useState<CloudWorker[]>([]);
 const [processNo,setProcessNo]=useState('');
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [expanded,setExpanded]=useState(false);
 const [openJob,setOpenJob]=useState<string|null>(null);
 const activeProcess=useMemo(()=>records.find(r=>String(r.process)===processNo.trim()),[records,processNo]);
 const newest=workers[0]||null;
 const online=Boolean(newest&&Date.now()-new Date(newest.last_seen_at).getTime()<100*60000);
 const running=jobs.filter(j=>j.status==='running').length;
 const queued=jobs.filter(j=>j.status==='queued').length;
 const refresh=useCallback(async()=>{
  if(!authenticated){setJobs([]);setWorkers([]);return}
  setLoading(true);
  try{
   const [history,workerInfo]=await Promise.all([cloudJobsApi.jobs(),cloudJobsApi.workers()]);
   setJobs(history);setWorkers(workerInfo);setError('');
  }catch(e:any){setError('Cloud status unavailable: '+(e?.message||'Check your sign-in.'))}
  finally{setLoading(false)}
 },[authenticated]);
 useEffect(()=>{
  if(!authenticated)return;
  void refresh();
  const timer=setInterval(()=>void refresh(),45000);
  return()=>clearInterval(timer);
 },[refresh,authenticated]);
 useEffect(()=>{if(authenticated&&refreshKey>0)void refresh()},[authenticated,refreshKey,refresh]);
 async function queueJob(type:CloudJobType){
  if(!activeProcess)return;
  setBusy(true);setError('');setNotice('');
  try{
   const row=await cloudJobsApi.queue(activeProcess,type);
   setJobs(old=>[row,...old]);
   setOpenJob(row.id);setExpanded(true);
   setNotice(jobName(type)+' queued for Process '+activeProcess.process+'. '+(online?'The free GitHub Actions worker can pick this up at its next scheduled run.':'The free scheduled worker is not connected yet; your request will wait safely in Supabase.'));
  }catch(e:any){setError(e?.message||'Unable to queue job.')}
  finally{setBusy(false)}
 }
 return <section className='ca-panel' aria-label='PC-independent cloud automation'>
  <div className='ca-head'>
   <div className='ca-head-icon'><Cloud size={21}/></div>
   <div className='ca-head-text'>
    <div className='ca-eyebrow'>GITHUB ACTIONS + SUPABASE · FREE FIRST</div>
    <h2>Cloud Automation <span className='ca-label'>PC-independent</span></h2>
    <p>Queue safe background work from your phone. Processes and private PDFs stay in Supabase; results return here automatically.</p>
   </div>
   <button className='ca-expand' type='button' aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>
    {expanded?'Collapse':'Open cloud jobs'}{expanded?<ChevronUp size={15}/>:<ChevronDown size={15}/>}
   </button>
  </div>
  <div className='ca-overview'>
   <span className={'ca-indicator '+(online?'connected':'disconnected')}>{online?<Activity size={14}/>:<CloudOff size={14}/>}
    {online?'Free Python worker recently ran':'Free worker setup needed'}
   </span>
   <span>{queued} queued</span><span>{running} processing</span><span>{jobs.filter(j=>j.status==='completed').length} completed</span>
   <button type='button' disabled={loading} onClick={()=>void refresh()} title='Refresh cloud jobs'><RefreshCw size={14}/></button>
  </div>
  {expanded&&<div className='ca-expanded'>
   {!online&&<div className='ca-safety'><ShieldCheck size={15}/><span>The free Python runner is prepared, but cannot execute until GitHub Actions is enabled and a private Supabase backend secret is configured. No Google Cloud billing is needed. <a href="https://github.com/pjsspare098-svg/PJS-OPRATION-MANAGEMENT/blob/main/docs/FREE_PYTHON_AUTOMATION_SETUP.md" target="_blank" rel="noopener noreferrer">View free setup guide</a></span></div>}
   <div className='ca-form'>
    <div><strong>Start a cloud job</strong><small>Choose an existing Process No. No DataDoc or email action will be executed.</small></div>
    <label>Process No.<input value={processNo} inputMode='numeric' maxLength={9} placeholder='e.g. 292168'
      onChange={e=>setProcessNo(e.target.value.replace(/[^\d]/g,''))}/></label>
    <div className='ca-actions'>
     <button type='button' disabled={!authenticated||!activeProcess||busy} onClick={()=>void queueJob('process_audit')}>
      {busy?<LoaderCircle size={15}/>:<ShieldCheck size={15}/>} Run process audit
     </button>
     <button type='button' disabled={!authenticated||!activeProcess||busy||!(activeProcess.documents||[]).some((d:any)=>['invoiceDoc','einvoiceDoc','ebillDoc','lrDoc'].includes(d.kind))}
      onClick={()=>void queueJob('document_extract')}><FileSearch size={15}/> Extract PDF details</button>
    </div>
   </div>
   {notice&&<p className='ca-notice' role='status'>{notice}</p>}
   {error&&<p className='ca-error' role='alert'>{error}</p>}
   <div className='ca-joblist-head'><strong>Recent background jobs</strong><small>{online?'Worker last ran '+time(newest!.last_seen_at):'No recent free-worker execution · setup required'}</small></div>
   {jobs.length?jobs.slice(0,12).map(job=><div key={job.id} className='ca-job'>
    <button className='ca-job-summary' onClick={()=>setOpenJob(openJob===job.id?null:job.id)} aria-expanded={openJob===job.id}>
     <div className='ca-job-type'><FileText size={15}/><div><strong>{jobName(job.job_type)} · {job.process_no}</strong><small>{time(job.created_at)} {job.worker_name?'· '+job.worker_name:''}</small></div></div>
     <span className={'ca-job-status '+job.status}>{job.status==='queued'?'Waiting':job.status==='running'?'Processing':job.status==='completed'?'Completed':job.status==='failed'?'Review needed':'Cancelled'}</span>
     {openJob===job.id?<ChevronUp size={15}/>:<ChevronDown size={15}/>}
    </button>
    {openJob===job.id&&<Result job={job}/>}
   </div>):<div className='ca-empty'>No cloud jobs yet. Select a saved Process No. above to prepare a read-only audit.</div>}
   <div className='ca-safety'><ShieldCheck size={15}/><span>This scheduled GitHub-hosted Python worker does not need your office PC. DataDoc access at the private office address remains in the separate Windows queue until a secure cloud connection is established. Cloud PDF extraction is for review, not automatic field replacement.</span></div>
  </div>}
 </section>;
}

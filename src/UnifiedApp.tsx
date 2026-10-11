import {useEffect,useMemo,useRef,useState} from 'react';
import {AlertCircle,CheckCircle2,Upload,X} from 'lucide-react';
import {supabase} from './independentClient';
import {cloud} from './cloud';
import {ops,mockRecords,saveDemo,missingDocs,isException,defaults,type Job,type AuditEvent,type JobType,type Preferences} from './unifiedOps';
import {teamsApi} from './teamOps';
import {agentApi} from './agentApi';
import {canCloseProcess} from './businessRules';
import UnifiedDialog,{blankProcess} from './UnifiedDialog';
import UnifiedLogin from './UnifiedLogin';
import DonePickListUpload from './DonePickListUpload';
import UnifiedShell,{type Section} from './UnifiedShell';
import UnifiedCorePages from './UnifiedCorePages';
import UnifiedStagePagesA from './UnifiedStagePagesA';
import UnifiedStagePagesB from './UnifiedStagePagesB';
import './excel-lr.css';
import './unified.css';
import './unified-extra.css';

const includes=(value:any,query:string)=>String(value??'').toLowerCase().includes(query);
export default function UnifiedApp(){
 const [checking,setChecking]=useState(true),[user,setUser]=useState<any>(null),[demo,setDemo]=useState(false);
 const [page,setPage]=useState<Section>('Control Tower'),[records,setRecords]=useState<any[]>([]),[trashedProcesses,setTrashedProcesses]=useState<any[]>([]);
 const [jobs,setJobs]=useState<Job[]>([]),[events,setEvents]=useState<AuditEvent[]>([]),[exceptions,setExceptions]=useState<any[]>([]),[settings,setSettings]=useState<Preferences>(defaults);
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const [search,setSearch]=useState(''),[dialog,setDialog]=useState(false),[record,setRecord]=useState<any>(null),[pickFile,setPickFile]=useState<File|null>(null);
 const [donePickOpen,setDonePickOpen]=useState(false);
 const [agentUnread,setAgentUnread]=useState(0);
 const notifiedIds=useRef<Set<string>>(new Set());
 const [activeTeam,setActiveTeam]=useState('');
 const [importIssue,setImportIssue]=useState('');
 const picker=useRef<HTMLInputElement>(null);
 useEffect(()=>{
  let active=true;
  if(!supabase){setChecking(false);return}
  void supabase.auth.getSession().then(({data})=>{if(active){setUser(data.session?.user||null);if(data.session?.user)setDemo(false);setChecking(false)}}).catch(()=>{if(active)setChecking(false)});
  const {data}=supabase.auth.onAuthStateChange((_event,session)=>{if(active){setUser(session?.user||null);if(session?.user)setDemo(false);setChecking(false)}});
  return()=>{active=false;data.subscription.unsubscribe()};
 },[]);
 useEffect(()=>{
  let active=true;
  if(demo){setRecords(mockRecords());setTrashedProcesses([]);setJobs([]);setEvents([]);setExceptions([]);return}
  if(!user){setRecords([]);setTrashedProcesses([]);setJobs([]);setEvents([]);setExceptions([]);return}
  setBusy(true);
  void Promise.all([ops.listRecords(),ops.listJobs(),ops.listEvents(),ops.preferences(),ops.listExceptions(),cloud.listTrashed()]).then(([r,j,e,s,x,trash])=>{if(active){setRecords(r);setTrashedProcesses(trash);setJobs(j);setEvents(e);setSettings(s);setExceptions(x);setError('')}}).catch(e=>{if(active)setError('Unable to load cloud workspace: '+(e?.message||'Try Refresh.'))}).finally(()=>{if(active)setBusy(false)});
  return()=>{active=false};
 },[user?.id,demo]);
 useEffect(()=>{
   if(!user){setActiveTeam('');return}
   let alive=true;
   void teamsApi.list().then(t=>{if(alive&&t.length===1&&t[0].role!=='viewer')setActiveTeam(t[0].team_id)}).catch(()=>{});
   return()=>{alive=false};
 },[user?.id]);
 useEffect(()=>{
  if(!user||demo){setAgentUnread(0);notifiedIds.current.clear();return}
  let active=true;let initialized=false;
  async function poll(){
   try{
    const events=await agentApi.notifications();
    if(!active)return;
    setAgentUnread(events.filter(e=>!e.read_at).length);
    if(initialized&&typeof Notification!=='undefined'&&Notification.permission==='granted'){
     // Only notify for newly delivered reminders; initial unread events
     // are visible through the bell but do not cause an alert storm.
     for(const event of events.filter(e=>!e.read_at&&!notifiedIds.current.has(e.id)).slice(0,4)){
      try{new Notification(event.title,{body:event.body,tag:'pjs-oms-'+event.id})}catch{}
     }
    }
    notifiedIds.current=new Set(events.map(x=>x.id));
    initialized=true;
   }catch{}
  }
  void poll();
  const interval=setInterval(()=>void poll(),45000);
  return()=>{active=false;clearInterval(interval)};
 },[user?.id,demo]);
 const results=useMemo(()=>records.filter(r=>[r.process,r.party,r.so,r.invoice,r.transporter,r.lr,r.stage,r.status].some(v=>includes(v,search))),[records,search]);
 const stats=useMemo(()=>({total:records.length,complete:records.filter(r=>String(r.stage||'').toLowerCase()==='complete').length,pending:records.filter(r=>missingDocs(r).length>0).length,exceptions:new Set([...records.filter(isException).map(r=>r.id),...exceptions.filter(x=>x.status!=='resolved').map(x=>x.process_id)]).size}),[records,exceptions]);
 const authenticated=Boolean(user&&!demo);
 function onNotice(v:string){setNotice(v);window.setTimeout(()=>setNotice(''),7500)}
 function onGoto(v:Section){setPage(v);setSearch('')}
 async function refresh(){
  if(demo){setRecords(mockRecords());return}
  if(!authenticated)return;
  setBusy(true);
  try{const [r,j,e,s,x,trash]=await Promise.all([ops.listRecords(),ops.listJobs(),ops.listEvents(),ops.preferences(),ops.listExceptions(),cloud.listTrashed()]);setRecords(r);setTrashedProcesses(trash);setJobs(j);setEvents(e);setSettings(s);setExceptions(x);setError('')}
  catch(e:any){setError('Refresh failed: '+(e?.message||'Please try again.'))}
  finally{setBusy(false)}
 }
 function onNew(){setRecord({...blankProcess(),team_id:activeTeam||null});setPickFile(null);setImportIssue('');setDialog(true)}
 function onEdit(r:any){setRecord({...r});setPickFile(null);setImportIssue('');setDialog(true)}
 async function onImportFile(file?:File){
  if(!file)return;
  setBusy(true);setError('');setImportIssue('');
  try{
    const fields=await cloud.extract(file,'pickDoc');
    setRecord({...blankProcess(),team_id:activeTeam||null,...fields});
    setImportIssue(fields._reviewRecommended?('This '+(fields._readMethod==='ocr_photo'?'photo':'scanned PDF')+' required OCR'+(typeof fields._ocrConfidence==='number'?', text confidence '+Math.round(fields._ocrConfidence)+'%':'')+'. Verify all three values against the original before saving.'):'');
    onNotice('Pick Slip identified. Review Process No., Party Name and SO No. before saving.');
  }catch(e:any){
    const partial=e?.partial&&typeof e.partial==='object'?e.partial:{};
    setRecord({...blankProcess(),team_id:activeTeam||null,...partial});
    const missing=['process','party','so'].filter(key=>!String(partial[key]||'').trim());
    setImportIssue('Automatic PDF reading could not fill '+(missing.length?missing.map(k=>k==='process'?'Process No.':k==='party'?'Party Name':'SO No.').join(', '):'all fields')+'. '+(e?.message||'Review the PDF and enter the missing values.'));
    onNotice('Pick Slip needs review; any successfully extracted fields were kept.');
  }finally{
    setPickFile(file);setDialog(true);setBusy(false);
  }
 }
 async function onSave(r:any,files:Record<string,File>){
  const process=String(r.process||'').trim(),party=String(r.party||'').trim(),so=String(r.so||'').trim();
  if(!process||!party||!so)throw Error('Process No., Party Name and SO No. are required.');
  if(records.some(x=>x.process===process&&x.id!==r.id))throw Error('Process No. already exists: '+process);
  if(demo){saveDemo({...r,process,party,so});setRecords(mockRecords());setDialog(false);setPickFile(null);onNotice('Saved on this browser only. Uploaded PDF bytes were NOT stored. No cloud data was changed.');return}
  const saved=await ops.save({...r,process,party,so,team_id:r.id?r.team_id:(r.team_id||activeTeam||null),stage:r.stage||'Universal Process',status:r.status||'Review'},r.id&&r.stage==='Email to Client'?'Moved to Email to Client':r.id?'Process updated':'Process created');
  const failures:{kind:string;message:string}[]=[];
  for(const [kind,file] of Object.entries(files)){
    try{await cloud.upload(saved.id,kind,file)}
    catch(e:any){failures.push({kind,message:String(e?.message||'Upload failed')})}
  }
  await refresh();
  if(failures.length){
    onNotice('Process '+process+' was saved, but '+failures.length+' attachment(s) failed. Keep this window open and retry the missing file(s).');
    return {saved,failed:failures.map(f=>f.kind),details:failures.map(f=>f.kind+': '+f.message).join('; ')};
  }
  setDialog(false);setPickFile(null);
  if(r.stage==='Email to Client')onGoto('Email to Client');
  onNotice('Process '+process+(r.stage==='Email to Client'?' moved to Email to Client.':' saved.')+' '+Object.keys(files).length+' attachment(s) saved successfully.');
 }
 async function onDeleteProcess(r:any){
  if(!authenticated)throw Error('Sign in before deleting a process.');
  await cloud.setTrash(r);
  setDialog(false);setPickFile(null);
  await refresh();
  onNotice('Process '+r.process+' moved to Deleted Processes. Documents are preserved; restore it from Data Store.');
 }
 async function onRestoreProcess(r:any){
  if(!authenticated)return;
  setBusy(true);
  try{await cloud.setTrash(r,true);await refresh();onNotice('Process '+r.process+' restored with its documents.')}
  catch(e:any){setError(e?.message||'Unable to restore process')}
  finally{setBusy(false)}
 }
 async function onAttach(r:any,kind:string,file?:File){
  if(!file)return;
  if(!authenticated){onNotice('Document uploads require protected cloud storage. Local workspace does not retain file bytes.');return}
  setBusy(true);
  try{await cloud.upload(r.id,kind,file);await ops.audit(r,'Document uploaded',{kind,name:file.name});await refresh();onNotice('Document added to '+r.process)}
  catch(e:any){setError(e?.message||'Could not upload file.')}
  finally{setBusy(false)}
 }
 async function onAttachDonePick(r:any,file:File,extractedProcess:string){
  if(!authenticated)throw Error('Sign in to private cloud before attaching a Done Pick List.');
  const process=String(r.process||'').trim();
  await cloud.upload(r.id,'donePickDoc',file,{verifiedProcessNo:process,extractedProcessNo:extractedProcess});
  let auditWarning=false;
  try{await ops.audit(r,'Done Pick List attached',{filename:file.name,extractedProcessNo:extractedProcess||null,verifiedProcessNo:process})}catch{auditWarning=true}
  await refresh();
  onNotice('Done Pick List photo saved under Process '+process+'.'+(auditWarning?' Audit entry could not be recorded.':''));
 }
 async function onStage(r:any,stage:string,status?:string){
  if(stage==='Complete'){
    if(exceptions.some(x=>x.process_id===r.id&&x.status!=='resolved')){setError('Resolve all open Check List cases for Process '+r.process+' before closing.');return}
    const result=canCloseProcess(r,jobs);
    if(!result.ready){setError('Cannot close Process '+r.process+': '+result.missing.join(', '));return}
  }
  if(stage==='Dispatch Tracking'&&exceptions.some(x=>x.process_id===r.id&&x.status!=='resolved')){setError('Resolve open Check List cases before returning this process to tracking.');return}
  if(demo){saveDemo({...r,stage,status:status||r.status});setRecords(mockRecords());onNotice('Stage updated in this browser only.');return}
  setBusy(true);try{await ops.stage(r,stage,status);await refresh();onNotice('Process '+r.process+' moved to '+stage)}
  catch(e:any){setError(e?.message||'Unable to update stage.')}finally{setBusy(false)}
 }
 async function onReportException(r:any,category:string,description:string){
  if(!authenticated)throw Error('Cloud login is required for exception tracking.');
  await ops.reportException(r,category,description);
  await ops.stage({...r,exceptionReason:description},'Check List','Exception');
  await refresh();onNotice('Exception recorded for Process '+r.process+'.');
 }
 async function onResolveException(item:any,r:any,resolution:string){
  if(!authenticated)throw Error('Cloud login is required.');
  await ops.resolveException(item,r,resolution);
  const remaining=exceptions.filter(x=>x.process_id===r.id&&x.id!==item.id&&x.status!=='resolved');
  if(!remaining.length){await ops.save({...r,exceptionReason:''},'Exception reason cleared after resolution');}
  await refresh();onNotice('Resolution saved. Process stage is unchanged until you explicitly move it.');
 }
 async function onAgentMove(r:any,stage:'Email to Client'|'Dispatch Tracking'){
  if(!authenticated)throw Error('Sign in before modifying a cloud process.');
  if(!records.some(x=>x.id===r.id))throw Error('Process is no longer in your accessible workspace.');
  if(stage==='Dispatch Tracking'&&exceptions.some(x=>x.process_id===r.id&&x.status!=='resolved')){
   throw Error('Resolve the open Check List exceptions before moving this process to tracking.');
  }
  await ops.stage(r,stage,stage==='Email to Client'?'Ready for Email':'Pending');
  await refresh();
  onNotice('Process '+r.process+' moved to '+stage+'. No email or office automation was executed.');
 }
 async function onQueue(r:any,type:JobType){
  if(!authenticated){onNotice('Automation jobs require an authenticated cloud account. Local workspace cannot run or queue jobs.');return}
  setBusy(true);try{await ops.queue(r,type,jobs,settings);await refresh();onNotice('Job queued. Python worker not yet connected; no DataDoc, courier or Outlook action has run.')}
  catch(e:any){setError(e?.message||'Unable to queue request.')}finally{setBusy(false)}
 }
 function onDraftEmail(r:any){
  const text='Subject: Dispatch update | Process '+r.process+' | SO '+(r.so||'')+'\n\nDear Customer,\n\nPlease find the dispatch details for your order:\nProcess: '+r.process+'\nSO No.: '+(r.so||'')+'\nInvoice No.: '+(r.invoice||'Pending')+'\nTransporter: '+(r.transporter||'Pending')+'\nLR / Docket: '+(r.lr||'Pending')+'\n\nRegards,\nPJS Dispatch Team';
  void navigator.clipboard.writeText(text).then(()=>onNotice('Email draft copied. Review in Outlook before sending.')).catch(()=>setError('Clipboard unavailable; enable clipboard permissions and retry.'));
 }
 function onExport(){
  const keys=[['process','Process No.'],['so','SO No.'],['party','Party Name'],['invoice','Invoice No.'],['transporter','Transporter'],['lr','LR'],['stage','Stage'],['status','Status']];
  const quote=(v:any)=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const csv='\uFEFF'+keys.map(x=>quote(x[1])).join(',')+'\n'+results.map(r=>keys.map(x=>quote(r[x[0]])).join(',')).join('\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='PJS_OMS_'+new Date().toISOString().slice(0,10)+'.csv';a.click();URL.revokeObjectURL(url);
 }
 async function onSignOut(){if(user&&supabase)await supabase.auth.signOut();setDemo(false);setUser(null);setRecords([]);setActiveTeam('');setPage('Control Tower');setError('')}
 if(checking)return <div className='ux-loading'><span/><b>Loading PJS Operations…</b></div>;
 if(!user&&!demo)return <UnifiedLogin onDemo={()=>{setDemo(true);setPage('Control Tower')}}/>;
 const p={records,trashedProcesses,onRestoreProcess,results,stats,authenticated,onAgentMove,onOpenDonePickOCR:()=>setDonePickOpen(true),jobs,events,exceptions,onReportException,onResolveException,settings,setSettings,busy,demo,userId:user?.id||'',activeTeam,onTeamSelect:setActiveTeam,onRefresh:refresh,search,setSearch,onEdit,onImport:()=>picker.current?.click(),onDonePick:()=>onGoto('Done Pick List'),onNew,onExport,onGoto,onStage,onQueue,onAttach,onDraftEmail,onError:setError,onNotice};
 return <UnifiedShell page={page} onPage={onGoto} onRefresh={()=>void refresh()} onSignOut={()=>void onSignOut()} demo={demo} user={user} stats={stats} notificationCount={agentUnread} busy={busy}>
  {error&&<div className='ux-alert error' role='alert'><AlertCircle size={18}/><span>{error}</span><button onClick={()=>setError('')}><X size={15}/></button></div>}
  {notice&&<div className='ux-alert info' role='status'><CheckCircle2 size={18}/><span>{notice}</span><button onClick={()=>setNotice('')}><X size={15}/></button></div>}
  {(['Control Tower','Data Store','Universal Process'] as Section[]).includes(page)?<UnifiedCorePages page={page} p={p}/>:<><UnifiedStagePagesA page={page} p={p}/><UnifiedStagePagesB page={page} p={p}/></>}
  <input ref={picker} type='file' hidden accept='.pdf,.jpg,.jpeg,.png' onChange={e=>{void onImportFile(e.target.files?.[0]);e.target.value=''}}/>
  {donePickOpen&&<DonePickListUpload records={records} authenticated={authenticated} onClose={()=>setDonePickOpen(false)} onAttach={onAttachDonePick} onGoToDataStore={()=>{setDonePickOpen(false);onGoto('Data Store')}}/>}
  {dialog&&record&&<UnifiedDialog key={record.id||record.process||'new'} record={record} sourceFile={pickFile} importIssue={importIssue} demo={demo} userId={user?.id||''} onDelete={onDeleteProcess} onClose={()=>{setDialog(false);setPickFile(null)}} onSave={onSave}/>}
 </UnifiedShell>;
}

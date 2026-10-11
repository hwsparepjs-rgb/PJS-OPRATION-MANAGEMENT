import {Activity,CheckCircle2,Download,FileClock} from 'lucide-react';
import {Button,Empty,Heading,Panel,Tone} from './UnifiedKit';
import ExcelLRWorkspace from './ExcelLRWorkspace';
import DonePickListPage from './DonePickListPage';
import PendingChecks from './PendingChecks';
import ExceptionDesk from './ExceptionDesk';
import {showDate} from './unifiedOps';
import SettingsControlCenter from './SettingsControlCenter';
export default function UnifiedStagePagesB({page,p}:{page:string;p:any}){
 const {results,records,authenticated,events,jobs,exceptions,onReportException,onResolveException,onEdit,onStage,onExport,busy,demo}=p;
 if(page==='Done Pick List')return <DonePickListPage records={records} authenticated={authenticated}/>;
 if(page==='Check List')return <><Heading eyebrow='EXCEPTION MANAGEMENT' title='Check List' description='Document failed deliveries, missing paperwork and returns. Each case needs an auditable written resolution.'/><ExceptionDesk records={results} exceptions={exceptions} onEdit={onEdit} onReport={onReportException} onResolve={onResolveException} onReturn={r=>onStage(r,'Dispatch Tracking','Pending')} busy={busy}/></>;
 if(page==='Excel & LR Finder')return <><Heading eyebrow='DOCUMENT INTELLIGENCE' title='Excel & LR Finder' description='Read courier bills, extract LR / Docket numbers, and match them with stored PJS process records.'/><ExcelLRWorkspace records={records}/></>;
 if(page==='Pending Task Review')return <><Heading eyebrow='AUTOMATED COMPLETENESS CHECKS' title='Pending Task Review' description='Real-time document and field checks; AI-generated actions remain disabled until verified.'/><PendingChecks records={records} onOpen={onEdit}/></>;
 if(page==='Audit & Reports')return <><Heading eyebrow='OPERATIONS INTELLIGENCE' title='Audit & Reports' description='Review process transitions and automation requests. Worker execution status is never assumed.' actions={<Button onClick={onExport}><Download size={16}/> Export CSV</Button>}/><div className='ux-two-col'><Panel title='Recent workflow activity' subtitle={demo?'Cloud audit is unavailable in local mode.':'Cloud events from process changes.'}>{events.length?<div className='ux-event-list'>{events.slice(0,35).map((e:any)=><div className='ux-event' key={e.id}><span><CheckCircle2 size={15}/></span><div><strong>{e.action}</strong><small>Process {e.process_no||'—'} · {showDate(e.created_at)}</small></div></div>)}</div>:<Empty icon={FileClock} title='No activity yet' help='Create or edit a process to start the cloud audit trail.'/>}</Panel><Panel title='Automation job queue' subtitle='Requests wait for the office PC automation worker.' actions={<span className='ux-offline'>WORKER NOT CONNECTED</span>}>{jobs.length?<div className='ux-job-list'>{jobs.slice(0,35).map((j:any)=><div className='ux-job' key={j.id}><div><strong>{String(j.job_type).replaceAll('_',' ')}</strong><small>{j.process_no} · {showDate(j.created_at)}</small></div><Tone value={j.status}/>{j.error_message&&<small className='ux-warning'>{j.error_message}</small>}</div>)}</div>:<Empty icon={Activity} title='No job requests' help='Approved tracking or DataDoc queue requests will be listed here.'/>}</Panel></div></>;
 if(page==='Settings')return <SettingsControlCenter p={p}/>;
 return null;
}

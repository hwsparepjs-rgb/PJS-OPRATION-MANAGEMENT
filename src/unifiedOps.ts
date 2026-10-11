import { supabase } from './independentClient';
import { cloud } from './cloud';
import {checkBill,checkJob,type RulePrefs} from './businessRules';

export type JobType='bill_submit'|'datadoc_submit'|'tracking'|'delivery_proof_submit'|'email_reply';
export type Job={id:string;process_id:string;process_no:string;job_type:JobType;status:string;progress:number;error_message:string|null;created_at:string;updated_at:string;payload:any;result:any};
export type AuditEvent={id:string;process_id:string|null;process_no:string;action:string;details:any;created_at:string};
export type Preferences={ebill_threshold:number;retrack_days:number;reminder_days:number};
export const defaults:Preferences={ebill_threshold:50000,retrack_days:3,reminder_days:10};
const DEMO_KEY='oms-unified-local-v1';
function demoData(){try{return JSON.parse(localStorage.getItem(DEMO_KEY)||'{}')}catch{return {}}}
export function showDate(value:any){if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?String(value):d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}
export function missingDocs(r:any){const kinds=new Set((r.documents||[]).map((d:any)=>d.kind));const warnings:string[]=[];if(!kinds.has('pickDoc'))warnings.push('Pick Slip');if(!r.so)warnings.push('SO No.');if(!r.party)warnings.push('Party Name');return warnings}
export function readyForBill(r:any,threshold=50000){return checkBill(r,threshold).ready}
export function stageName(r:any){return r.stage||'Universal Process'}
export function isException(r:any){return /check list|exception|rto|delay|return|error|failed/i.test([r.stage,r.status,r.trackingStatus,r.exceptionReason].join(' '))}
export function mockRecords():any[]{const saved=demoData();return Array.isArray(saved.records)?saved.records:[];}
export function saveDemo(r:any){const records=mockRecords();const row={...r,id:r.id||'demo-'+Date.now()};const ix=records.findIndex(x=>x.id===row.id);if(ix>=0)records[ix]=row;else records.unshift(row);localStorage.setItem(DEMO_KEY,JSON.stringify({records}));return row}
async function currentUser(){if(!supabase)throw Error('Sign in is required');const {data,error}=await supabase.auth.getUser();if(error||!data.user)throw Error('Sign in is required');return data.user}
export const ops={
  async listRecords(){return await cloud.list()},
  async listJobs():Promise<Job[]>{await currentUser();const {data,error}=await supabase!.from('oms_jobs').select('*').order('created_at',{ascending:false}).limit(150);if(error)throw error;return data||[]},
  async listExceptions():Promise<any[]>{
    await currentUser();
    const {data,error}=await supabase!.from('oms_exceptions').select('*').order('created_at',{ascending:false}).limit(250);
    if(error)throw error;return data||[];
  },
  async reportException(r:any,category:string,description:string){
    const u=await currentUser();
    const {data,error}=await supabase!.from('oms_exceptions').insert({
      process_id:r.id,created_by:u.id,category,description:description.trim(),status:'open'
    }).select().single();
    if(error)throw error;
    await ops.audit(r,'Exception reported',{exceptionId:data.id,category});
    return data;
  },
  async resolveException(item:any,r:any,resolution:string){
    await currentUser();
    if(resolution.trim().length<8)throw Error('Enter at least 8 characters describing the resolution');
    const {data,error}=await supabase!.from('oms_exceptions').update({
      status:'resolved',resolution:resolution.trim()
    }).eq('id',item.id).select().single();
    if(error)throw error;
    await ops.audit(r,'Exception resolved',{exceptionId:item.id,category:item.category,resolution:resolution.trim()});
    return data;
  },
  async listEvents():Promise<AuditEvent[]>{await currentUser();const {data,error}=await supabase!.from('oms_events').select('*').order('created_at',{ascending:false}).limit(160);if(error)throw error;return data||[]},
  async preferences():Promise<Preferences>{const u=await currentUser();const {data,error}=await supabase!.from('oms_preferences').select('*').eq('user_id',u.id).maybeSingle();if(error)throw error;return data?{ebill_threshold:Number(data.ebill_threshold),retrack_days:data.retrack_days,reminder_days:data.reminder_days}:defaults},
  async updatePreferences(p:Preferences){const u=await currentUser();const {error}=await supabase!.from('oms_preferences').upsert({user_id:u.id,ebill_threshold:p.ebill_threshold,retrack_days:p.retrack_days,reminder_days:p.reminder_days,updated_at:new Date().toISOString()});if(error)throw error},
  async audit(r:any,action:string,details:any={}){const u=await currentUser();const {error}=await supabase!.from('oms_events').insert({user_id:u.id,process_id:r.id||null,process_no:r.process||'',action,details});if(error)throw error},
  async save(r:any,action='Process saved'){const result=await cloud.save(r);await ops.audit(result,action,{stage:result.stage||'Universal Process'});return result},
  async stage(r:any,stage:string,status?:string){const saved=await cloud.save({...r,stage,status:status||r.status||'Pending'});await ops.audit(saved,'Moved to '+stage,{previousStage:r.stage||'Universal Process',newStage:stage});return saved},
  async queue(r:any,type:JobType,existing:Job[],prefs:RulePrefs=defaults){
    const u=await currentUser();
    if(!r.id||!r.process)throw Error('Save this process first.');
    if(existing.some(j=>j.process_id===r.id&&j.job_type===type&&['queued','running'].includes(j.status)))throw Error('A '+type.replaceAll('_',' ')+' job is already queued for '+r.process);
    if(type==='bill_submit'&&existing.some(j=>j.process_id===r.id&&j.job_type==='bill_submit'&&j.status==='completed'))throw Error('DataDoc bill was already submitted for this process. Verify DataDoc instead of creating a duplicate.');
    const verification=checkJob(r,type,prefs,existing);
    if(!verification.ready)throw Error('Cannot queue '+type.replaceAll('_',' ')+'. Missing: '+verification.missing.join(', '));
    const {data,error}=await supabase!.from('oms_jobs').insert({user_id:u.id,process_id:r.id,process_no:r.process,job_type:type,status:'queued',progress:0,office_execution:type==='bill_submit'?'auto_on_login':'manual',payload:{process:r.process,so:r.so||'',transporter:r.transporter||'',tracking_id:r.lr||'',stage:r.stage||'Universal Process',authorized_by:u.id,requested_at:new Date().toISOString()}}).select().single();
    if(error)throw error;
    try{await ops.audit(r,'Job queued · '+type,{jobId:data.id,worker:type==='bill_submit'?'approved_office_auto_queue':'manual_worker_pending'});}catch(e){console.warn('Job queued successfully but activity log could not be written',e)}
    return data as Job;
  }
};

import {supabase} from './independentClient';

export type CloudJobType='process_audit'|'document_extract';
export type CloudJob={
 id:string;user_id:string;process_id:string;process_no:string;
 job_type:CloudJobType;status:'queued'|'running'|'completed'|'failed'|'cancelled';
 result:Record<string,any>;error_message:string|null;progress:number;
 worker_name:string|null;created_at:string;updated_at:string;finished_at:string|null;
};
export type CloudWorker={
 worker_name:string;status:'idle'|'busy'|'error'|'paused';
 last_seen_at:string;last_job_id:string|null;version:string;
};

async function requireUser(){
 if(!supabase)throw Error('Cloud automation needs PJS cloud login.');
 const {data,error}=await supabase.auth.getUser();
 if(error||!data.user)throw Error('Sign in before submitting cloud automation.');
 return data.user;
}

export const cloudJobsApi={
 async jobs():Promise<CloudJob[]>{
  const user=await requireUser();
  const {data,error}=await supabase!.from('oms_cloud_jobs')
    .select('id,user_id,process_id,process_no,job_type,status,result,error_message,progress,worker_name,created_at,updated_at,finished_at')
    .eq('user_id',user.id).order('created_at',{ascending:false}).limit(70);
  if(error)throw error;
  return (data||[]) as CloudJob[];
 },
 async workers():Promise<CloudWorker[]>{
  await requireUser();
  const {data,error}=await supabase!.from('oms_cloud_workers')
   .select('worker_name,status,last_seen_at,last_job_id,version')
   .order('last_seen_at',{ascending:false}).limit(6);
  if(error)throw error;
  return (data||[]) as CloudWorker[];
 },
 async queue(record:{id:string;process:string;documents?:any[]},jobType:CloudJobType):Promise<CloudJob>{
  const user=await requireUser();
  const processNo=String(record.process||'').trim();
  if(!record.id||!/^\d{5,9}$/.test(processNo))throw Error('Select a saved process with a valid 5–9 digit Process No.');
  if(jobType==='document_extract'&&!(record.documents||[]).some((d:any)=>['invoiceDoc','einvoiceDoc','ebillDoc','lrDoc'].includes(d.kind)))
   throw Error('First attach an Invoice, E-Invoice, E-Way Bill, or LR/Docket PDF to this process.');
  const {data,error}=await supabase!.from('oms_cloud_jobs').insert({
   user_id:user.id,process_id:record.id,process_no:processNo,
   job_type:jobType,status:'queued',progress:0,payload:{},result:{}
  }).select('id,user_id,process_id,process_no,job_type,status,result,error_message,progress,worker_name,created_at,updated_at,finished_at').single();
  if(error){
   if(error.code==='23505')throw Error('There is already a pending or running '+jobType.replace('_',' ')+' job for this process.');
   throw error;
  }
  return data as CloudJob;
 }
};

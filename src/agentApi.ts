import {supabase} from './independentClient';
export type AgentMessage={id:string;role:'user'|'assistant';content:string;source:'local'|'ai'|'web'|'system';created_at:string};
export type AgentTask={id:string;title:string;details:string;process_no:string|null;status:'pending'|'completed'|'cancelled';due_at:string|null;remind_at:string|null;created_at:string;updated_at:string};
export type AgentNotification={id:string;task_id:string|null;title:string;body:string;read_at:string|null;created_at:string};
async function userId(){
 if(!supabase)throw Error('Private cloud sign-in is required to save AI tasks and chat memory.');
 const {data,error}=await supabase.auth.getUser();
 if(error||!data.user)throw Error('Your session expired. Please sign in again.');
 return data.user.id;
}
export const agentApi={
 async messages():Promise<AgentMessage[]>{
  await userId();
  const {data,error}=await supabase!.from('oms_agent_messages')
   .select('id,role,content,source,created_at').order('created_at',{ascending:false}).limit(140);
  if(error)throw error;return (data||[]).reverse() as AgentMessage[];
 },
 async writeMessage(role:'user'|'assistant',content:string,source:'local'|'ai'|'web'|'system'='local'):Promise<AgentMessage>{
  const uid=await userId();
  const {data,error}=await supabase!.from('oms_agent_messages')
   .insert({user_id:uid,role,content:content.slice(0,12000),source}).select('id,role,content,source,created_at').single();
  if(error)throw error;return data as AgentMessage;
 },
 async clearMessages():Promise<void>{
  const uid=await userId();
  const {error}=await supabase!.from('oms_agent_messages').delete().eq('user_id',uid);
  if(error)throw error;
 },
 async tasks():Promise<AgentTask[]>{
  await userId();
  const {data,error}=await supabase!.from('oms_agent_tasks')
   .select('id,title,details,process_no,status,due_at,remind_at,created_at,updated_at')
   .order('created_at',{ascending:false}).limit(400);
  if(error)throw error;return (data||[]) as AgentTask[];
 },
 async createTask(title:string,processNo:string|null=null,at:string|null=null,details=''):Promise<AgentTask>{
  const uid=await userId();
  if(title.trim().length<3||title.trim().length>240)throw Error('Task title must be 3–240 characters.');
  if(at&&(!Number.isFinite(new Date(at).getTime())||new Date(at).getTime()<=Date.now()))throw Error('Reminders must be in the future.');
  const {data,error}=await supabase!.from('oms_agent_tasks').insert({
   user_id:uid,title:title.trim(),details:details.slice(0,3000),process_no:processNo,
   remind_at:at,due_at:at,status:'pending'
  }).select('id,title,details,process_no,status,due_at,remind_at,created_at,updated_at').single();
  if(error)throw error;return data as AgentTask;
 },
 async completeTask(id:string):Promise<AgentTask>{
  const uid=await userId();
  const {data,error}=await supabase!.from('oms_agent_tasks')
   .update({status:'completed'}).eq('id',id).eq('user_id',uid).eq('status','pending')
   .select('id,title,details,process_no,status,due_at,remind_at,created_at,updated_at').single();
  if(error)throw error;return data as AgentTask;
 },
 async reopenTask(id:string):Promise<AgentTask>{
  const uid=await userId();
  const {data,error}=await supabase!.from('oms_agent_tasks')
   .update({status:'pending'}).eq('id',id).eq('user_id',uid).eq('status','completed')
   .select('id,title,details,process_no,status,due_at,remind_at,created_at,updated_at').single();
  if(error)throw error;return data as AgentTask;
 },
 async notifications():Promise<AgentNotification[]>{
  await userId();
  const {data,error}=await supabase!.from('oms_agent_notifications')
    .select('id,task_id,title,body,read_at,created_at').order('created_at',{ascending:false}).limit(100);
  if(error)throw error;return (data||[]) as AgentNotification[];
 },
 async markNotificationRead(id:string):Promise<void>{
  const uid=await userId();
  const {error}=await supabase!.from('oms_agent_notifications')
    .update({read_at:new Date().toISOString()}).eq('id',id).eq('user_id',uid);
  if(error)throw error;
 },
 async aiStatus():Promise<boolean>{
  if(!supabase) return false;
  const {data,error}=await supabase.functions.invoke('pjs-agent',{body:{op:'status'}});
  if(error)throw error;
  return Boolean(data?.configured);
 },
 async askAI(question:string,history:{role:'user'|'assistant';content:string}[],context?:{summary?:string;matchedProcess?:any},web=false):Promise<{answer:string;sources:{title:string;url:string}[];configured:boolean}>{
  await userId();
  const {data,error}=await supabase!.functions.invoke('pjs-agent',{body:{
   op:'chat',question:question.slice(0,2400),history:history.slice(-12),
   context:context||{},web
  }});
  if(error)throw Error(error.message||'AI service is not available');
  return {answer:String(data?.answer||''),sources:Array.isArray(data?.sources)?data.sources:[],configured:Boolean(data?.configured)};
 }
};

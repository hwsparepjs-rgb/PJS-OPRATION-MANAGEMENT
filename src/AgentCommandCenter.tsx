import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {
 AlertCircle,ArrowUpRight,Bell,BellRing,Bot,CalendarClock,Check,CheckCheck,CheckCircle2,
 ClipboardList,Clock3,ExternalLink,FileSearch,Globe,LoaderCircle,LockKeyhole,
 MessageCircle,Plus,RefreshCw,Search,SendHorizontal,ShieldCheck,Sparkles,Trash2
} from 'lucide-react';
import {agentApi,type AgentMessage,type AgentNotification,type AgentTask} from './agentApi';
import {parseCommand,formatLocalDue} from './agentCommands';
import {missingDocs} from './unifiedOps';
import './agent-command-center.css';

type PendingMove={record:any;stage:'Email to Client'|'Dispatch Tracking'};
const suggestions=[
 'Show my pending tasks','Summarize my operations',
 'Find process 292168','Remind me to follow up tomorrow at 9am',
 'Search web for latest logistics updates'
];
const starter='Welcome to your PJS AI Command Center. You can ask about your processes, create tasks, set scheduled reminders, and search the web when AI is connected. I will ask for confirmation before changing process stages. The office automation worker remains offline.';
function richText(value:string){
 return value.split(/(https:\/\/[^\s<>"']+)/g).map((p,i)=>/^https:\/\/[^\s<>"']+$/.test(p)?
  <a key={i} href={p} target='_blank' rel='noopener noreferrer'>{p} <ArrowUpRight size={11}/></a>:<span key={i}>{p}</span>);
}
export default function AgentCommandCenter({
 records,authenticated,onEdit,onRefresh,onMove
}:{
 records:any[];authenticated:boolean;onEdit:(record:any)=>void;onRefresh:()=>Promise<void>;
 onMove:(record:any,stage:'Email to Client'|'Dispatch Tracking')=>Promise<void>;
}){
 const [messages,setMessages]=useState<AgentMessage[]>([]);
 const [tasks,setTasks]=useState<AgentTask[]>([]);
 const [notifications,setNotifications]=useState<AgentNotification[]>([]);
 const [input,setInput]=useState('');
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [aiConfigured,setAIConfigured]=useState<boolean|null>(null);
 const [taskTitle,setTaskTitle]=useState('');
 const [taskDate,setTaskDate]=useState('');
 const [taskProcess,setTaskProcess]=useState('');
 const [tab,setTab]=useState<'tasks'|'alerts'|'review'>('tasks');
 const [pendingMove,setPendingMove]=useState<PendingMove|null>(null);
 const [selectedRecord,setSelectedRecord]=useState<any|null>(null);
 const [showTaskForm,setShowTaskForm]=useState(false);
 const [localNotice,setLocalNotice]=useState('');
 const conversationEnd=useRef<HTMLDivElement|null>(null);
 const textarea=useRef<HTMLTextAreaElement|null>(null);
 const refreshStamp=useRef(0);
 const recordsRef=useRef(records);recordsRef.current=records;
 const tasksRef=useRef(tasks);tasksRef.current=tasks;
 const messagesRef=useRef(messages);messagesRef.current=messages;
 const unread=notifications.filter(n=>!n.read_at);
 const pending=useMemo(()=>tasks.filter(t=>t.status==='pending'),[tasks]);
 const today=new Date().toLocaleDateString('en-CA');
 const overdue=useMemo(()=>pending.filter(t=>t.due_at&&new Date(t.due_at).getTime()<Date.now()),[pending]);
 const documentIssues=useMemo(()=>records.flatMap(record=>missingDocs(record).map(reason=>({record,reason}))).slice(0,30),[records]);

 const reload=useCallback(async()=>{
  if(!authenticated)return;
  const [m,t,n]=await Promise.all([agentApi.messages(),agentApi.tasks(),agentApi.notifications()]);
  setMessages(m);setTasks(t);setNotifications(n);
 },[authenticated]);
 useEffect(()=>{
  if(!authenticated){setLoading(false);setError('Sign in to your private cloud account to save AI chat history, tasks and reminders.');return}
  let live=true;
  setLoading(true);
  void Promise.all([agentApi.messages(),agentApi.tasks(),agentApi.notifications(),agentApi.aiStatus().catch(()=>false)])
    .then(([m,t,n,status])=>{if(live){setMessages(m);setTasks(t);setNotifications(n);setAIConfigured(status);setError('')}})
    .catch(e=>{if(live)setError('Agent data could not load: '+(e?.message||'Check your connection.'))})
    .finally(()=>{if(live)setLoading(false)});
  return()=>{live=false};
 },[authenticated]);
 useEffect(()=>{conversationEnd.current?.scrollIntoView({behavior:'smooth',block:'end'})},[messages.length,busy]);
 useEffect(()=>{
  if(!authenticated)return;
  const timer=setInterval(()=>{
   void agentApi.notifications().then(n=>setNotifications(n)).catch(()=>{});
   void agentApi.tasks().then(t=>setTasks(t)).catch(()=>{});
  },60000);
  return()=>clearInterval(timer);
 },[authenticated]);
 function appendLocal(role:'user'|'assistant',content:string,source:'local'|'ai'|'web'|'system'='local'){
  const row:AgentMessage={id:crypto.randomUUID(),role,content,source,created_at:new Date().toISOString()};
  setMessages(old=>[...old,row]);return row;
 }
 async function saveMessage(role:'user'|'assistant',content:string,source:'local'|'ai'|'web'|'system'='local'){
  if(!authenticated)return appendLocal(role,content,source);
  const message=await agentApi.writeMessage(role,content,source);
  setMessages(old=>[...old,message]);
  return message;
 }
 async function command(text:string):Promise<{reply:string;source:'local'|'ai'|'web'}>{
  const cmd=parseCommand(text);
  const available=tasksRef.current;
  const currentRecords=recordsRef.current;
  const pendingNow=available.filter(x=>x.status==='pending');
  if(cmd.kind==='help')return {source:'local',reply:
   'Commands I can execute now:\n• Create task Follow up Process 292168\n• Remind me to call customer tomorrow at 9am\n• Remind me to review Process 292168 in 2 hours\n• Show my pending tasks / Show overdue tasks\n• Complete task 1\n• Find process 292168\n• Summarize my operations\n• Move process 292168 to Email (requires your confirmation)\n• Search web for freight news (requires AI web search key)\n\nI do not send emails or execute DataDoc/courier jobs while the office worker is offline.'};
  if(!authenticated&&['create_task','remind_task','complete_task'].includes(cmd.kind))throw Error('Sign in to save tasks and reminders privately.');
  if(cmd.kind==='create_task'){
   const t=await agentApi.createTask(cmd.title,cmd.processNo);
   setTasks(old=>[t,...old]);
   return {source:'local',reply:'Task saved in your private workspace: '+t.title+'. It will stay in Pending until you mark it complete.'};
  }
  if(cmd.kind==='remind_task'){
   const t=await agentApi.createTask(cmd.title,cmd.processNo,cmd.at);
   setTasks(old=>[t,...old]);
   return {source:'local',reply:'Reminder scheduled for '+formatLocalDue(cmd.at)+': '+t.title+'. It will appear in Notifications when due; Chrome may also notify you while the website is open and notification permission is granted.'};
  }
  if(cmd.kind==='ask_reminder_time')return {source:'local',reply:
   'I can save this task, but I need an exact future time. Try: "Remind me to '+cmd.title+' tomorrow at 9am", "Remind me to '+cmd.title+' in 2 hours", or "Remind me to '+cmd.title+' on 2026-10-15 at 10:30".'};
  if(cmd.kind==='list_tasks'){
   const filtered=available.filter(t=>cmd.filter==='all'||t.status==='pending').filter(t=>
     cmd.filter==='overdue'?Boolean(t.due_at&&new Date(t.due_at)<new Date()):
     cmd.filter==='today'?Boolean(t.due_at&&new Date(t.due_at).toLocaleDateString('en-CA')===today):true);
   if(!filtered.length)return {source:'local',reply:'No '+cmd.filter+' tasks found. Try "create task Follow up Process 292168".'};
   return {source:'local',reply:'Your '+cmd.filter+' tasks ('+filtered.length+'):\n'+filtered.slice(0,18).map(t=>{
    const index=pendingNow.findIndex(x=>x.id===t.id);
    return (index>=0?index+1+'. ':'• ')+t.title+(t.remind_at?' — '+formatLocalDue(t.remind_at):'')+(t.status==='completed'?' ✓':'');
   }).join('\n')+(filtered.length>18?'\n… more tasks are available in the Tasks panel.':'')};
  }
  if(cmd.kind==='complete_task'){
   const match=pendingNow[cmd.index-1];
   if(!match)return {source:'local',reply:'Task '+cmd.index+' was not found in your pending list. Ask "show my pending tasks" first.'};
   const updated=await agentApi.completeTask(match.id);
   setTasks(old=>old.map(t=>t.id===updated.id?updated:t));
   return {source:'local',reply:'Marked task '+cmd.index+' completed: '+updated.title+'.'};
  }
  if(cmd.kind==='find_process'){
   const r=currentRecords.find(x=>String(x.process)===cmd.processNo);
   if(!r)return {source:'local',reply:'I cannot find Process '+cmd.processNo+' among your loaded, authorized records. Check the Process No. or access to the team workspace.'};
   setSelectedRecord(r);
   const docs=(r.documents||[]).map((d:any)=>d.kind);
   return {source:'local',reply:'Process '+r.process+'\nParty: '+(r.party||'—')+'\nSO No.: '+(r.so||'—')+'\nStage: '+(r.stage||'Universal Process')+'\nStatus: '+(r.status||'Review')+'\nInvoice: '+(r.invoice||'Not provided')+'\nLR / Docket: '+(r.lr||'Not provided')+'\nSaved attachments: '+docs.length+'\n\nUse Open Process below to inspect or edit the master record.'};
  }
  if(cmd.kind==='move_process'){
   const r=currentRecords.find(x=>String(x.process)===cmd.processNo);
   if(!r)return {source:'local',reply:'Process '+cmd.processNo+' was not found in your accessible records, so no change was made.'};
   setPendingMove({record:r,stage:cmd.stage});
   return {source:'local',reply:'Ready to move Process '+cmd.processNo+' ('+(r.party||'Unknown party')+') from '+(r.stage||'Universal Process')+' to '+cmd.stage+'.\n\nPlease review the confirmation card before I make this change. I have not changed the process yet.'};
  }
  if(cmd.kind==='summarize'){
   const stages:Record<string,number>={};
   for(const r of currentRecords)stages[r.stage||'Universal Process']=(stages[r.stage||'Universal Process']||0)+1;
   const tally=Object.entries(stages).sort((a,b)=>b[1]-a[1]).slice(0,7).map(([s,n])=>'• '+s+': '+n).join('\n');
   return {source:'local',reply:'PJS workspace summary (currently loaded records):\n'+currentRecords.length+' active processes\n'+pendingNow.length+' pending agent tasks\n'+overdue.length+' overdue tasks\n'+documentIssues.length+' visible process-field/document issues (first 30 shown)\n\nStages:\n'+(tally||'No processes yet')+'\n\nThe office worker is offline; queued automations have not been executed.'};
  }
  if(cmd.kind==='open_site')return {source:'local',reply:'To open the requested HTTPS website, use this link:\n'+cmd.url+'\n\nI have not read or interacted with that site on your behalf.'};
  if(cmd.kind==='web_search'&&!aiConfigured){
   const url='https://www.google.com/search?q='+encodeURIComponent(cmd.query);
   return {source:'local',reply:'Live AI web search is not connected yet. You can open a regular browser search here:\n'+url+'\n\nTo let the agent research webpages and summarize results in chat, configure the server-side OPENAI_API_KEY in Supabase. I have not searched or verified live results.'};
  }
  if(cmd.kind==='ai_chat'&&!aiConfigured)return {source:'local',reply:
   'Natural-language AI answers are not connected to this workspace yet. I can still save tasks, schedule reminders, find and summarize your PJS processes, and prepare workflow changes for your approval.\n\nTry "help" to see available commands. For full AI chat and live web browsing, add OPENAI_API_KEY to your Supabase Edge Function Secrets.'};
  const web=cmd.kind==='web_search';
  const question=web?cmd.query:cmd.question;
  const processNo=(question.match(/\b(?:process\s*(?:no\.?|number)?\s*[:#-]?\s*)(\d{5,9})\b/i)||[])[1];
  const matched=processNo?currentRecords.find(x=>String(x.process)===processNo):null;
  const summary='Loaded active processes: '+currentRecords.length+'. Pending agent tasks: '+pendingNow.length+'. Office worker is offline.';
  const history=messagesRef.current.filter(m=>m.role==='user'||m.role==='assistant').slice(-10).map(m=>({role:m.role,content:m.content}));
  const response=await agentApi.askAI(question,history,{summary,matchedProcess:matched?{
   process:matched.process,party:matched.party,so:matched.so,stage:matched.stage,
   status:matched.status,documents:(matched.documents||[]).length
  }:undefined},web);
  if(!response.configured)setAIConfigured(false);
  const sources=response.sources.slice(0,8).map(s=>s.url);
  return {source:web?'web':'ai',reply:response.answer+(sources.length?'\n\nSources:\n'+sources.map((u,i)=>(i+1)+'. '+u).join('\n'):'')};
 }
 async function send(override?:string){
  const value=(override??input).trim();
  if(!value||busy||loading)return;
  if(value.length>2400){setError('Please use 2,400 characters or fewer per command.');return}
  setBusy(true);setInput('');setError('');setSelectedRecord(null);setPendingMove(null);
  try{
   await saveMessage('user',value);
   const reply=await command(value);
   await saveMessage('assistant',reply.reply,reply.source);
  }catch(e:any){
   const msg='Could not complete that command: '+(e?.message||'Please retry.');
   setError(msg);
   try{await saveMessage('assistant',msg)}catch{appendLocal('assistant',msg)}
  }finally{setBusy(false);textarea.current?.focus()}
 }
 async function confirmMove(){
  if(!pendingMove||busy)return;
  const {record,stage}=pendingMove;
  setBusy(true);setError('');
  try{
   await onMove(record,stage);
   setPendingMove(null);
   await saveMessage('assistant','Process '+record.process+' was moved to '+stage+'.','local');
  }catch(e:any){setError(e?.message||'Process could not be moved.')}
  finally{setBusy(false)}
 }
 async function createFromForm(){
  if(!taskTitle.trim()||busy)return;
  setBusy(true);setError('');
  try{
   const iso=taskDate?new Date(taskDate).toISOString():null;
   const task=await agentApi.createTask(taskTitle.trim(),taskProcess.trim()||null,iso);
   setTasks(old=>[task,...old]);setTaskTitle('');setTaskDate('');setTaskProcess('');setShowTaskForm(false);
   await saveMessage('assistant',task.remind_at?'Reminder created: '+task.title+' for '+formatLocalDue(task.remind_at):'Task created: '+task.title);
  }catch(e:any){setError(e?.message||'Task could not be saved.')}
  finally{setBusy(false)}
 }
 async function taskAction(t:AgentTask){
  if(busy)return;
  setBusy(true);setError('');
  try{
   const updated=t.status==='pending'?await agentApi.completeTask(t.id):await agentApi.reopenTask(t.id);
   setTasks(old=>old.map(x=>x.id===updated.id?updated:x));
  }catch(e:any){setError(e?.message||'Unable to update task.')}
  finally{setBusy(false)}
 }
 async function readNotification(n:AgentNotification){
  try{await agentApi.markNotificationRead(n.id);setNotifications(old=>old.map(x=>x.id===n.id?{...x,read_at:new Date().toISOString()}:x))}
  catch(e:any){setError(e?.message||'Cannot mark notification read.')}
 }
 async function clearChat(){
  if(!authenticated||!window.confirm('Clear your saved chat history? Your tasks and reminders will remain saved.'))return;
  try{await agentApi.clearMessages();setMessages([]);setLocalNotice('Chat history cleared. Tasks and reminders are preserved.')}
  catch(e:any){setError(e?.message||'Could not clear chat.')}
 }
 async function requestNotifications(){
  if(!('Notification' in window)){setLocalNotice('This browser does not support desktop notifications. In-app reminders will still appear.');return}
  const permission=await Notification.requestPermission();
  setLocalNotice(permission==='granted'?'Browser notifications allowed while this website is open.':'Browser notifications not allowed. In-app reminders will still appear.');
 }
 const currentTasks=tab==='tasks'?pending:tasks;
 return <section className='ac-root'>
  <div className='ac-heading'>
   <div><div className='ac-eyebrow'><Sparkles size={14}/> PJS INTELLIGENCE WORKSPACE</div>
    <h1>AI Command Center</h1>
    <p>Chat with your operations workspace, run supported commands, remember tasks and get reminders. Web research is available once AI is connected.</p>
   </div>
   <div className='ac-heading-actions'>
    <button className='ac-ghost' onClick={()=>void reload()} disabled={loading||busy}><RefreshCw size={15}/> Refresh</button>
    <span className={'ac-service '+(aiConfigured?'connected':'waiting')}><span/>{aiConfigured?'AI + Web Ready':'AI Setup Needed'}</span>
   </div>
  </div>
  {error&&<div className='ac-error' role='alert'><AlertCircle size={16}/><span>{error}</span><button onClick={()=>setError('')}>Dismiss</button></div>}
  {localNotice&&<div className='ac-info' role='status'>{localNotice}<button onClick={()=>setLocalNotice('')}>×</button></div>}
  <div className='ac-metrics'>
   <div><ClipboardList size={18}/><strong>{pending.length}</strong><span>Pending tasks</span></div>
   <div><CalendarClock size={18}/><strong>{overdue.length}</strong><span>Overdue</span></div>
   <div><Bell size={18}/><strong>{unread.length}</strong><span>Unread alerts</span></div>
   <div><FileSearch size={18}/><strong>{records.length}</strong><span>Loaded processes</span></div>
  </div>
  <div className='ac-layout'>
   <div className='ac-chat'>
    <header className='ac-chat-header'>
     <div className='ac-avatar'><Bot size={23}/></div>
     <div><strong>PJS Agent</strong><span><i/> {aiConfigured?'Natural-language AI connected':'Workspace command assistant active'}</span></div>
     <button type='button' className='ac-clear' title='Clear saved chat, not tasks' onClick={()=>void clearChat()} disabled={!authenticated||busy}><Trash2 size={15}/> Clear chat</button>
    </header>
    <div className='ac-conversation' aria-label='AI command conversation' role='log'>
     {!messages.length&&<div className='ac-welcome'>
      <div><Bot size={29}/></div><h2>Your operations assistant</h2><p>{starter}</p>
      <div className='ac-suggestions'>{suggestions.map(s=><button key={s} onClick={()=>{setInput(s);textarea.current?.focus()}}>{s}<ArrowUpRight size={12}/></button>)}</div>
     </div>}
     {messages.map(m=><div className={'ac-bubble-row '+(m.role==='user'?'mine':'agent')} key={m.id}>
      {m.role==='assistant'&&<span className='ac-mini-bot'><Bot size={14}/></span>}
      <div className='ac-bubble'>
       <div className='ac-bubble-content'>{richText(m.content)}</div>
       <small>{m.role==='assistant'?(m.source==='web'?'Web-assisted':m.source==='ai'?'AI response':'PJS command'):'You'} · {new Date(m.created_at).toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit'})}</small>
      </div>
     </div>)}
     {busy&&<div className='ac-working'><LoaderCircle size={16} className='ac-spin'/> Processing your command…</div>}
     {pendingMove&&<div className='ac-action-approval'>
      <ShieldCheck size={20}/><div><strong>Confirmation required</strong><p>Move Process <b>{pendingMove.record.process}</b> to <b>{pendingMove.stage}</b>? This changes the saved workflow stage but does not send an email or start the office worker.</p></div>
      <button onClick={()=>setPendingMove(null)} disabled={busy}>Cancel</button>
      <button className='confirm' disabled={busy} onClick={()=>void confirmMove()}>Confirm move</button>
     </div>}
     {selectedRecord&&<div className='ac-record-card'>
      <FileSearch size={18}/><div><strong>Process {selectedRecord.process}</strong><small>{selectedRecord.party||'No party'} · {selectedRecord.stage||'Universal Process'}</small></div>
      <button onClick={()=>onEdit(selectedRecord)}>Open process <ExternalLink size={13}/></button>
     </div>}
     <div ref={conversationEnd}/>
    </div>
    <div className='ac-compose'>
     <div className='ac-compose-hint'><LockKeyhole size={12}/> Cloud conversation memory stays private to your account. AI requests are sent to the configured provider when enabled.</div>
     <form onSubmit={e=>{e.preventDefault();void send()}}>
      <textarea ref={textarea} rows={2} maxLength={2400} value={input} onChange={e=>setInput(e.target.value)}
       onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send()}}}
       placeholder='Ask about a process, create a task, set a reminder, or search the web…'
       disabled={busy||loading}/>
      <button type='submit' disabled={!input.trim()||busy||loading} aria-label='Send command'><SendHorizontal size={19}/></button>
     </form>
     <div className='ac-compose-footer'><span>Enter to send · Shift+Enter for new line</span><span>Office automation: offline</span></div>
    </div>
   </div>
   <aside className='ac-side'>
    <div className='ac-tab-row'>
     <button className={tab==='tasks'?'active':''} onClick={()=>setTab('tasks')}><ClipboardList size={15}/> Tasks</button>
     <button className={tab==='alerts'?'active':''} onClick={()=>setTab('alerts')}><BellRing size={15}/> Alerts {unread.length>0&&<b>{unread.length}</b>}</button>
     <button className={tab==='review'?'active':''} onClick={()=>setTab('review')}><FileSearch size={15}/> Review</button>
    </div>
    {tab==='tasks'&&<div className='ac-side-content'>
     <div className='ac-section-head'><div><strong>My saved tasks</strong><small>Synced securely across your devices</small></div><button onClick={()=>setShowTaskForm(x=>!x)}><Plus size={16}/> New</button></div>
     {showTaskForm&&<div className='ac-task-form'>
      <label>Task title<input value={taskTitle} maxLength={240} onChange={e=>setTaskTitle(e.target.value)} placeholder='Follow up with customer'/></label>
      <label>Reminder date & time (optional)<input type='datetime-local' value={taskDate} onChange={e=>setTaskDate(e.target.value)}/></label>
      <label>Process No. (optional)<input value={taskProcess} onChange={e=>setTaskProcess(e.target.value.replace(/[^\d]/g,''))} placeholder='292168' maxLength={9}/></label>
      <button disabled={busy||taskTitle.trim().length<3||!authenticated} onClick={()=>void createFromForm()}><Check size={15}/> Save task</button>
     </div>}
     {!pending.length?<p className='ac-empty'><CheckCircle2 size={19}/> No pending tasks. Ask the agent to create one.</p>:
      <div className='ac-task-list'>{pending.slice(0,35).map((t,i)=><div className='ac-task-item' key={t.id}>
       <button className='ac-task-check' aria-label={'Complete '+t.title} onClick={()=>void taskAction(t)} disabled={busy}><span/></button>
       <div><strong>{i+1}. {t.title}</strong>{t.process_no&&<small>Process {t.process_no}</small>}{t.remind_at&&<small className={new Date(t.remind_at)<new Date()?'overdue':''}><Clock3 size={11}/>{formatLocalDue(t.remind_at)}</small>}</div>
      </div>)}</div>}
     <div className='ac-help-box'><strong>Example</strong><span>“Remind me to check Process 292168 tomorrow at 9am”</span></div>
    </div>}
    {tab==='alerts'&&<div className='ac-side-content'>
     <div className='ac-section-head'><div><strong>Reminders & notifications</strong><small>Scheduled in the cloud every minute</small></div></div>
     <button className='ac-notify-permission' onClick={()=>void requestNotifications()}><BellRing size={14}/> Allow browser notifications</button>
     <p className='ac-notify-note'>In-app alerts persist while you're away. Browser pop-ups require the website to be open; background phone push is not configured.</p>
     {notifications.length?notifications.slice(0,35).map(n=><div className={'ac-notice '+(!n.read_at?'new':'')} key={n.id}>
      <Bell size={15}/><div><strong>{n.title}</strong><small>{n.body}</small><small>{formatLocalDue(n.created_at)}</small></div>
      {!n.read_at&&<button onClick={()=>void readNotification(n)} title='Mark as read'><CheckCheck size={16}/></button>}
     </div>):<p className='ac-empty'>No notifications yet. Schedule a reminder to see it here when due.</p>}
    </div>}
    {tab==='review'&&<div className='ac-side-content'>
     <div className='ac-section-head'><div><strong>Processes needing review</strong><small>{documentIssues.length} visible field/document checks</small></div></div>
     {documentIssues.length?documentIssues.slice(0,25).map(({record,reason},i)=><div className='ac-review-item' key={record.id+'-'+i}>
      <AlertCircle size={14}/><div><strong>Process {record.process}</strong><small>{reason}</small></div><button onClick={()=>onEdit(record)}>Open</button>
     </div>):<p className='ac-empty'><CheckCircle2 size={18}/> No currently detected basic document issues.</p>}
     <p className='ac-notify-note'>These are basic record checks, not courier or DataDoc confirmations. The office worker remains offline.</p>
    </div>}
    <div className='ac-connection'>
     <Globe size={18}/><div><strong>{aiConfigured?'AI & live web browsing connected':'AI + web research needs an API key'}</strong><small>{aiConfigured?'OpenAI responses via authenticated Supabase Edge Function.':'Standard tasks, reminders and process commands already work. An administrator can enable full AI chat securely.'}</small></div>
    </div>
   </aside>
  </div>
 </section>;
}

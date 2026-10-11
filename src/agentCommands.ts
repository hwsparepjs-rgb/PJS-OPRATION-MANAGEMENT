export type Command=
 |{kind:'help'}
 |{kind:'create_task';title:string;processNo:string|null}
 |{kind:'remind_task';title:string;processNo:string|null;at:string}
 |{kind:'ask_reminder_time';title:string}
 |{kind:'list_tasks';filter:'pending'|'all'|'overdue'|'today'}
 |{kind:'complete_task';index:number}
 |{kind:'find_process';processNo:string}
 |{kind:'move_process';processNo:string;stage:'Email to Client'|'Dispatch Tracking'}
 |{kind:'cloud_audit';processNo:string}
 |{kind:'cloud_extract';processNo:string}
 |{kind:'cloud_list'}
 |{kind:'summarize'}
 |{kind:'web_search';query:string}
 |{kind:'open_site';url:string}
 |{kind:'ai_chat';question:string};

const two=(n:number)=>String(n).padStart(2,'0');
const validProcess=(value:string)=>/^\d{5,9}$/.test(value)&&!/^0+$/.test(value);
export function extractProcessNumber(input:string):string|null{
 const match=input.match(/\b(?:process|prc|process\s*no\.?)\s*(?:number|no\.?|#|:|-)?\s*(\d{5,9})\b/i);
 return match&&validProcess(match[1])?match[1]:null;
}
function dateAt(year:number,month:number,day:number,hour:number,minute:number):Date|null{
 const d=new Date(year,month-1,day,hour,minute,0,0);
 return d.getFullYear()===year&&d.getMonth()+1===month&&d.getDate()===day&&d.getHours()===hour&&d.getMinutes()===minute?d:null;
}
export function parseReminderMoment(text:string,now=new Date()):Date|null{
 const lower=text.toLowerCase().trim();
 const relative=lower.match(/\bin\s+(\d{1,4})\s*(minutes?|mins?|hours?|hrs?|days?)\b/);
 if(relative){
  const quantity=Number(relative[1]);
  if(quantity<1)return null;
  const unit=relative[2].startsWith('d')?86400000:relative[2].startsWith('h')?3600000:60000;
  return new Date(now.getTime()+quantity*unit);
 }
 const iso=lower.match(/\b(?:on\s+)?(20\d{2})-(\d{2})-(\d{2})\b/);
 const dayWord=lower.match(/\b(today|tomorrow)\b/);
 const time=lower.match(/\b(?:at\s*)?([01]?\d|2[0-3])(?::([0-5]\d))?\s*(am|pm)\b|\b(?:at\s*)?([01]?\d|2[0-3]):([0-5]\d)\b/);
 if(!time)return null;
 let hour=Number(time[1]??time[4]),min=Number(time[2]??time[5]??0);
 const suffix=time[3];
 if(suffix){if(hour<1||hour>12)return null;hour=hour%12+(suffix==='pm'?12:0)}
 const day=new Date(now.getFullYear(),now.getMonth(),now.getDate());
 if(dayWord?.[1]==='tomorrow')day.setDate(day.getDate()+1);
 else if(!dayWord&&!iso){
  // Do not invent a date for ambiguous clock-time-only reminders.
  return null;
 }
 const when=iso?dateAt(Number(iso[1]),Number(iso[2]),Number(iso[3]),hour,min):dateAt(day.getFullYear(),day.getMonth()+1,day.getDate(),hour,min);
 if(!when||when.getTime()<=now.getTime())return null;
 return when;
}
function reminderTitle(input:string){
 return input
  .replace(/^(?:please\s+)?remind\s+me(?:\s+to)?\s*/i,'')
  .replace(/\b(?:in\s+\d+\s*(?:minutes?|mins?|hours?|hrs?|days?)|(?:on\s+)?20\d{2}-\d{2}-\d{2}|today|tomorrow)\b/gi,'')
  .replace(/\b(?:at\s*)?(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:am|pm)\b|\b(?:at\s*)?(?:[01]?\d|2[0-3]):[0-5]\d\b/gi,'')
  .replace(/\s+/g,' ').replace(/[\s,.:;-]+$/g,'').trim();
}
export function parseCommand(raw:string,now=new Date()):Command{
 const text=raw.trim().slice(0,2500);
 const low=text.toLowerCase();
 if(/^\/?help$|^what can you do\??$|^commands\??$/i.test(text))return {kind:'help'};
 const web=text.match(/^(?:search\s+(?:the\s+)?web\s+(?:for\s+)?|browse\s+(?:the\s+)?web\s+(?:for\s+)?|google\s+|find\s+online\s+)(.+)$/i);
 if(web)return {kind:'web_search',query:web[1].trim()};
 const open=text.match(/^(?:open\s+(?:website\s+)?)(https:\/\/[^\s]+)$/i);
 if(open)return {kind:'open_site',url:open[1]};
 if(/^(?:show|list|what are|what's|what is)\b/i.test(text)&&/\b(tasks?|to-?do|reminders?|pending work)\b/i.test(low)){
  const filter=/\boverdue\b/.test(low)?'overdue':/\btoday\b/.test(low)?'today':/\ball\b/.test(low)?'all':'pending';
  return {kind:'list_tasks',filter};
 }
 if(/^(?:show|list)\s+(?:overdue|today)\b/.test(low)){
  return {kind:'list_tasks',filter:low.includes('overdue')?'overdue':'today'};
 }
 const done=text.match(/^(?:complete|finish|mark(?:\s+as)?\s+done|mark)\s+(?:task\s*)?#?(\d{1,4})\s*(?:done)?$/i);
 if(done)return {kind:'complete_task',index:Number(done[1])};
 const task=text.match(/^(?:add|create|save)\s+(?:a\s+)?(?:new\s+)?(?:task|to-?do)\s*(?:to|:|-)?\s+(.+)$/i);
 if(task)return {kind:'create_task',title:task[1].trim().slice(0,240),processNo:extractProcessNumber(task[1])};
 if(/^(?:please\s+)?remind\s+me\b/i.test(text)){
  const title=reminderTitle(text).slice(0,240);
  const when=parseReminderMoment(text,now);
  if(title.length<3)return {kind:'ask_reminder_time',title:'your task'};
  return when
   ?{kind:'remind_task',title,processNo:extractProcessNumber(title),at:when.toISOString()}
   :{kind:'ask_reminder_time',title};
 }
 const audit=text.match(/^(?:audit|analy[sz]e|review|check\s+completeness\s+(?:of\s+)?)\s*(?:my\s+)?process\s+(\d{5,9})\s*[.!]?$/i);
 if(audit&&validProcess(audit[1]))return {kind:'cloud_audit',processNo:audit[1]};
 const pdf=text.match(/^(?:extract|scan|read)\s+(?:(?:pdf|documents?|invoice(?:\s+pdf)?|pdf\s+details?)\s+)?(?:for\s+|from\s+|of\s+)?process\s+(\d{5,9})\s*[.!]?$/i);
 if(pdf&&validProcess(pdf[1]))return {kind:'cloud_extract',processNo:pdf[1]};
 if(/^(?:show|list|check)\s+(?:my\s+)?(?:cloud\s+jobs|cloud\s+automations?|background\s+jobs)\s*[.!]?$/i.test(text))return {kind:'cloud_list'};
 const move=text.match(/^(?:please\s+)?(?:move|send|transfer)\s+process\s+(\d{5,9})\s+to\s+(email(?:\s+to\s+client)?|dispatch\s+tracking)\s*[.!]?$/i);
 if(move&&validProcess(move[1]))return {kind:'move_process',processNo:move[1],stage:/email/i.test(move[2])?'Email to Client':'Dispatch Tracking'};
 const process=text.match(/\b(?:process|prc|process\s*no\.?)\s*(?:number|no\.?|#|:|-)?\s*(\d{5,9})\b/i);
 if(process&&validProcess(process[1])&&/^(?:find|check|show|locate|status|what|where|open|lookup|search)\b/i.test(text))return {kind:'find_process',processNo:process[1]};
 if(/(?:status|summary|summarize|overview|how many)\b/i.test(low)&&/(?:records|processes|operations|dispatch|orders|workspace)/.test(low))return {kind:'summarize'};
 if(/^(?:list|show|find)\s+(?:my\s+)?(?:processes|records)\b/i.test(text))return {kind:'summarize'};
 return {kind:'ai_chat',question:text};
}
export function formatLocalDue(iso:string):string{
 return new Date(iso).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'});
}

import {useMemo,useState} from 'react';
import {Upload,FileSpreadsheet,Search,FileText,Clock3,AlertCircle,ExternalLink,CheckCircle2} from 'lucide-react';
import {cloud} from './cloud';
import {extractLRs,matchLRs} from './lrReader';
import {downloadLRWorkbook} from './excelReport';

export default function ExcelLRWorkspace({records}:{records:any[]}){
 const [file,setFile]=useState<File|null>(null);
 const [manual,setManual]=useState('');
 const [candidates,setCandidates]=useState<string[]>([]);
 const [message,setMessage]=useState('Choose a courier PDF, or enter known LR numbers.');
 const [busy,setBusy]=useState(false);
 const [history,setHistory]=useState<{action:string;detail:string;status:string}[]>([]);
 const all=useMemo(()=>[...new Set([...candidates,...manual.split(/[,\n;]+/).map(x=>x.trim()).filter(Boolean)])],[candidates,manual]);
 const matches=useMemo(()=>matchLRs(all,records),[all,records]);
 const matched=matches.filter(x=>x.status==='matched').length;
 const unresolved=matches.filter(x=>x.status!=='matched').length;
 function log(action:string,detail:string,status='Info'){setMessage(detail);setHistory(x=>[{action,detail,status},...x].slice(0,14))}
 async function scan(){
  if(!file){log('Read LR','Upload courier PDF first, or enter LR numbers manually.','Review');return}
  setBusy(true);log('Extract LR','Reading courier document. No processes are updated automatically.','Running');
  try{
   const result=await cloud.extractLRs(file);
   setCandidates(result.candidates);
   log('Extract LR',result.candidates.length?result.candidates.length+' distinct LR numbers found ('+result.method+'). Verify all matches.':'No labelled LR found. Add numbers manually or improve the PDF scan.',result.candidates.length?'Review':'Missing');
  }catch(e:any){log('Read LR',e?.message||'OCR failed. Try a clearer PDF.','Failed')}
  finally{setBusy(false)}
 }
 async function exportExcel(){
  setBusy(true);
  try{await downloadLRWorkbook(matches,records,file?.name||'Manual LR list');log('Generate Excel','Downloaded PJS LR Review workbook with Summary, LR Review and Process Register.','Complete')}
  catch(e:any){log('Generate Excel','Excel generation failed: '+(e?.message||'Please try again.'),'Failed')}
  finally{setBusy(false)}
 }
 return <section className='el-workspace'>
  <div className='el-card'>
   <div className='el-title'><h2>Courier Bill & LR Finder</h2><p>Review LR numbers and export a working Excel report. This does not submit anything to carriers.</p></div>
   <div className='el-actions'>
    <label className='el-upload'><Upload size={19}/> Upload Courier PDF<input type='file' accept='.pdf,.png,.jpg,.jpeg' onChange={e=>{const f=e.target.files?.[0]||null;setFile(f);setCandidates([]);if(f)log('File selected',f.name,'Selected');e.target.value=''}}/></label>
    <button disabled={busy||!file} onClick={()=>void scan()}><Search size={19}/>{busy?'Reading…':'Extract LRs'}</button>
    <button disabled={busy||!matches.length} onClick={()=>void exportExcel()}><FileSpreadsheet size={19}/> Generate Excel</button>
   </div>
   {file&&<div className='el-file'><FileText size={17}/><div><b>{file.name}</b><small>{(file.size/1024).toFixed(1)} KB · Local OCR extraction</small></div></div>}
   <label className='ux-field' style={{display:'block',padding:'16px 18px'}}>Additional LR numbers (one per line, optional)
    <textarea rows={3} value={manual} onChange={e=>setManual(e.target.value)} placeholder={'LR-12345\nLR-67890'} style={{display:'block',width:'100%',marginTop:8,border:'1px solid #dbe5f2',borderRadius:9,padding:12}}/>
   </label>
  </div>
  <div className='el-card el-status'>
   <div className='el-title'><h2>Match review</h2><p>{matched} exact match(es) · {unresolved} unmatched/ambiguous. No automatic process reassignment.</p></div>
   <div className='el-state'><Clock3 size={22}/><div><b>{message}</b><span>{matches.length} LR number(s) under review</span></div><strong>{busy?'Working':'Ready'}</strong></div>
   {matches.map(x=><div className='el-event' key={x.normalized}>
    {x.status==='matched'?<CheckCircle2 size={17} color='#198963'/>:<AlertCircle size={17} color='#bc723d'/>}
    <b>{x.lr}</b><span>{x.status==='matched'?'Process '+x.matches[0].process+' · '+x.matches[0].party:x.status==='ambiguous'?'Multiple processes use this LR — review manually':'No matching cloud process'}</span>
    {x.status==='matched'&&(x.matches[0].documents||[]).filter((d:any)=>d.kind==='lrDoc').map((d:any)=><button key={d.id} onClick={()=>void cloud.open(x.matches[0].id,d.id)}><ExternalLink size={14}/> LR PDF</button>)}
   </div>)}
   <div className='el-history'><h3>Recent actions</h3>{history.length?history.map((h,i)=><div className='el-event' key={i}><AlertCircle size={15}/><b>{h.action}</b><span>{h.detail}</span><em>{h.status}</em></div>):<p>No processing started yet.</p>}</div>
  </div>
 </section>;
}

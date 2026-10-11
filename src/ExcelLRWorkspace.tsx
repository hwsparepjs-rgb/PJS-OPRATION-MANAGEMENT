import {useMemo,useState,type ChangeEvent} from 'react';
import {
 Activity,AlertCircle,ArrowRight,BookOpen,Check,CheckCircle2,ChevronRight,
 ClipboardList,Download,FileCheck2,FileSpreadsheet,FileText,FileUp,Info,
 LoaderCircle,MapPin,Plus,RefreshCw,Search,ShieldCheck,Trash2,Truck,
 UploadCloud,Wallet,Warehouse,X
} from 'lucide-react';
import {cloud} from './cloud';
import {matchLRs,normalizeLR,type LRMatch} from './lrReader';
import {downloadLRWorkbook} from './excelReport';
import './transport-reconciliation.css';

type Partner='tci'|'vexpress'|'maruti'|'bhuvan';
type Bill={id:string;partner:Exclude<Partner,'bhuvan'>;file:File;status:'selected'|'scanning'|'extracted'|'failed';lrs:string[];method:string;error?:string};
type TempoTrip={id:string;process:string;date:string;notes:string;amount:string};
type Grouped={normalized:string;lr:string;partners:Partner[];sources:string[];occurrences:number;result:LRMatch};
type Log={id:string;title:string;detail:string;status:'info'|'ok'|'warn'|'error'};
const partners=[
 {id:'tci' as const,title:'TCI',subtitle:'Transport bill PDFs',label:'Carrier 01',initials:'TCI',tone:'blue'},
 {id:'vexpress' as const,title:'V Express',subtitle:'Transport bill PDFs',label:'Carrier 02',initials:'VE',tone:'cyan'},
 {id:'maruti' as const,title:'Shree Maruti / Aram',subtitle:'Transport bill PDFs',label:'Carrier 03',initials:'SM',tone:'purple'},
 {id:'bhuvan' as const,title:'Bhuvan Bhai',subtitle:'Local tempo partner',label:'Local transport',initials:'BB',tone:'amber'}
];
const partnerName=(key:Partner)=>partners.find(p=>p.id===key)?.title||key;
const initialManual:{tci:string;vexpress:string;maruti:string}={tci:'',vexpress:'',maruti:''};
const fileOkay=(f:File)=>(
 (f.type==='application/pdf'||f.type.startsWith('image/')||/\.(pdf|png|jpe?g|webp)$/i.test(f.name))
 &&f.size<=5*1024*1024 &&f.size>0
);
const manualLRs=(text:string)=>text.split(/[;,\n]+/).map(v=>v.trim()).filter(v=>normalizeLR(v).length>=5);

export default function ExcelLRWorkspace({records}:{records:any[]}){
 const [active,setActive]=useState<Partner>('tci');
 const [bills,setBills]=useState<Bill[]>([]);
 const [manual,setManual]=useState(initialManual);
 const [localTrips,setLocalTrips]=useState<TempoTrip[]>([]);
 const [tempoForm,setTempoForm]=useState({process:'',date:'',notes:'',amount:''});
 const [logs,setLogs]=useState<Log[]>([]);
 const [busy,setBusy]=useState(false);
 const [status,setStatus]=useState('');
 const [message,setMessage]=useState('');
 const [query,setQuery]=useState('');
 const [filter,setFilter]=useState<'all'|'matched'|'unmatched'|'ambiguous'>('all');
 const [showGuide,setShowGuide]=useState(false);
 const [localFormOpen,setLocalFormOpen]=useState(false);

 function addLog(title:string,detail:string,level:Log['status']='info'){
  setLogs(old=>[{id:crypto.randomUUID(),title,detail,status:level},...old].slice(0,12));
  setMessage(detail);
 }
 const filesByPartner=useMemo(()=>Object.fromEntries(partners.map(p=>[p.id,bills.filter(b=>b.partner===p.id)])) as Record<Partner,Bill[]>,[bills]);
 const grouped=useMemo(()=>{
  const byLR=new Map<string,{normalized:string;lr:string;partners:Set<Partner>;sources:Set<string>;occurrences:number}>();
  function add(lr:string,partner:Partner,source:string){
   const normalized=normalizeLR(lr);
   if(normalized.length<5)return;
   const previous=byLR.get(normalized);
   if(previous){previous.occurrences+=1;previous.partners.add(partner);previous.sources.add(source)}
   else byLR.set(normalized,{normalized,lr:lr.trim(),partners:new Set([partner]),sources:new Set([source]),occurrences:1});
  }
  for(const bill of bills.filter(b=>b.status==='extracted'))
   for(const lr of bill.lrs)add(lr,bill.partner,bill.file.name);
  for(const key of ['tci','vexpress','maruti'] as const)
   for(const lr of manualLRs(manual[key]))add(lr,key,'Manually entered');
  const matches=matchLRs([...byLR.values()].map(v=>v.lr),records);
  const lookUp=new Map(matches.map(v=>[v.normalized,v]));
  return [...byLR.values()].map(v=>({
   normalized:v.normalized,lr:v.lr,partners:[...v.partners],sources:[...v.sources],
   occurrences:v.occurrences,
   result:lookUp.get(v.normalized)!
  } as Grouped));
 },[bills,manual,records]);
 const rows=useMemo(()=>grouped.filter(g=>{
  const term=query.toLowerCase().trim();
  const r=g.result.matches[0];
  return (filter==='all'||g.result.status===filter)
    &&(!term||[g.lr,...g.partners.map(partnerName),...g.sources,r?.process,r?.party,r?.so]
      .some(x=>String(x||'').toLowerCase().includes(term)));
 }),[grouped,query,filter]);
 const matched=grouped.filter(x=>x.result.status==='matched').length;
 const needsReview=grouped.length-matched;
 const duplicates=grouped.filter(x=>x.occurrences>1).length;
 const localMatched=localTrips.filter(t=>records.some(r=>String(r.process)===t.process)).length;
 const uploaded=bills.length;
 const activeBills=active==='bhuvan'?[]:filesByPartner[active];
 const pendingScans=bills.filter(b=>b.status!=='extracted').length;
 const anyExtracted=bills.some(b=>b.status==='extracted');

 function chooseFiles(partner:Exclude<Partner,'bhuvan'>,e:ChangeEvent<HTMLInputElement>){
  const chosen=Array.from(e.target.files||[]);
  e.target.value='';
  if(!chosen.length)return;
  if(chosen.length+bills.length>40){
   addLog('Files limit','Work with up to 40 uploaded bills in one review session.','warn');return;
  }
  const rejected=chosen.filter(f=>!fileOkay(f));
  if(rejected.length){
   addLog('Bill validation',rejected.length+' file(s) were skipped. Use PDF/JPG/PNG/WebP, maximum 5 MB per bill.','warn');
  }
  const added:Bill[]=chosen.filter(fileOkay).map(file=>({
   id:crypto.randomUUID(),partner,file,status:'selected',lrs:[],method:''
  }));
  if(!added.length)return;
  setBills(old=>[...old,...added]);
  setActive(partner);
  addLog('Bills selected',added.length+' '+partnerName(partner)+' bill(s) ready to extract. Files remain on this device.','ok');
 }
 async function extractBills(){
  const queued=bills.filter(b=>b.status!=='extracted');
  if(!queued.length){
   addLog('Extraction','All selected files have been checked. Add more PDFs or review your matches.','info');return;
  }
  setBusy(true);
  for(let i=0;i<queued.length;i++){
   const bill=queued[i];
   setStatus('Reading '+(i+1)+' of '+queued.length+': '+bill.file.name);
   setBills(old=>old.map(b=>b.id===bill.id?{...b,status:'scanning'}:b));
   try{
    const result=await cloud.extractLRs(bill.file);
    setBills(old=>old.map(b=>b.id===bill.id?{
     ...b,status:'extracted',lrs:result.candidates||[],method:result.method||'Document read',error:undefined
    }:b));
    addLog('Bill scanned',partnerName(bill.partner)+' · '+bill.file.name+' · '+result.candidates.length+' LR number(s) extracted. Review each match.',result.candidates.length?'ok':'warn');
   }catch(error:any){
    const detail=String(error?.message||'Unable to read this bill.');
    setBills(old=>old.map(b=>b.id===bill.id?{...b,status:'failed',error:detail}:b));
    addLog('Bill needs review',bill.file.name+' · '+detail,'error');
   }
  }
  setBusy(false);setStatus('');
 }
 function removeBill(id:string){
  const target=bills.find(b=>b.id===id);
  setBills(old=>old.filter(b=>b.id!==id));
  if(target)addLog('Bill removed',target.file.name+' removed from this review session. No cloud records changed.','info');
 }
 function addTempoTrip(){
  const process=tempoForm.process.trim();
  if(!/^[0-9]{5,9}$/.test(process)){
   addLog('Local trip','Enter a valid 5–9 digit Process No. so the trip can be checked against sales records.','warn');return;
  }
  if(!tempoForm.date){addLog('Local trip','Select the local tempo trip date.','warn');return}
  if(tempoForm.amount&&(!Number.isFinite(Number(tempoForm.amount))||Number(tempoForm.amount)<0)){
   addLog('Local trip','Enter a valid amount or leave it blank for later review.','warn');return;
  }
  setLocalTrips(old=>[...old,{
   id:crypto.randomUUID(),process,date:tempoForm.date,
   notes:tempoForm.notes.trim().slice(0,240),amount:tempoForm.amount.trim()
  }]);
  setTempoForm({process:'',date:'',notes:'',amount:''});
  setLocalFormOpen(false);
  addLog('Local tempo trip','Bhuvan Bhai trip added to this working session for Process '+process+'. Review its sales match.','ok');
 }
 async function exportReview(){
  if(!grouped.length){addLog('Excel preview','Extract or enter LR numbers before downloading a review workbook.','warn');return}
  setBusy(true);
  try{
   const sources=Object.fromEntries(grouped.map(g=>[
    g.normalized,g.partners.map(partnerName).join(' / ')+' · '+g.sources.join('; ')
   ]));
   await downloadLRWorkbook(grouped.map(g=>g.result),records,'Transport bill LR review — draft',sources);
   addLog('Review workbook downloaded','Draft LR report downloaded with bill sources and sales-process matches. This is not your final transport billing template, and local tempo trip amounts are not included.','ok');
  }catch(e:any){addLog('Excel preview','Could not generate review workbook: '+(e?.message||'Please try again.'),'error')}
  finally{setBusy(false)}
 }
 const stages=[
  {num:'01',title:'Collect bills',desc:'3 PDF partners + local tempo'},
  {num:'02',title:'Extract tracking',desc:'Find LR / docket references'},
  {num:'03',title:'Match sales',desc:'Link to OMS Process No.'},
  {num:'04',title:'Review differences',desc:'Resolve missing / duplicate rows'},
  {num:'05',title:'Prepare Excel',desc:'Your format, after you share it'}
 ];
 return <section className='tr-workspace'>
  <div className='tr-hero'>
   <div className='tr-hero-top'>
    <div>
     <span className='tr-kicker'>BILLING OPERATIONS <span className='tr-dot'/> FOUR TRANSPORT PARTNERS</span>
     <h1>Transport Bill Reconciliation</h1>
     <p>Collect courier bills, read LR / tracking references and reconcile them with PJS sales processes. Prepare a verified working register before creating your final Excel report.</p>
    </div>
    <div className='tr-hero-action'>
     <button type='button' className='tr-light-button' onClick={()=>setShowGuide(x=>!x)}><BookOpen size={15}/> {showGuide?'Hide plan':'View workflow'}</button>
     <button type='button' className='tr-primary-button' disabled={busy||!grouped.length} onClick={()=>void exportReview()}><Download size={16}/> Download LR review</button>
    </div>
   </div>
   <div className='tr-steps'>{stages.map((step,i)=><div className={'tr-step '+(i===4?'later':'')} key={step.num}>
    <span>{step.num}</span><div><strong>{step.title}</strong><small>{step.desc}</small></div>{i<4&&<ChevronRight size={17}/>}
   </div>)}</div>
  </div>
  {showGuide&&<div className='tr-guide'>
   <div><ShieldCheck size={20}/><strong>Proposed matching rules</strong></div>
   <p>Each PDF is attributed to its transport partner. LR numbers are extracted for review and matched exactly with the LR stored in your PJS processes. Missing or duplicate numbers stay in the exception list. The Bhuvan Bhai section records local trips by Process No. without inventing LR numbers.</p>
   <p>When you share your real sales data and required Excel template, we can add sales-sheet import, bill amounts, rate checking, invoice-wise reconciliation and export into precisely those columns. No DataDoc/carrier actions are performed here.</p>
  </div>}
  <div className='tr-summary'>
   <div><span className='tr-summary-icon blue'><FileText size={19}/></span><div><strong>{uploaded}</strong><small>Bill files selected</small></div></div>
   <div><span className='tr-summary-icon cyan'><Search size={19}/></span><div><strong>{grouped.length}</strong><small>Unique LR references</small></div></div>
   <div><span className='tr-summary-icon green'><CheckCircle2 size={19}/></span><div><strong>{matched}</strong><small>Matched to PJS</small></div></div>
   <div><span className='tr-summary-icon amber'><AlertCircle size={19}/></span><div><strong>{needsReview}</strong><small>LRs needing review</small></div></div>
  </div>
  <div className='tr-section-intro'>
   <div><span className='tr-section-label'>01 — BILL SOURCES</span><h2>Select your transport partner</h2><p>PDF-based transporters are separate from your local tempo entries.</p></div>
   <span className='tr-session-badge'><Info size={13}/> Working review · not saved to cloud</span>
  </div>
  <div className='tr-partners'>
   {partners.map(p=>{
    const count=p.id==='bhuvan'?localTrips.length:filesByPartner[p.id].length;
    const extracted=p.id==='bhuvan'?localMatched:filesByPartner[p.id].filter(x=>x.status==='extracted').length;
    return <button type='button' key={p.id} className={'tr-partner '+(active===p.id?'active ':'')+p.tone} onClick={()=>setActive(p.id)}>
     <div className='tr-partner-top'><span className={'tr-partner-icon '+p.tone}>{p.id==='bhuvan'?<Warehouse size={23}/>:<Truck size={23}/>}</span><span className='tr-partner-check'>{active===p.id?<Check size={14}/>:<ArrowRight size={14}/>}</span></div>
     <span className='tr-partner-tag'>{p.label}</span><strong>{p.title}</strong><small>{p.subtitle}</small>
     <span className='tr-partner-bottom'>{count} {p.id==='bhuvan'?'trips':count===1?'bill':'bills'} added <span>·</span> {extracted} {p.id==='bhuvan'?'linked':'read'}</span>
    </button>
   })}
  </div>
  <div className='tr-collection'>
   {active!=='bhuvan'?<>
    <div className='tr-collection-head'>
     <div><span className='tr-section-label'>PDF BILL COLLECTION</span><h2>{partnerName(active)} <span>· Invoice & LR review</span></h2><p>Upload one or more bills from this partner. Each file stays linked to the correct transporter and can be scanned separately.</p></div>
     <label className='tr-upload-action'><FileUp size={17}/> Add PDF bills
      <input type='file' accept='.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp' multiple disabled={busy} onChange={e=>chooseFiles(active,e)}/>
     </label>
    </div>
    {!activeBills.length?<label className='tr-dropzone'>
     <span><UploadCloud size={29}/></span><strong>Choose {partnerName(active)} bills</strong>
     <small>PDF, scanned PDF or photo · Maximum 5 MB per file</small>
     <em>Browse files</em>
     <input type='file' accept='.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp' multiple disabled={busy} onChange={e=>chooseFiles(active,e)}/>
    </label>:<div className='tr-file-list'>{activeBills.map(b=><div className='tr-file-row' key={b.id}>
     <span className='tr-file-icon'><FileText size={19}/></span>
     <div><strong>{b.file.name}</strong><small>{(b.file.size/1024).toFixed(0)} KB · {b.status==='extracted'?b.lrs.length+' LR(s) found · '+b.method:b.status==='failed'?'Read failed · '+(b.error||'Retry'):b.status==='scanning'?'Reading…':'Ready to scan'}</small></div>
     <span className={'tr-file-state '+b.status}>{b.status==='extracted'?'Reviewed':b.status==='failed'?'Needs review':b.status==='scanning'?'Reading':'Not scanned'}</span>
     <button aria-label={'Remove '+b.file.name} title='Remove bill' disabled={busy} onClick={()=>removeBill(b.id)}><X size={16}/></button>
    </div>)}</div>}
    <div className='tr-collection-bottom'>
     <label className='tr-manual-label'>Optional: known LR numbers for {partnerName(active)}
      <textarea rows={2} placeholder={'Paste LR numbers, one per line\n(used when a bill cannot be read)'} value={manual[active]} onChange={e=>setManual(old=>({...old,[active]:e.target.value}))}/>
     </label>
     <button type='button' className='tr-scan-button' disabled={busy||!pendingScans} onClick={()=>void extractBills()}>
      {busy?<LoaderCircle className='tr-spin' size={17}/>:<Search size={17}/>}
      {busy?'Reading files…':'Extract LR / tracking numbers'}
     </button>
    </div>
   </>:<>
    <div className='tr-collection-head'>
     <div><span className='tr-section-label'>LOCAL TEMPO / MANUAL BILLING</span><h2>Bhuvan Bhai <span>· Local transport</span></h2><p>Use manual trip entries because this partner does not follow the three PDF-bill workflows. We can map his actual bill and rates after you share them.</p></div>
     <button type='button' className='tr-upload-action' onClick={()=>setLocalFormOpen(v=>!v)}><Plus size={17}/> Add local trip</button>
    </div>
    <div className='tr-tempo-note'><MapPin size={18}/><span>A local trip can be tied to an existing <strong>Process No.</strong> without requiring a courier tracking LR. These entries are a session-only preview until permanent billing rules are defined.</span></div>
    {localFormOpen&&<div className='tr-tempo-form'>
     <label>Process No. <input inputMode='numeric' placeholder='e.g. 292168' maxLength={9} value={tempoForm.process} onChange={e=>setTempoForm(old=>({...old,process:e.target.value.replace(/[^\d]/g,'')}))}/></label>
     <label>Trip date <input type='date' value={tempoForm.date} onChange={e=>setTempoForm(old=>({...old,date:e.target.value}))}/></label>
     <label>Bill amount (optional) <input inputMode='decimal' placeholder='₹ — enter later if unknown' value={tempoForm.amount} onChange={e=>setTempoForm(old=>({...old,amount:e.target.value.replace(/[^\d.]/g,'')}))}/></label>
     <label className='tr-tempo-note-field'>Trip notes (optional) <input placeholder='Vehicle, delivery location or reference' maxLength={240} value={tempoForm.notes} onChange={e=>setTempoForm(old=>({...old,notes:e.target.value}))}/></label>
     <div className='tr-tempo-form-actions'><button className='tr-primary-button' onClick={addTempoTrip}><Check size={15}/> Add trip to review</button><button className='tr-light-button' onClick={()=>setLocalFormOpen(false)}>Cancel</button></div>
    </div>}
    {!localTrips.length?<div className='tr-local-empty'><Warehouse size={27}/><strong>No local tempo trips added yet</strong><p>Click Add local trip to draft entries and match them with your sales Process Nos.</p></div>:<div className='tr-tempo-list'>{localTrips.map(t=>{
     const record=records.find(r=>String(r.process)===t.process);
     return <div className='tr-tempo-row' key={t.id}>
      <span><Truck size={17}/></span><div><strong>Process {t.process}</strong><small>{t.date} · {t.notes||'Local tempo delivery'} {t.amount?' · ₹'+t.amount:''}</small></div>
      <span className={'tr-bill-match '+(record?'matched':'unmatched')}>{record?'PJS linked':'Needs PJS match'}</span>
      <button aria-label={'Remove local trip '+t.process} onClick={()=>setLocalTrips(old=>old.filter(x=>x.id!==t.id))}><Trash2 size={16}/></button>
     </div>;
    })}</div>}
   </>}
  </div>
  <div className='tr-reconcile-heading'>
   <div><span className='tr-section-label'>02 — SALES RECONCILIATION</span><h2>Match bills with PJS records and sales data</h2><p>Currently connected: <strong>{records.length} PJS process record(s)</strong>. External Sales Excel will be matched after you share its column format.</p></div>
   <div className='tr-data-source'><ShieldCheck size={15}/><span>PJS Data Store connected</span></div>
  </div>
  <div className='tr-data-inputs'>
   <div><span className='tr-input-icon'><ShieldCheck size={19}/></span><div><strong>PJS process register</strong><small>{records.length} cloud process record(s) available for exact LR matching</small></div><span className='tr-input-state connected'>Connected</span></div>
   <div><span className='tr-input-icon later'><FileSpreadsheet size={19}/></span><div><strong>External sales workbook</strong><small>Column mapping will follow your sales sample and Excel format</small></div><span className='tr-input-state later'>Format pending</span></div>
  </div>
  <div className='tr-results'>
   <div className='tr-result-toolbar'>
    <div className='tr-tabs'>{(['all','matched','unmatched','ambiguous'] as const).map(t=><button key={t} className={filter===t?'active':''} onClick={()=>setFilter(t)}>{t==='all'?'All LRs':t==='matched'?'Matched':t==='unmatched'?'Not found':'Duplicates in OMS'} <span>{t==='all'?grouped.length:grouped.filter(g=>g.result.status===t).length}</span></button>)}</div>
    <label className='tr-search'><Search size={15}/><input placeholder='Search LR, process, bill, partner…' value={query} onChange={e=>setQuery(e.target.value)}/></label>
   </div>
   <div className='tr-tablewrap'><table><thead><tr><th>LR / Tracking No.</th><th>Transport partner</th><th>Source bill</th><th>Sales process / party</th><th>Match result</th></tr></thead><tbody>
    {rows.length?rows.map(item=><tr key={item.normalized}>
     <td><strong>{item.lr}</strong>{item.occurrences>1&&<small className='tr-duplicate'>{item.occurrences} occurrences · check billing duplicates</small>}</td>
     <td>{item.partners.map(p=><span className='tr-partner-pill' key={p}>{partnerName(p)}</span>)}</td>
     <td><small>{item.sources.join(', ')}</small></td>
     <td>{item.result.status==='matched'?<><strong>Process {item.result.matches[0].process}</strong><small>{item.result.matches[0].party||'—'} · SO {item.result.matches[0].so||'—'}</small></>:item.result.status==='ambiguous'?<small>Several processes share this LR</small>:<small>No exact LR in current PJS records</small>}</td>
     <td><span className={'tr-bill-match '+item.result.status}>{item.result.status==='matched'?<Check size={13}/>:<AlertCircle size={13}/>} {item.result.status==='matched'?'Matched':item.result.status==='ambiguous'?'Ambiguous':'Review'}</span></td>
    </tr>):<tr><td className='tr-table-empty' colSpan={5}><FileCheck2 size={24}/><strong>{grouped.length?'No LR rows match your filters':'No LR numbers extracted yet'}</strong><span>{grouped.length?'Change the filter to see other rows.':'Upload PDF bills under a carrier, click Extract LR numbers, or enter an LR manually.'}</span></td></tr>}
   </tbody></table></div>
   <div className='tr-results-bottom'><span><Info size={14}/> Exact LR matching only. Unmatched and ambiguous records are never assigned automatically.</span>{duplicates>0&&<strong>{duplicates} possible duplicate billing reference(s)</strong>}</div>
  </div>
  <div className='tr-bottom-grid'>
   <div className='tr-final-excel'>
    <span className='tr-section-label'>03 — REPORT PREPARATION</span><h2><FileSpreadsheet size={21}/> Excel format & billing report</h2>
    <p>The real report will combine your supplied sales data, verified transport bills and approved local tempo trips into <strong>your Excel columns</strong>.</p>
    <div className='tr-template-state'><FileSpreadsheet size={24}/><div><strong>Final Excel template: awaiting your format</strong><span>No sheet names, billing rates, or amount formulas have been assumed yet.</span></div></div>
    <button className='tr-primary-button' disabled={busy||!grouped.length} onClick={()=>void exportReview()}><Download size={16}/> Download draft LR review</button>
    <small className='tr-export-note'>Current draft workbook covers PDF/manual courier LR matching. Local tempo trip details are not yet included; final Excel generation will be implemented when you share the format.</small>
   </div>
   <div className='tr-activity'>
    <span className='tr-section-label'>REVIEW ACTIVITY</span><h2><Activity size={19}/> Session status</h2>
    {busy&&<div className='tr-work-status'><LoaderCircle className='tr-spin' size={17}/><span>{status||'Processing transport bills…'}</span></div>}
    {message&&<div className='tr-message'><Info size={16}/><span>{message}</span></div>}
    {logs.length?logs.slice(0,5).map(l=><div className='tr-log' key={l.id}><span className={'tr-log-dot '+l.status}/><div><strong>{l.title}</strong><small>{l.detail}</small></div></div>):<div className='tr-empty-log'><ClipboardList size={25}/><p>No review activity yet. Start by selecting a transport partner.</p></div>}
   </div>
  </div>
 </section>;
}

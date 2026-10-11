import type {LRMatch} from './lrReader';
const asText=(value:any)=>{
 const s=String(value??'');
 return /^[\t\r\n ]*[=+\-@]/.test(s)?"'"+s:s;
};
const headers=['LR / Docket','Match Status','Process No.','Party Name','SO No.','Transporter','Invoice No.','Process Stage','Source Document'];
export async function buildLRWorkbook(entries:LRMatch[],records:any[],sourceName:string,sourceByLR:Record<string,string>={}){
 const ExcelJS=(await import('exceljs')).default;
 const workbook=new ExcelJS.Workbook();
 workbook.creator='PJS Operations';
 workbook.created=new Date();
 const summary=workbook.addWorksheet('Summary');
 summary.columns=[{width:33},{width:25},{width:32}];
 summary.addRow(['PJS Operations — LR Processing Report']);
 summary.mergeCells('A1:C1');
 summary.getCell('A1').font={size:17,bold:true,color:{argb:'FFFFFFFF'}};
 summary.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1D3D67'}};
 summary.getRow(1).height=33;
 summary.addRow(['Generated (IST)',new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})]);
 summary.addRow(['Source file',asText(sourceName)||'Manual LR list']);
 summary.addRow(['LR numbers reviewed',entries.length]);
 summary.addRow(['Exact matches',entries.filter(x=>x.status==='matched').length]);
 summary.addRow(['Unmatched',entries.filter(x=>x.status==='unmatched').length]);
 summary.addRow(['Ambiguous',entries.filter(x=>x.status==='ambiguous').length]);
 summary.addRow([]);
 summary.addRow(['Review required','Unmatched and ambiguous numbers are NOT automatically assigned.']);
 summary.addRow(['Submission status','Report only; no courier or DataDoc action executed.']);
 const review=workbook.addWorksheet('LR Review');
 review.columns=[{width:25},{width:20},{width:19},{width:38},{width:21},{width:25},{width:25},{width:23},{width:35}];
 review.addRow(headers);
 for(const match of entries){
  const targets=match.matches.length?match.matches:[null];
  for(const r of targets)review.addRow([
   asText(match.lr),match.status.toUpperCase(),asText(r?.process),asText(r?.party),
   asText(r?.so),asText(r?.transporter),asText(r?.invoice),asText(r?.stage),asText(sourceByLR[match.normalized]||sourceName)
  ]);
 }
 review.views=[{state:'frozen',ySplit:1}];
 review.autoFilter={from:'A1',to:'I1'};
 const register=workbook.addWorksheet('Process Register');
 register.columns=[{width:20},{width:37},{width:22},{width:26},{width:24},{width:25},{width:24}];
 register.addRow(['Process No.','Party Name','SO No.','LR / Docket','Transporter','Invoice','Stage']);
 for(const r of records)register.addRow([asText(r.process),asText(r.party),asText(r.so),asText(r.lr),asText(r.transporter),asText(r.invoice),asText(r.stage)]);
 register.views=[{state:'frozen',ySplit:1}];
 register.autoFilter={from:'A1',to:'G1'};
 for(const sheet of [review,register]){
  const row=sheet.getRow(1);row.height=25;
  row.eachCell(cell=>{
   cell.font={bold:true,color:{argb:'FFFFFFFF'},size:11};
   cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF315EA4'}};
   cell.alignment={vertical:'middle'};
  });
  sheet.eachRow((r,index)=>{
   if(index===1)return;
   if(index%2===0)r.eachCell(c=>{c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF3F7FD'}}});
   r.alignment={vertical:'middle'};
  });
 }
 review.getColumn(2).eachCell((c,number)=>{
  if(number===1)return;
  const status=String(c.value||'');
  c.font={bold:true,color:{argb:status==='MATCHED'?'FF168054':status==='AMBIGUOUS'?'FFBB6622':'FFC34A52'}};
 });
 return workbook;
}
export async function downloadLRWorkbook(entries:LRMatch[],records:any[],sourceName:string,sourceByLR:Record<string,string>={}){
 const workbook=await buildLRWorkbook(entries,records,sourceName,sourceByLR);
 const buffer=await workbook.xlsx.writeBuffer();
 const blob=new Blob([buffer as BlobPart],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
 const url=URL.createObjectURL(blob);
 try{
  const element=document.createElement('a');element.href=url;
  element.download='PJS_LR_Review_'+new Date().toISOString().slice(0,10)+'.xlsx';
  document.body.appendChild(element);element.click();element.remove();
 }finally{window.setTimeout(()=>URL.revokeObjectURL(url),30000)}
}

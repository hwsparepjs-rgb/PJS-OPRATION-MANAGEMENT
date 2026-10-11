import assert from 'node:assert/strict';
import {buildLRWorkbook} from '../src/excelReport.ts';
import {matchLRs} from '../src/lrReader.ts';
const records=[{id:'1',process:'292184',party:'Example Test Company',so:'26270964',lr:'LR-45678',invoice:'INV-1',stage:'Tracking',transporter:'TCI'}];
const rows=matchLRs(['LR-45678','UNKNOWN-98765'],records);
const workbook=await buildLRWorkbook(rows,records,'test-courier.pdf');
assert.deepEqual(workbook.worksheets.map(w=>w.name),['Summary','LR Review','Process Register']);
assert.equal(workbook.getWorksheet('LR Review').rowCount,3);
assert.equal(workbook.getWorksheet('LR Review').getCell('B2').value,'MATCHED');
assert.equal(workbook.getWorksheet('LR Review').getCell('B3').value,'UNMATCHED');
assert.equal(workbook.getWorksheet('Process Register').getCell('A2').value,'292184');
const bytes=await workbook.xlsx.writeBuffer();
assert.ok(bytes.byteLength>2500,'Workbook should be a valid nonempty .xlsx');
const sourceAnnotated=await buildLRWorkbook(rows,records,'Transport Review Draft',{
 LR45678:'TCI · TCI_Bill_October.pdf',
 UNKNOWN98765:'V Express · VExpress_Bill_October.pdf'
});
assert.equal(sourceAnnotated.getWorksheet('LR Review').getCell('I2').value,'TCI · TCI_Bill_October.pdf');
assert.equal(sourceAnnotated.getWorksheet('LR Review').getCell('I3').value,'V Express · VExpress_Bill_October.pdf');
assert.equal(sourceAnnotated.getWorksheet('Summary').getCell('B3').value,'Transport Review Draft');
console.log('PASS: carrier and original source PDF preserved per LR in draft Excel review');
console.log('PASS: Excel workbook sheets, matches and xlsx output');

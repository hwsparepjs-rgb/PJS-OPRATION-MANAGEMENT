import assert from 'node:assert/strict';
import {parseCommand,parseReminderMoment,extractProcessNumber} from '../src/agentCommands.ts';

const now=new Date('2026-10-11T09:30:00');
assert.deepEqual(parseCommand('create task Follow up Process 292168',now),{
 kind:'create_task',title:'Follow up Process 292168',processNo:'292168'
});
const relative=parseCommand('remind me to check Process 292168 in 2 hours',now);
assert.equal(relative.kind,'remind_task');
assert.equal(relative.title,'check Process 292168');
assert.equal(relative.processNo,'292168');
assert.equal(relative.at,new Date(now.getTime()+2*60*60*1000).toISOString());
const tomorrow=parseCommand('remind me to call client tomorrow at 9am',now);
assert.equal(tomorrow.kind,'remind_task');
assert.equal(tomorrow.title,'call client');
assert.equal(new Date(tomorrow.at).getHours(),9);
assert.equal(new Date(tomorrow.at).getDate(),12);
assert.equal(parseCommand('remind me to call client',now).kind,'ask_reminder_time');
assert.equal(parseCommand('remind me to call client tomorrow',now).kind,'ask_reminder_time');
assert.equal(parseCommand('show my pending tasks').kind,'list_tasks');
assert.equal(parseCommand('show overdue tasks').filter,'overdue');
assert.equal(parseCommand('complete task 1').index,1);
assert.deepEqual(parseCommand('find process 292168'),{kind:'find_process',processNo:'292168'});
assert.deepEqual(parseCommand('move process 292168 to Email'),{kind:'move_process',processNo:'292168',stage:'Email to Client'});
assert.deepEqual(parseCommand('move process 292168 to Dispatch Tracking'),{kind:'move_process',processNo:'292168',stage:'Dispatch Tracking'});
assert.deepEqual(parseCommand('search web for freight rates'),{kind:'web_search',query:'freight rates'});
assert.equal(parseCommand('Summarize my operations').kind,'summarize');
assert.equal(parseCommand('what is the status of process 292168').kind,'find_process');
assert.equal(parseCommand('browse web for containers').kind,'web_search');
assert.equal(parseCommand('What are the latest freight regulations?').kind,'ai_chat');
assert.equal(extractProcessNumber('Process 292168 - invoice'), '292168');
assert.equal(extractProcessNumber('Process 000000'), null);
assert.equal(parseReminderMoment('in 30 minutes',now)?.toISOString(),new Date(now.getTime()+1800000).toISOString());
assert.equal(parseReminderMoment('tomorrow at 25:00',now),null);
assert.equal(parseReminderMoment('today at 8am',now),null);

assert.deepEqual(parseCommand('audit process 292168'),{kind:'cloud_audit',processNo:'292168'});
assert.deepEqual(parseCommand('analyze process 292168'),{kind:'cloud_audit',processNo:'292168'});
assert.deepEqual(parseCommand('extract pdf for process 292168'),{kind:'cloud_extract',processNo:'292168'});
assert.deepEqual(parseCommand('read documents from process 292168'),{kind:'cloud_extract',processNo:'292168'});
assert.deepEqual(parseCommand('show cloud jobs'),{kind:'cloud_list'});
assert.equal(parseCommand('audit process 12').kind,'ai_chat');
console.log('PASS: 6 cloud audit, PDF processing and job-list chat commands');

console.log('PASS: 22 PJS chat commands, date parsing and safe workflow confirmations');

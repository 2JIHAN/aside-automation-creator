import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const engineSource=fs.readFileSync(path.join(root,'engine.mjs'),'utf8');
const defaultFlow=JSON.parse(fs.readFileSync(new URL('./fixtures/flow.json',import.meta.url),'utf8'));
const initialState=defaultFlow.initialState;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'creator-engine-'));
test.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
function executable(file, content) {
  fs.writeFileSync(file, content, { mode: 0o700 });
  if (process.platform !== 'darwin') return;
  const attrs = () => execFileSync('/usr/bin/xattr', [file], { encoding: 'utf8' });
  if (attrs().includes('com.apple.quarantine')) execFileSync('/usr/bin/xattr', ['-d', 'com.apple.quarantine', file]);
  assert.ok(!attrs().includes('com.apple.quarantine'));
}

function fixture(turns) {
  const dir=fs.mkdtempSync(path.join(tmp,'case-'));
  const routine=path.join(dir,'scenario');
  const home=path.join(dir,'home');
  fs.mkdirSync(path.join(routine,'workflow/steps'),{recursive:true});
  fs.mkdirSync(path.join(home,'.local/bin'),{recursive:true});
  fs.writeFileSync(path.join(routine,'workflow/flow.json'),JSON.stringify(defaultFlow));
  fs.writeFileSync(path.join(routine,'workflow/context.md'),'Test context');
  for(const step of Object.values(defaultFlow.steps)) fs.writeFileSync(path.join(routine,step.instructionFile),'Test instruction');
  const engine=path.join(dir,'engine.mjs');
  executable(engine,engineSource);
  const calls=path.join(dir,'calls.jsonl');
  fs.writeFileSync(path.join(dir,'plan.json'),JSON.stringify({turns}));
  executable(path.join(home,'.local/bin/aside'),`#!${process.execPath}
const fs = require('fs');
const a = process.argv.slice(2);
const plan = JSON.parse(fs.readFileSync(process.env.PLAN));
fs.appendFileSync(process.env.CALLS, JSON.stringify(a) + '\\n');
if (a[0] === 'account') { if (a[1] !== 'list') process.exit(4); console.log(plan.accountList ?? (plan.wrongAccount ? 'u1 other@example.com' : '* u1 test@example.com signed in profiles: Profile 1')); process.exit(0); }
const i = fs.readFileSync(process.env.CALLS, 'utf8').trim().split('\\n').map(JSON.parse).filter(x => x[0] === 'exec' || x[1] === 'resume').length - 1;
if (a[0] === 'exec') console.error('created new session: engine_mock');
if (!Object.hasOwn(plan.turns, i)) { console.error('Unplanned CLI turn ' + i); process.exit(8); }
const value = plan.turns[i];
const evidencePath = a.at(-1).split(String.fromCharCode(96))[1].trim();
for (const [name, bytes] of Object.entries(value?.evidence ?? {})) fs.writeFileSync(require('path').join(evidencePath, name), Buffer.from(bytes, 'base64'));

if (value?.exit) process.exit(value.exit);
console.log(typeof value === 'string' ? value : [value.message, '상태: ' + value.value].filter(Boolean).join('\\n'));
`);
  const env={...process.env,HOME:home,ASIDE_CLI_PATH:path.join(home,'.local/bin/aside'),PLAN:path.join(dir,'plan.json'),CALLS:calls};
  return {dir,routine,home,engine,calls,env};
}
const lines=(text,prefix)=>text.split('\n').filter(l=>l.startsWith(prefix)).map(l=>JSON.parse(l.slice(prefix.length)));
const readCalls=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse):[];
const success=()=>[{value:'운영중'},{value:'노출'},{value:'알림완료'},{value:'정리완료'}];
function engineCase(values, change = () => {}) {
  const f = fixture(values.map(value => typeof value === 'string' ? { value } : value?.raw ?? value));
  const file = path.join(f.routine, 'workflow/flow.json');
  const flow = JSON.parse(fs.readFileSync(file));
  change(flow);
  fs.writeFileSync(file, JSON.stringify(flow));
  const out = spawnSync(process.execPath, [f.engine, 'u1', f.routine], { env: f.env, encoding: 'utf8', timeout: 10000 });
  const [run] = lines(out.stdout, 'ENGINE_RESULT=');
  assert.ok(run, out.stderr);
  return { f, out, run };
}

export { root, engineSource, fixture, lines, readCalls, initialState, success, engineCase };

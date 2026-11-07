// 가짜 CLI와 임시 HOME만 사용한다. 실제 브라우저나 트리거를 실행하지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const engine = path.join(process.env.ASIDE_AUTOMATION_CREATOR_REPO || path.join(os.homedir(), '.local/share/aside-automation-creator'), 'engine.mjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aside-creator-test-'));
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));
const initial = { 업무상태: '미확인', 알림상태: '미확인', 현재턴결과: '미확인', 학습계기: '없음', 정리상태: '미확인', 학습상태: '미실행', 알림검토결과: '미실행' };
function executable(file, content) {
  fs.writeFileSync(file, content, { mode: 0o755 });
  if (process.platform !== 'darwin') return;
  const attrs = () => execFileSync('/usr/bin/xattr', [file], { encoding: 'utf8' });
  if (attrs().includes('com.apple.quarantine')) execFileSync('/usr/bin/xattr', ['-d', 'com.apple.quarantine', file]);
  assert.ok(!attrs().includes('com.apple.quarantine'));
}
function fixture(values) {
  const dir = fs.mkdtempSync(path.join(temp, 'case-'));
  const routine = path.join(dir, 'routine');
  fs.mkdirSync(routine);
  fs.mkdirSync(path.join(routine,'maintenance'));
  for (const name of ['workflow', 'run.sh', 'maintenance/install.sh', 'maintenance/uninstall.sh']) fs.cpSync(path.join(root, name), path.join(routine, name), { recursive: true });
  for (const name of ['run.sh', 'maintenance/install.sh', 'maintenance/uninstall.sh']) {
    const file = path.join(routine, name);
    const text = fs.readFileSync(file, 'utf8').replaceAll('__TIMEZONE__', 'Asia/Seoul').replaceAll('__ACCOUNT_EMAIL__', 'test@example.invalid').replaceAll('__AUTOMATION_SLUG__', 'template-test').replaceAll('__AUTOMATION_NAME__', '테스트자동화');
    fs.writeFileSync(file, text);
  }
  const home = path.join(dir, 'home');
  const engineRepo = path.join(home, '.local/share/aside-automation-creator');
  fs.mkdirSync(engineRepo, { recursive: true });
  fs.copyFileSync(engine, path.join(engineRepo, 'engine.mjs'));
  const bin = path.join(home, '.local/bin');
  fs.mkdirSync(bin, { recursive: true });
  const calls = path.join(dir, 'calls.jsonl');
  const plan = path.join(dir, 'plan.json');
  const launches = path.join(dir, 'launches.jsonl');
  fs.writeFileSync(plan, JSON.stringify(values));
  executable(path.join(bin, 'node'), `#!/bin/sh\nexec '${process.execPath}' "$@"\n`);
  executable(path.join(bin, 'aside'), `#!${process.execPath}
const fs=require('fs');const a=process.argv.slice(2);
fs.appendFileSync(process.env.CALLS,JSON.stringify(a)+'\\n');
if(a[0]==='account'){console.log('u7 '+(process.env.WRONG_ACCOUNT?'other@example.invalid':'test@example.invalid')+' signed in');process.exit(0);}
const i=fs.readFileSync(process.env.CALLS,'utf8').trim().split('\\n').map(JSON.parse).filter(a=>a[0]==='exec'||a[1]==='resume').length-1;
if(a[0]==='exec')console.error('created new session: template_mock');
const plan=JSON.parse(fs.readFileSync(process.env.PLAN));if(!Object.hasOwn(plan,i))process.exit(8);
const value=plan[i];if(value?.exit)process.exit(value.exit);
console.log(typeof value==='string'?'상태'+': '+value:value.raw);
`);
  executable(path.join(bin, 'launchctl'), `#!${process.execPath}
const fs=require('fs');const a=process.argv.slice(2);fs.appendFileSync(process.env.LAUNCHES,JSON.stringify(a)+'\\n');
process.exit(a[0]==='print'&&!process.env.EXISTING?1:a[0]==='bootout'&&process.env.BOOTOUT_FAIL?5:0);
`);
  if (process.platform === 'darwin' && process.env.ASIDE_CLEAR_QUARANTINE) execFileSync('/bin/bash', [process.env.ASIDE_CLEAR_QUARANTINE, dir]);
  return { dir, routine, home, calls, launches, env: { ...process.env, HOME: home, ASIDE_AUTOMATION_CREATOR_REPO: engineRepo, PLAN: plan, CALLS: calls, LAUNCHES: launches } };
}
function records(file) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []; }
function execute(f) {
  const shared = path.join(f.env.ASIDE_AUTOMATION_CREATOR_REPO, 'engine.mjs');
  const before = fs.readFileSync(shared);
  const out = spawnSync(process.execPath, [path.join(f.env.ASIDE_AUTOMATION_CREATOR_REPO, 'engine.mjs'), 'u7', f.routine], { env: f.env, encoding: 'utf8', timeout: 10000 });
  assert.deepEqual(fs.readFileSync(shared), before);
  assert.equal(fs.existsSync(path.join(f.env.ASIDE_AUTOMATION_CREATOR_REPO, 'runtime')), false);
  assert.equal(fs.existsSync(path.join(f.env.ASIDE_AUTOMATION_CREATOR_REPO, 'workflow/memory.md')), false);
  const line = out.stdout.split('\n').find(s => s.startsWith('ENGINE_RESULT='));
  assert.ok(line, out.stderr);
  return { out, run: JSON.parse(line.slice('ENGINE_RESULT='.length)) };
}

export { root, engine, fixture, records, execute, initial };

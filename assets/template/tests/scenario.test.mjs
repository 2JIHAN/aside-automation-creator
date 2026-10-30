// 가짜 CLI와 임시 HOME만 사용한다. 실제 브라우저나 트리거를 실행하지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aside-creator-test-'));
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));
const initial = { 업무상태: '미확인', 알림상태: '미확인', 현재턴결과: '미확인' };
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
  for (const name of ['src', 'workflow', 'run.sh', 'install.sh', 'uninstall.sh']) fs.cpSync(path.join(root, name), path.join(routine, name), { recursive: true });
  for (const name of ['run.sh', 'install.sh', 'uninstall.sh']) {
    const file = path.join(routine, name);
    const text = fs.readFileSync(file, 'utf8').replaceAll('__TIMEZONE__', 'Asia/Seoul').replaceAll('__ACCOUNT_EMAIL__', 'test@example.invalid').replaceAll('__AUTOMATION_SLUG__', 'template-test').replaceAll('__AUTOMATION_NAME__', '테스트자동화');
    fs.writeFileSync(file, text);
  }
  const home = path.join(dir, 'home');
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
  return { dir, routine, home, calls, launches, env: { ...process.env, HOME: home, PLAN: plan, CALLS: calls, LAUNCHES: launches } };
}
function records(file) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []; }
function execute(f) {
  const out = spawnSync(process.execPath, [path.join(f.routine, 'src/engine.mjs'), 'u7'], { env: f.env, encoding: 'utf8', timeout: 10000 });
  const line = out.stdout.split('\n').find(s => s.startsWith('ENGINE_RESULT='));
  assert.ok(line, out.stderr);
  return { out, run: JSON.parse(line.slice('ENGINE_RESULT='.length)) };
}
for (const [name, values, status, state] of [
  ['정상', ['정상', '알림완료', '정리완료'], 'ok', { 업무상태: '정상', 알림상태: '알림완료' }],
  ['복구', ['예외발생', '재확인', '정상', '알림완료', '정리완료'], 'ok', { 업무상태: '정상', 알림상태: '알림완료' }],
  ['인계', ['예외발생', '해결불가', '알림완료', '정리완료'], 'handed_off', { 업무상태: '예외발생', 알림상태: '알림완료' }],
  ['알림 실패', ['정상', '알림불가', '정리완료'], 'incomplete', { 업무상태: '정상', 알림상태: '알림불가' }],
  ['정리 실패', ['정상', '알림완료', '정리불가'], 'incomplete', { 업무상태: '정상', 알림상태: '알림완료' }]
]) {
  test(name, () => {
    const f = fixture(values); const { out, run } = execute(f);
    assert.equal(out.status, 0, out.stderr); assert.equal(run.finishStatus, status);
    assert.deepEqual(run.state, { ...initial, ...state, 현재턴결과: values.at(-1) });
    assert.equal(run.turns.at(-1).finishStatus, status);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(run.runDir, 'run.json'))), run);
    for (const turn of run.turns) assert.ok(fs.statSync(path.join(run.runDir, turn.evidenceDir)).isDirectory());
    const calls = records(f.calls); assert.equal(calls.length, values.length);
    assert.ok(calls.slice(1).every(a => a[0] === 'session' && a[4] === 'template_mock'));
    assert.ok(!Object.hasOwn(run, 'returnStep'));
  });
}
test('복귀 2회 제한', () => {
  const f = fixture(['예외발생', '재확인', '예외발생', '재확인', '예외발생', '재확인', '알림완료', '정리완료']);
  const { run } = execute(f); assert.equal(run.finishStatus, 'handed_off');
  const turns = run.turns.filter(t => t.step === 'review');
  assert.deepEqual(turns.map(t => t.nextStep), ['work', 'work', 'notify']);
  assert.equal(turns.at(-1).response.value, '해결불가');assert.equal(turns.at(-1).recheckLimit.completed, 2);
});
for (const bad of [{ exit: 9 }, { raw: '설명만' }, { raw: '상태: 없는값' }]) {
  test('기술 오류: ' + JSON.stringify(bad), () => {
    const f = fixture([bad]);const { out, run } = execute(f);
    assert.equal(out.status, 1);assert.equal(run.finishStatus, 'stopped');assert.equal(run.stop.step, 'work');
    assert.deepEqual(run.state, initial);assert.equal(records(f.calls).length, 1);
  });
}
test('실행 계정 확인과 명시적 승인 전 인수 차단', () => {
  const f = fixture(['정상', '알림완료', '정리완료']);
  const invoke = (args, env = f.env) => spawnSync('/bin/sh', [path.join(f.routine, 'run.sh'), ...args], { env, encoding: 'utf8' });
  assert.equal(invoke(['--check']).status, 2);assert.equal(records(f.calls).length, 0);
  assert.equal(invoke([], { ...f.env, WRONG_ACCOUNT: '1' }).status, 1);
  fs.rmSync(f.calls);assert.equal(invoke([]).status, 0);assert.equal(records(f.calls)[0][0], 'account');
});
test('선언된 상태와 참조만 사용', () => {
  const flow = JSON.parse(fs.readFileSync(path.join(root, 'workflow/flow.json')));assert.deepEqual(flow.initialState, initial);
  for (const [id, step] of Object.entries(flow.steps)) {
    assert.ok(fs.existsSync(path.join(root, step.instructionFile)));
    if (step.stateKey) assert.ok(Object.hasOwn(initial, step.stateKey));
    for (const rule of step.next) {
      for (const key of Object.keys(rule.when)) assert.ok(Object.hasOwn(initial, key));
      assert.ok(!Object.hasOwn(rule, 'response'));
      assert.notEqual(Boolean(rule.step), Boolean(rule.finishWithStatus));
      if (rule.step === '$caller') assert.equal(id, 'review');
      else if (rule.step) assert.ok(flow.steps[rule.step]);
    }
  }
});
test('모의 설치와 재설치 및 해제는 해당 서비스만 관리', { skip: process.platform !== 'darwin' }, () => {
  const f = fixture([]);const invoke = (script, args = [], env = f.env) => spawnSync('/bin/sh', [path.join(f.routine, script), ...args], { env, encoding: 'utf8' });
  let out = invoke('install.sh', ['17']);assert.equal(out.status, 0, out.stderr);
  const plist = path.join(f.home, 'Library/LaunchAgents/io.local.routines.template-test.plist');
  const launcher = execFileSync('/usr/bin/plutil', ['-extract', 'ProgramArguments.0', 'raw', '-o', '-', plist], { encoding: 'utf8' }).trim();
  assert.ok(launcher.startsWith(path.join(f.home, 'background/테스트자동화-매시')));
  assert.ok(records(f.launches).some(a => a[0] === 'bootstrap'));assert.ok(!records(f.launches).some(a => a[0] === 'kickstart'));
  out = invoke('install.sh', ['18'], { ...f.env, EXISTING: '1' });assert.equal(out.status, 0, out.stderr);assert.ok(!fs.existsSync(launcher));
  out = invoke('uninstall.sh', [], { ...f.env, EXISTING: '1', BOOTOUT_FAIL: '1' });assert.equal(out.status, 5);assert.ok(fs.existsSync(plist));
  out = invoke('uninstall.sh', [], { ...f.env, EXISTING: '1' });assert.equal(out.status, 0, out.stderr);assert.ok(!fs.existsSync(plist));assert.ok(fs.existsSync(path.join(f.routine, 'src/engine.mjs')));
});

test('다른 서비스의 plist는 설치와 해제 모두 거부', { skip: process.platform !== 'darwin' }, () => {
  const f = fixture([]); const dest = path.join(f.home, 'Library/LaunchAgents/io.local.routines.template-test.plist');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const foreign = JSON.stringify({ Label: 'io.local.routines.template-test', WorkingDirectory: '/another-owner', ProgramArguments: ['/bin/sh'] });
  fs.writeFileSync(dest, foreign);
  for (const script of ['install.sh', 'uninstall.sh']) {
    const out = spawnSync('/bin/sh', [path.join(f.routine, script)], { env: { ...f.env, EXISTING: '1' }, encoding: 'utf8' });
    assert.equal(out.status, 1);assert.equal(fs.readFileSync(dest, 'utf8'), foreign);
    assert.ok(!records(f.launches).some(a => ['bootout', 'bootstrap'].includes(a[0])));
  }
});
test('소유 파일 없는 실행 중 서비스는 건드리지 않음', { skip: process.platform !== 'darwin' }, () => {
  const f = fixture([]);
  for (const script of ['install.sh', 'uninstall.sh']) {
    const out = spawnSync('/bin/sh', [path.join(f.routine, script)], { env: { ...f.env, EXISTING: '1' }, encoding: 'utf8' });
    assert.equal(out.status, 1);assert.ok(!records(f.launches).some(a => ['bootout', 'bootstrap'].includes(a[0])));
  }
});
test('계정 이메일 대소문자 차이는 같은 계정으로 처리', () => {
  const f = fixture(['정상', '알림완료', '정리완료']); const file = path.join(f.routine, 'run.sh');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('test@example.invalid', 'TEST@EXAMPLE.INVALID'));
  const out = spawnSync('/bin/sh', [file], { env: f.env, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr); assert.ok(records(f.calls).some(a => a[0] === 'exec'));
});

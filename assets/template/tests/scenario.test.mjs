// 가짜 CLI와 임시 HOME만 사용한다. 실제 브라우저나 트리거를 실행하지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
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
  for (const name of ['workflow', 'memory.md', 'run.sh', 'install.sh', 'uninstall.sh']) fs.cpSync(path.join(root, name), path.join(routine, name), { recursive: true });
  for (const name of ['run.sh', 'install.sh', 'uninstall.sh']) {
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
  assert.equal(fs.existsSync(path.join(f.env.ASIDE_AUTOMATION_CREATOR_REPO, 'memory.md')), false);
  const line = out.stdout.split('\n').find(s => s.startsWith('ENGINE_RESULT='));
  assert.ok(line, out.stderr);
  return { out, run: JSON.parse(line.slice('ENGINE_RESULT='.length)) };
}
const scenarios = [
  ['정상은 학습 생략', ['정상', '알림완료', '정리완료'], 'ok', { 업무상태: '정상', 알림상태: '알림완료', 정리상태: '정리완료' }],
  ['업무 복구 후 학습', ['예외발생', '재확인', '정상', '알림완료', '정리완료', '학습완료'], 'ok', { 업무상태: '정상', 알림상태: '알림완료', 학습계기: '재확인', 정리상태: '정리완료', 학습상태: '학습완료' }],
  ['인계 결과 보존', ['예외발생', '해결불가', '알림완료', '정리완료', '학습완료'], 'handed_off', { 업무상태: '예외발생', 알림상태: '알림완료', 학습계기: '해결불가', 정리상태: '정리완료', 학습상태: '학습완료' }],
  ['알림 재시도 성공', ['정상', '알림불가', '재확인', '알림완료', '정리완료', '학습완료'], 'ok', { 업무상태: '정상', 알림상태: '알림완료', 알림검토결과: '재확인', 정리상태: '정리완료', 학습상태: '학습완료' }],
  ['알림 재시도 실패는 다시 검토하지 않음', ['정상', '알림불가', '재확인', '알림불가', '정리완료', '학습완료'], 'incomplete', { 업무상태: '정상', 알림상태: '알림불가', 알림검토결과: '재확인', 정리상태: '정리완료', 학습상태: '학습완료' }],
  ['알림 해결불가', ['정상', '알림불가', '해결불가', '정리완료', '학습완료'], 'incomplete', { 업무상태: '정상', 알림상태: '알림불가', 알림검토결과: '해결불가', 정리상태: '정리완료', 학습상태: '학습완료' }],
  ['정리 실패', ['정상', '알림완료', '정리불가', '학습완료'], 'incomplete', { 업무상태: '정상', 알림상태: '알림완료', 정리상태: '정리불가', 학습상태: '학습완료' }]
];
for (const [name, values, status, state] of scenarios) {
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
    assert.equal(run.turns.filter(t => t.step === 'review-notify').length, values.includes('알림불가') ? 1 : 0);
    assert.equal(run.turns.filter(t => t.step === 'learn').length, state.학습상태 ? 1 : 0);
  });
}
for (const [name, values, status] of scenarios.filter(row => row[1].at(-1) === '학습완료')) {
  test(name + ' 중 학습불가도 원래 결과 보존', () => {
    const f = fixture([...values.slice(0, -1), '학습불가']);
    const { out, run } = execute(f);
    assert.equal(out.status, 0, out.stderr); assert.equal(run.finishStatus, status);
    assert.equal(run.state.학습상태, '학습불가');
    assert.equal(run.turns.at(-1).step, 'learn');
  });
}
test('복귀 2회 제한', () => {
  const f = fixture(['예외발생', '재확인', '예외발생', '재확인', '예외발생', '재확인', '알림완료', '정리완료', '학습완료']);
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
      if (rule.step === '$caller') assert.ok(['review', 'review-notify'].includes(id));
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
  out = invoke('uninstall.sh', [], { ...f.env, EXISTING: '1' });assert.equal(out.status, 0, out.stderr);assert.ok(!fs.existsSync(plist));assert.ok(fs.existsSync(path.join(f.env.ASIDE_AUTOMATION_CREATOR_REPO, 'engine.mjs')));
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

test('두 시나리오가 엔진 하나를 공유하고 각 폴더에만 기록', () => {
  const f = fixture(['정상', '알림완료', '정리완료', '정상', '알림완료', '정리완료']);
  const second = path.join(f.dir, 'second scenario');
  fs.cpSync(f.routine, second, { recursive: true });
  const sharedEngine = path.join(f.env.ASIDE_AUTOMATION_CREATOR_REPO, 'engine.mjs');
  const engineBefore = fs.readFileSync(sharedEngine);
  for (const routine of [f.routine, second]) {
    assert.equal(fs.existsSync(path.join(routine, 'src/engine.mjs')), false);
    const out = spawnSync('/bin/sh', [path.join(routine, 'run.sh')], { cwd: f.home, env: f.env, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    const run = JSON.parse(out.stdout.split('\n').find(line => line.startsWith('ENGINE_RESULT=')).slice('ENGINE_RESULT='.length));
    assert.equal(run.finishStatus, 'ok');
    assert.ok(run.runDir.startsWith(path.join(routine, 'runtime/runs') + path.sep));
    const calls = records(f.calls).filter(args => args[0] === 'exec' || args[1] === 'resume').slice(-3);
    assert.ok(calls[0].at(-1).includes(path.join(routine, 'workflow/context.md')));
    assert.ok(calls.every(args => args.at(-1).includes(path.join(routine, 'workflow/steps'))));
  }
  assert.deepEqual(fs.readFileSync(sharedEngine), engineBefore);
  assert.equal(fs.existsSync(path.join(f.env.ASIDE_AUTOMATION_CREATOR_REPO, 'runtime')), false);
});

test('공통 엔진이 없으면 다른 엔진으로 대체하지 않고 중단', () => {
  const f = fixture([]);
  fs.rmSync(path.join(f.env.ASIDE_AUTOMATION_CREATOR_REPO, 'engine.mjs'));
  const out = spawnSync('/bin/sh', [path.join(f.routine, 'run.sh')], { env: f.env, encoding: 'utf8' });
  assert.notEqual(out.status, 0);
  assert.ok(!records(f.calls).some(args => args[0] === 'exec' || args[1] === 'resume'));
  assert.equal(fs.existsSync(path.join(f.routine, 'runtime')), false);
});

test('시나리오 경로 없는 직접 호출은 실행 전에 거부', () => {
  const f = fixture([]);
  const out = spawnSync(process.execPath, [path.join(f.env.ASIDE_AUTOMATION_CREATOR_REPO, 'engine.mjs'), 'u7'], { env: f.env, encoding: 'utf8' });
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /scenario-folder/);
  assert.equal(records(f.calls).length, 0);
});

test('경로 설정 없이 기본 설치 위치의 공통 엔진 사용', () => {
  const f = fixture(['정상', '알림완료', '정리완료']);
  const env = { ...f.env };
  delete env.ASIDE_AUTOMATION_CREATOR_REPO;
  const out = spawnSync('/bin/sh', [path.join(f.routine, 'run.sh')], { env, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.ok(records(f.calls).some(args => args[0] === 'exec'));
});

test('예약 실행은 설치 시 지정한 공통 저장소 경로를 보존', { skip: process.platform !== 'darwin' }, () => {
  const f = fixture(['정상', '알림완료', '정리완료']);
  const custom = path.join(f.home, 'custom engine');
  fs.renameSync(f.env.ASIDE_AUTOMATION_CREATOR_REPO, custom);
  const out = spawnSync('/bin/sh', [path.join(f.routine, 'install.sh'), '17'], { env: { ...f.env, ASIDE_AUTOMATION_CREATOR_REPO: custom }, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const plist = path.join(f.home, 'Library/LaunchAgents/io.local.routines.template-test.plist');
  const config = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8' }));
  assert.equal(config.EnvironmentVariables.ASIDE_AUTOMATION_CREATOR_REPO, custom);
  const env = { ...f.env };
  delete env.ASIDE_AUTOMATION_CREATOR_REPO;
  Object.assign(env, config.EnvironmentVariables);
  const run = spawnSync('/bin/sh', [config.ProgramArguments[0]], { cwd: config.WorkingDirectory, env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(records(f.calls).some(args => args[0] === 'exec'));
});

for (const bad of [{ exit: 9 }, { raw: '설명만' }, { raw: '상태: 없는값' }]) {
  test('학습 기술 오류는 성공으로 덮지 않음: ' + JSON.stringify(bad), () => {
    const f = fixture(['예외발생', '해결불가', '알림완료', '정리완료', bad]);
    const { out, run } = execute(f);
    assert.equal(out.status, 1); assert.equal(run.finishStatus, 'stopped');
    assert.equal(run.stop.step, 'learn'); assert.equal(run.state.업무상태, '예외발생');
    assert.equal(run.state.알림상태, '알림완료'); assert.equal(run.state.정리상태, '정리완료');
    assert.equal(run.state.학습상태, '미실행'); assert.equal(records(f.calls).length, 5);
  });
}
test('일반 템플릿은 고객명과 비공개 주소를 포함하지 않음', () => {
  const files = ['memory.md', 'workflow/context.md', ...fs.readdirSync(path.join(root, 'workflow/steps')).map(name => 'workflow/steps/' + name)];
  for (const name of files) {
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    assert.doesNotMatch(text, /DOES|더즈|naver|네이버|tndgud12|seesoong|2jihan000|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, name);
  }
});
test('업무 검토와 알림 검토는 같은 지침을 공유하고 복귀 대상은 분리', () => {
  const flow = JSON.parse(fs.readFileSync(path.join(root, 'workflow/flow.json')));
  assert.equal(flow.steps.review.instructionFile, flow.steps['review-notify'].instructionFile);
  assert.equal(flow.steps.review.rememberCaller, true); assert.equal(flow.steps['review-notify'].rememberCaller, true);
  assert.equal(flow.steps.review.stateKey, '학습계기'); assert.equal(flow.steps['review-notify'].stateKey, '알림검토결과');
});

for (const cause of ['후보시험', '해결불가']) {
  test('선택된 학습계기 경로: ' + cause, () => {
    const f = fixture(['정리완료', '학습완료']);
    const file = path.join(f.routine, 'workflow/flow.json');
    const flow = JSON.parse(fs.readFileSync(file, 'utf8'));
    flow.startStep = 'close-tabs';
    Object.assign(flow.initialState, { 업무상태: '정상', 알림상태: '알림완료', 학습계기: cause });
    fs.writeFileSync(file, JSON.stringify(flow));
    const { out, run } = execute(f);
    assert.equal(out.status, 0, out.stderr); assert.equal(run.finishStatus, 'ok');
    assert.deepEqual(run.turns.map(t => t.step), ['close-tabs', 'learn']);
    assert.equal(run.state.학습계기, cause); assert.equal(run.state.학습상태, '학습완료');
    assert.equal(fs.readFileSync(path.join(f.routine, 'memory.md'), 'utf8'), fs.readFileSync(path.join(root, 'memory.md'), 'utf8'));
  });
}

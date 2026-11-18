import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { executable, fixture, lines, readCalls, initialState, success, engineCase } from './test-helpers.mjs';
import { engineSource } from './test-helpers.mjs';

for (const value of ['STEP_RESULT={broken', '설명만', '정상', { value: 'unexpected' }, { exit: 9 }]) {
  test(`기술 오류는 stopped로 종료: ${JSON.stringify(value)}`, () => {
    const f = fixture([value]);
    const out = spawnSync(process.execPath, [f.engine, 'u1', f.routine], { env: f.env, encoding: 'utf8' });
    assert.equal(out.status, 1);
    const [result] = lines(out.stdout, 'ENGINE_RESULT=');
    assert.equal(result.finishStatus, 'stopped');
    assert.deepEqual(result.state, initialState);
    assert.deepEqual(readCalls(f.calls).map(a => a[0]), ['exec'], '실패 뒤 다른 CLI 호출 없음');
  });
}
test("공통 지침 경로는 flow.contextFile 설정을 사용하고 첫 턴에만 전달", () => {
  const f = fixture(success());
  const configPath = path.join(f.routine, "workflow/flow.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const oldContext = path.join(f.routine, config.contextFile);
  config.contextFile = "workflow/custom-context.md";
  const contextPath = path.join(f.routine, config.contextFile);
  fs.renameSync(oldContext, contextPath);
  fs.writeFileSync(configPath, JSON.stringify(config));
  const out = spawnSync(process.execPath, [f.engine, "u1", f.routine], { env: f.env, encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  const calls = readCalls(f.calls).filter(a => a[0] === "exec" || a[1] === "resume");
  assert.ok(calls[0].at(-1).includes(contextPath));
  assert.ok(!calls[0].at(-1).includes(oldContext));
  assert.ok(!calls[0].at(-1).includes(fs.readFileSync(contextPath, "utf8")));
  assert.ok(calls.slice(1).every(a => !a.at(-1).includes(contextPath)));
});

for (const kind of ['불일치', '중복']) {
  test('조건 ' + kind + ' 시 임의 선택 없이 이전 상태 보존', () => {
    const f = fixture([{ value: '운영중' }]);
    const file = path.join(f.routine, 'workflow/flow.json');
    const flow = JSON.parse(fs.readFileSync(file, 'utf8'));
    const rules = flow.steps['task-a'].next;
    if (kind === '불일치') flow.steps['task-a'].next = [];
    else rules.push({ when: { 첫작업상태: '운영중' }, step: 'close-tabs' });
    fs.writeFileSync(file, JSON.stringify(flow));
    const out = spawnSync(process.execPath, [f.engine, 'u1', f.routine], { env: f.env, encoding: 'utf8' });
    const [run] = lines(out.stdout, 'ENGINE_RESULT=');
    assert.equal(out.status, 1);
    assert.equal(run.finishStatus, 'stopped');
    assert.deepEqual(run.state, initialState);
    assert.equal(readCalls(f.calls).length, 1);
    assert.ok(!Object.hasOwn(run.turns[0], 'response'));
  });
}
test('존재하지 않는 정적 목적지는 임시 상태 저장 전에 중단', () => {
  const { f, out, run } = engineCase(['운영중'], flow => {
    flow.steps['task-a'].next = [{ when: { 첫작업상태: '운영중' }, step: 'missing' }];
  });
  assert.equal(out.status, 1);
  assert.equal(run.finishStatus, 'stopped');
  assert.deepEqual(run.state, initialState);
  assert.equal(readCalls(f.calls).length, 1);
  assert.ok(!Object.hasOwn(run.turns[0], 'response'));
});

for (const malformed of ['결과: 운영중', '상태:', '상태: 운영중\n설명', '상태 : 운영중', '상태: unexpected']) {
  test('마지막 상태 줄이 잘못되면 상태 변경이나 후속 정리 없음: ' + malformed, () => {
    const f = fixture([malformed]);
    const out = spawnSync(process.execPath, [f.engine, 'u1', f.routine], { env: f.env, encoding: 'utf8' });
    const [run] = lines(out.stdout, 'ENGINE_RESULT=');
    assert.equal(out.status, 1);
    assert.equal(run.finishStatus, 'stopped');
    assert.deepEqual(run.state, initialState);
    assert.equal(readCalls(f.calls).length, 1);
    assert.ok(!Object.hasOwn(run.turns[0], 'response'));
  });
}

test('프롬프트에는 단계와 상태 메타데이터를 중복 전달하지 않고 공통 지침은 첫 턴만', () => {
  const { f, out, run } = engineCase(['운영중', '노출', '알림완료', '정리완료']);
  assert.equal(out.status, 0);
  const calls = readCalls(f.calls);
  for (const [index, turn] of run.turns.entries()) {
    const prompt = calls[index].at(-1);
    assert.ok(prompt.includes(turn.step));
    for (const label of ['현재 단계:', '현재 상태:', '이번 단계의 상태변수:']) assert.ok(!prompt.includes(label));
    assert.equal(prompt.includes(path.join(f.routine, 'workflow/context.md')), index === 0);
  }
});

for (const invalid of [{ step: 'task-c', finishWithStatus: 'ok' }, {}, { finishWithStatus: 1 }]) {
  test('잘못된 이동 또는 종료 규칙은 상태를 확정하지 않고 중단: ' + JSON.stringify(invalid), () => {
    const { f, out, run } = engineCase(['운영중'], flow => {
      flow.steps['task-a'].next = [{ when: { 첫작업상태: '운영중' }, ...invalid }];
    });
    assert.equal(out.status, 1);
    assert.equal(run.finishStatus, 'stopped');
    assert.deepEqual(run.state, initialState);
    assert.equal(readCalls(f.calls).length, 1);
    assert.ok(!Object.hasOwn(run.turns[0], 'response'));
  });
}

test('공통 엔진은 이전 암묵 상태와 응답 조건 문법을 사용하지 않음', () => {
  for (const legacy of ['previousValue', 'rule.response', 'when.value', 'when.decision']) assert.ok(!engineSource.includes(legacy));
});
test('흐름 파일 인자를 주면 그 파일로 실행하고 run.json에 기록', () => {
  const f = fixture(success());
  const flowPath = path.join(f.routine, 'workflow/flow.json');
  fs.renameSync(flowPath, path.join(f.routine, 'workflow/flow.alt.json'));
  const out = spawnSync(process.execPath, [f.engine, 'u1', f.routine, 'workflow/flow.alt.json'], { env: f.env, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const [run] = lines(out.stdout, 'ENGINE_RESULT=');
  assert.equal(run.flowFile, path.join('workflow', 'flow.alt.json'));
});
test('흐름 파일 인자를 생략하면 workflow/flow.json을 기록', () => {
  const { out, run } = engineCase(success());
  assert.equal(out.status, 0, out.stderr);
  assert.equal(run.flowFile, path.join('workflow', 'flow.json'));
});
test('시나리오 폴더 밖 흐름 파일은 CLI 호출 없이 거부', () => {
  const f = fixture(success());
  fs.copyFileSync(path.join(f.routine, 'workflow/flow.json'), path.join(f.dir, 'outside.json'));
  for (const arg of ['../outside.json', path.join(f.dir, 'outside.json')]) {
    const out = spawnSync(process.execPath, [f.engine, 'u1', f.routine, arg], { env: f.env, encoding: 'utf8' });
    assert.notEqual(out.status, 0);
    assert.match(out.stderr, /시나리오 폴더 안/);
    assert.deepEqual(readCalls(f.calls), []);
  }
});

test('첫 턴에는 결과 폴더와 공통 지침, 이후 턴에는 증거 폴더와 단계만 전달한다', () => {
  const f = fixture(success());
  const renamed = path.join(f.dir, '예약 시나리오 "테스트"');
  fs.renameSync(f.routine, renamed);
  f.routine = renamed;
  const out = spawnSync(process.execPath, [f.engine, 'u1', f.routine], { env: f.env, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const [run] = lines(out.stdout, 'ENGINE_RESULT=');
  const calls = readCalls(f.calls);
  assert.equal(calls.length, run.turns.length);
  for (const [index, turn] of run.turns.entries()) {
    const evidence = path.join(run.runDir, turn.evidenceDir);
    const expected = [
      ...(index === 0 ? ['실행 결과 폴더: `' + run.runDir + '`'] : []),
      '이번 턴 증거 폴더: `' + evidence + '`',
      ...(index === 0 ? ['', '필수 배경지식: `' + path.join(f.routine, 'workflow/context.md') + '`'] : []),
      '이번 턴에서는 다음 단계만 수행하세요: `' + path.join(f.routine, 'workflow/steps', turn.step + '.md') + '`',
      '',
    ].join('\n');
    assert.equal(calls[index].at(-1), expected);
    assert.ok(fs.statSync(evidence).isDirectory());
    if (index === 0) assert.equal(calls[index][0], 'exec');
    else {
      assert.deepEqual(calls[index].slice(0, 2), ['session', 'resume']);
      assert.equal(calls[index][4], run.sessionId);
    }
  }
});

test('CLI 원문은 메모리에서만 판독하고 영구 결과와 출력에는 구조화된 상태만 남김', () => {
  const marker = 'PRIVATE_RENDERED_TRACE_NOT_FOR_STORAGE';
  const f = fixture([{ value: '운영중', message: marker }, ...success().slice(1)]);
  const out = spawnSync(process.execPath, [f.engine, 'u1', f.routine], { env: f.env, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const [run] = lines(out.stdout, 'ENGINE_RESULT=');
  const record = fs.readFileSync(path.join(run.runDir, 'run.json'), 'utf8');
  for (const text of [out.stdout, out.stderr, record]) assert.ok(!text.includes(marker));
  assert.deepEqual(run.turns.map(t => t.response), success().map(({value}) => ({value})));
  assert.equal(run.finishStatus, 'ok');
});

test('CLI 실패 stderr와 미승인 상태 값도 영구 실패 이유에 넣지 않음', () => {
  const marker = 'PRIVATE_CLI_FAILURE_TRACE';
  for (const value of [{exit:9,stderr:marker}, {value:marker}]) {
    const f=fixture([value]);
    const out=spawnSync(process.execPath,[f.engine,'u1',f.routine],{env:f.env,encoding:'utf8'});
    assert.equal(out.status,1);
    const [run]=lines(out.stdout,'ENGINE_RESULT=');
    assert.equal(run.finishStatus,'stopped');
    for(const text of [out.stdout,out.stderr,fs.readFileSync(path.join(run.runDir,'run.json'),'utf8')]) assert.ok(!text.includes(marker));
  }
});

test('폴더 밖을 가리키는 흐름 심볼릭 링크는 CLI 호출 전에 거부', {skip: process.platform === 'win32' && 'symlink privileges vary on Windows'}, () => {
  const f=fixture(success());
  const outside=path.join(f.dir,'outside.json');
  fs.copyFileSync(path.join(f.routine,'workflow/flow.json'),outside);
  fs.symlinkSync(outside,path.join(f.routine,'workflow/linked.json'));
  const out=spawnSync(process.execPath,[f.engine,'u1',f.routine,'workflow/linked.json'],{env:f.env,encoding:'utf8'});
  assert.notEqual(out.status,0);
  assert.deepEqual(readCalls(f.calls),[]);
});

test('macOS 정리 모듈은 입력과 경계를 검사하고 속성 하나만 제거함', {skip:process.platform!=='darwin'},()=>{
  const f=fixture(success()), helper=path.join(f.dir,'clear-quarantine.sh');
  const inside=path.join(f.dir,'owned'), outside=path.join(f.dir,'outside');
  fs.mkdirSync(inside);fs.mkdirSync(outside);
  const target=path.join(inside,'target'), control=path.join(outside,'control');
  fs.writeFileSync(target,'unchanged');fs.writeFileSync(control,'outside');
  const xattr=(args)=>{const r=spawnSync('/usr/bin/xattr',args,{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;};
  const invoke=(args,extra={})=>spawnSync('/bin/bash',[helper,...args],{encoding:'utf8',env:{...f.env,...extra}});
  assert.notEqual(invoke([]).status,0);assert.notEqual(invoke([path.join(f.dir,'missing')]).status,0);
  fs.symlinkSync(outside,path.join(inside,'link'));
  assert.notEqual(invoke([path.join(inside,'link','.')]).status,0);
  xattr(['-w','com.apple.quarantine','0081;00000000;AAC-test;',target]);
  xattr(['-w','test.aac.preserve','keep',target]);
  assert.equal(invoke([inside]).status,0);
  assert.ok(!xattr([target]).includes('com.apple.quarantine'));
  assert.equal(xattr(['-p','test.aac.preserve',target]).trim(),'keep');
  assert.equal(fs.readFileSync(target,'utf8'),'unchanged');assert.equal(fs.readFileSync(control,'utf8'),'outside');
  fs.linkSync(control,path.join(inside,'shared'));
  assert.notEqual(invoke([inside]).status,0);
  fs.unlinkSync(path.join(inside,'shared'));
  const bin=path.join(f.dir,'bin');fs.mkdirSync(bin);
  executable(path.join(bin,'find'),'#!/bin/sh\nexit 19\n');
  assert.notEqual(invoke([inside],{PATH:bin+':/usr/bin:/bin'}).status,0,'find failures must not become success');
});
test('정리 실패는 업무 상태를 보존하고 stopped로 반환함',{skip:process.platform!=='darwin'},()=>{
  const f=fixture(success());
  executable(path.join(f.dir,'clear-quarantine.sh'),'#!/bin/sh\nexit 17\n');
  const out=spawnSync(process.execPath,[f.engine,'u1',f.routine],{env:f.env,encoding:'utf8'});
  const [run]=lines(out.stdout,'ENGINE_RESULT=');
  assert.equal(out.status,1);assert.equal(run.finishStatus,'stopped');
  assert.equal(run.state.첫작업상태,'운영중');assert.equal(run.state.정리상태,'정리완료');
  assert.match(run.stop.detail,/격리 속성 정리 실패/);assert.equal(run.stop.step,'cleanup');
});
test('엔진은 runs 심볼릭 링크를 CLI 호출 전에 거부함',{skip:process.platform==='win32'},()=>{
  const f=fixture(success());const outside=path.join(f.dir,'outside');fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(f.routine,'runs'));
  const out=spawnSync(process.execPath,[f.engine,'u1',f.routine],{env:f.env,encoding:'utf8'});
  assert.notEqual(out.status,0);assert.deepEqual(readCalls(f.calls),[]);assert.deepEqual(fs.readdirSync(outside),[]);
});

test('후처리도 실패하면 최초 CLI 오류와 실패 단계를 보존함',{skip:process.platform!=='darwin'},()=>{
  const f=fixture([{exit:9}]);
  executable(path.join(f.dir,'clear-quarantine.sh'),'#!/bin/sh\nexit 17\n');
  const out=spawnSync(process.execPath,[f.engine,'u1',f.routine],{env:f.env,encoding:'utf8'});
  const [run]=lines(out.stdout,'ENGINE_RESULT=');
  assert.equal(out.status,1);assert.equal(run.stop.step,'task-a');
  assert.match(run.stop.detail,/Aside 실행 실패/);assert.match(run.stop.detail,/격리 속성 정리 실패: exit 17/);
  assert.deepEqual(run.state,initialState);
});

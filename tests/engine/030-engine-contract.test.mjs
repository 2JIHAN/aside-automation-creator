import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture, lines, readCalls, initialState, success, engineCase } from './test-helpers.mjs';
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

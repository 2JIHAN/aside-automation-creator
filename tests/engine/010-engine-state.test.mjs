import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture, lines, readCalls, initialState, success, engineCase } from './test-helpers.mjs';

for (const [prefix, expectedState] of [
  [['미노출'], { ...initialState, 첫작업상태: '미노출' }],
  [['운영중'], { ...initialState, 첫작업상태: '운영중' }],
  [['미노출', '운영중'], { ...initialState, 첫작업상태: '운영중' }]
]) {
  for (const value of [{ exit: 9 }, '설명만', { value: 'unexpected' }, { value: '__proto__' }, { value: 'toString' }]) {
    test('후속 오류는 이전 상태 보존: ' + JSON.stringify([prefix, value]), () => {
      const f = fixture([...prefix.map(result => ({ value: result })), value]);
      const out = spawnSync(process.execPath, [f.engine, 'u1', f.routine], { env: f.env, encoding: 'utf8' });
      assert.equal(out.status, 1);
      const [result] = lines(out.stdout, 'ENGINE_RESULT=');
      assert.equal(result.finishStatus, 'stopped');
      assert.deepEqual(result.state, { ...expectedState, 현재턴결과: prefix.at(-1) });
      assert.equal(result.turns.length, prefix.length + 1);
      assert.equal(readCalls(f.calls).length, prefix.length + 1);
    });
  }
}

test('새 실행은 이전 최종 상태를 이어받지 않음', () => {
  const f = fixture(success());
  const invoke = () => spawnSync(process.execPath, [f.engine, 'u1', f.routine], { env: f.env, encoding: 'utf8' });
  const first = invoke();
  assert.equal(first.status, 0);
  const [prior] = lines(first.stdout, 'ENGINE_RESULT=');
  assert.deepEqual(prior.state, { ...initialState, 첫작업상태: '운영중', 다음작업상태: '노출', 알림상태: '알림완료', 정리상태: '정리완료', 현재턴결과: '정리완료' });
  fs.writeFileSync(f.env.PLAN, JSON.stringify({ turns: [{ exit: 9 }] }));
  fs.unlinkSync(f.calls);
  const next = invoke();
  assert.equal(next.status, 1);
  const [fresh] = lines(next.stdout, 'ENGINE_RESULT=');
  assert.deepEqual(fresh.state, initialState);
  assert.notEqual(fresh.runDir, prior.runDir);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(prior.runDir, 'run.json'))).state, prior.state);
  assert.equal(readCalls(f.calls)[0][0], 'exec');
});

test('선언하지 않은 stateKey는 결과 저장 없이 중단', () => {
  const { f, out, run } = engineCase(['운영중'], flow => {
    flow.steps['task-a'].stateKey = '선언하지않은키';
  });
  assert.equal(out.status, 1);
  assert.equal(run.finishStatus, 'stopped');
  assert.deepEqual(run.state, initialState);
  assert.deepEqual(run.turns, []);
  assert.equal(readCalls(f.calls).length, 0);
});

for (const [current, when] of [
  ['미노출', { 첫작업상태: '운영중' }],
  ['운영중', { 첫작업상태: '미노출' }]
]) {
  test('현재턴결과와 업무 상태는 모두 일치해야 선택: ' + current + JSON.stringify(when), () => {
    const { f, out, run } = engineCase(['운영중'], flow => {
      flow.steps['task-a'].next = [{ when: { 현재턴결과: current, ...when }, finishWithStatus: 'ok' }];
    });
    assert.equal(out.status, 1);
    assert.equal(run.finishStatus, 'stopped');
    assert.deepEqual(run.state, initialState);
    assert.equal(readCalls(f.calls).length, 1);
  });
}
test('현재턴결과 미선언은 CLI 호출 전에 거부', () => {
  const { f, out, run } = engineCase(['운영중'], flow => {
    delete flow.initialState.현재턴결과;
  });
  assert.equal(out.status, 1);
  assert.equal(run.finishStatus, 'stopped');
  const { 현재턴결과, ...business } = initialState;
  assert.deepEqual(run.state, business);
  assert.deepEqual(run.turns, []);
  assert.equal(readCalls(f.calls).length, 0);
});

test('매 승인 턴은 현재턴결과와 해당 상태 키만 갱신하고 업무 상태를 보존', () => {
  const values = ['예외발생', '재확인', '운영중', '노출', '알림완료', '정리완료', '학습완료'];
  const business = { ...initialState };
  for (let n = 1; n <= values.length; n++) {
    const { out, run } = engineCase([...values.slice(0, n), { exit: 9 }]);
    assert.equal(out.status, n === values.length ? 0 : 1);
    const accepted = run.turns.filter(turn => turn.response);
    assert.equal(accepted.length, n);
    const last = accepted.at(-1);
    const key = { 'task-a': '첫작업상태', 'task-c': '다음작업상태', 'notify': '알림상태', review: '학습계기', 'close-tabs': '정리상태', learn: '학습상태' }[last.step];
    if (key) business[key] = last.response.value;
    business.현재턴결과 = last.response.value;
    assert.deepEqual(run.state, business);
    assert.equal(run.state.현재턴결과, values[n - 1]);
  }
});

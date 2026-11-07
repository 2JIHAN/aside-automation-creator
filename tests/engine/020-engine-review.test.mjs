import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { lines, readCalls, initialState, engineCase } from './test-helpers.mjs';

test('검토 복귀 대상이 없으면 이전 상태를 보존하고 추가 호출 없이 중단', () => {
  const { f, out, run } = engineCase(['재확인'], flow => { flow.startStep = 'review'; });
  assert.equal(out.status, 1);
  assert.equal(run.finishStatus, 'stopped');
  assert.deepEqual(run.state, initialState);
  assert.equal(readCalls(f.calls).length, 1);
  assert.ok(!Object.hasOwn(run.turns.at(-1), 'response'));
});

test('공용 검토 중 또 호출자를 기억하려는 단계는 이전 상태 보존 후 중단', () => {
  const { f, out, run } = engineCase(['예외발생', '재확인'], flow => {
    flow.steps.review.next = [{ when: { 현재턴결과: '재확인' }, step: 'nested-review' }];
    flow.steps['nested-review'] = { ...flow.steps.review };
  });
  assert.equal(out.status, 1);
  assert.equal(run.finishStatus, 'stopped');
  assert.deepEqual(run.state, { ...initialState, 첫작업상태: '예외발생', 현재턴결과: '예외발생' });
  assert.equal(readCalls(f.calls).length, 2);
});

test('새 실행에서는 이전 실행의 재확인 한도를 이어받지 않음', () => {
  const values = ['예외발생', '재확인', '예외발생', '재확인', '운영중', '노출', '알림완료', '정리완료', '학습완료'];
  const { f, out, run } = engineCase(values);
  assert.equal(out.status, 0, out.stderr);
  const second = spawnSync(process.execPath, [f.engine, 'u1', f.routine], { env: { ...f.env, CALLS: path.join(f.dir, 'second-calls.jsonl') }, encoding: 'utf8', timeout: 10000 });
  assert.equal(second.status, 0, second.stderr);
  const [fresh] = lines(second.stdout, 'ENGINE_RESULT=');
  assert.equal(run.finishStatus, 'ok');
  assert.equal(fresh.finishStatus, 'ok');
  assert.notEqual(run.runDir, fresh.runDir);
  assert.ok(fresh.turns.every(t => !t.recheckLimit));
});

test('직접 종료도 진행 중인 검토 복귀 정보를 정리함', () => {
  const { out, run } = engineCase(['예외발생', '해결불가'], flow => {
    flow.steps.review.next = [{ when: { 현재턴결과: '해결불가' }, finishWithStatus: 'incomplete' }];
  });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(run.finishStatus, 'incomplete');
  assert.equal(run.turns.at(-1).finishStatus, 'incomplete');
  assert.ok(!Object.hasOwn(run, 'returnStep'));
});


test('재확인 한도의 유효값 해결불가는 현재턴결과에 저장하고 원문은 유지', () => {
  const { out, run } = engineCase(['예외발생', '재확인', '예외발생', '재확인', '예외발생', '재확인', { exit: 9 }]);
  assert.equal(out.status, 1);
  assert.deepEqual(run.state, { ...initialState, 첫작업상태: '예외발생', 학습계기: '해결불가', 현재턴결과: '해결불가' });
  const limited = run.turns.at(-2);
  assert.equal(limited.response.value, '해결불가');
  assert.equal(limited.response.text, '상태: 재확인');
  assert.equal(limited.recheckLimit.reportedValue, '재확인');
});

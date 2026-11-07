import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, records, execute, initial } from './test-helpers.mjs';

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

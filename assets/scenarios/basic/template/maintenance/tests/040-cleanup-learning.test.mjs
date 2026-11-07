import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root, fixture, records, execute } from './test-helpers.mjs';

const scenarios = [
  ['완료은 학습 생략', ['완료', '알림완료', '정리완료'], 'ok', { 업무상태: '완료', 알림상태: '알림완료', 정리상태: '정리완료' }],
  ['업무 복구 후 학습', ['실패', '재확인', '완료', '알림완료', '정리완료', '학습완료'], 'ok', { 업무상태: '완료', 알림상태: '알림완료', 학습계기: '재확인', 정리상태: '정리완료', 학습상태: '학습완료' }],
  ['인계 결과 보존', ['실패', '해결불가', '알림완료', '정리완료', '학습완료'], 'handed_off', { 업무상태: '실패', 알림상태: '알림완료', 학습계기: '해결불가', 정리상태: '정리완료', 학습상태: '학습완료' }],
  ['알림 재시도 성공', ['완료', '알림불가', '재확인', '알림완료', '정리완료', '학습완료'], 'ok', { 업무상태: '완료', 알림상태: '알림완료', 알림검토결과: '재확인', 정리상태: '정리완료', 학습상태: '학습완료' }],
  ['알림 재시도 실패는 다시 검토하지 않음', ['완료', '알림불가', '재확인', '알림불가', '정리완료', '학습완료'], 'incomplete', { 업무상태: '완료', 알림상태: '알림불가', 알림검토결과: '재확인', 정리상태: '정리완료', 학습상태: '학습완료' }],
  ['알림 해결불가', ['완료', '알림불가', '해결불가', '정리완료', '학습완료'], 'incomplete', { 업무상태: '완료', 알림상태: '알림불가', 알림검토결과: '해결불가', 정리상태: '정리완료', 학습상태: '학습완료' }],
  ['정리 실패', ['완료', '알림완료', '정리불가', '학습완료'], 'incomplete', { 업무상태: '완료', 알림상태: '알림완료', 정리상태: '정리불가', 학습상태: '학습완료' }]
];

for (const [name, values, status] of scenarios.filter(row => row[1].at(-1) === '학습완료')) {
  test(name + ' 중 학습불가도 원래 결과 보존', () => {
    const f = fixture([...values.slice(0, -1), '학습불가']);
    const { out, run } = execute(f);
    assert.equal(out.status, 0, out.stderr); assert.equal(run.finishStatus, status);
    assert.equal(run.state.학습상태, '학습불가');
    assert.equal(run.turns.at(-1).step, 'learn');
  });
}
for (const bad of [{ exit: 9 }, { raw: '설명만' }, { raw: '상태: 없는값' }]) {
  test('학습 기술 오류는 성공으로 덮지 않음: ' + JSON.stringify(bad), () => {
    const f = fixture(['실패', '해결불가', '알림완료', '정리완료', bad]);
    const { out, run } = execute(f);
    assert.equal(out.status, 1); assert.equal(run.finishStatus, 'stopped');
    assert.equal(run.stop.step, 'learn'); assert.equal(run.state.업무상태, '실패');
    assert.equal(run.state.알림상태, '알림완료'); assert.equal(run.state.정리상태, '정리완료');
    assert.equal(run.state.학습상태, '미실행'); assert.equal(records(f.calls).length, 5);
  });
}
for (const cause of ['후보시험', '해결불가']) {
  test('선택된 학습계기 경로: ' + cause, () => {
    const f = fixture(['정리완료', '학습완료']);
    const file = path.join(f.routine, 'workflow/flow.json');
    const flow = JSON.parse(fs.readFileSync(file, 'utf8'));
    flow.startStep = 'cleanup';
    Object.assign(flow.initialState, { 업무상태: '완료', 알림상태: '알림완료', 학습계기: cause });
    fs.writeFileSync(file, JSON.stringify(flow));
    const { out, run } = execute(f);
    assert.equal(out.status, 0, out.stderr); assert.equal(run.finishStatus, 'ok');
    assert.deepEqual(run.turns.map(t => t.step), ['cleanup', 'learn']);
    assert.equal(run.state.학습계기, cause); assert.equal(run.state.학습상태, '학습완료');
    assert.equal(fs.readFileSync(path.join(f.routine, 'workflow/memory.md'), 'utf8'), fs.readFileSync(path.join(root, 'workflow/memory.md'), 'utf8'));
  });
}

test('학습 기술 오류에도 성공한 업무 상태와 결과 증거를 유지', () => {
  const { run } = execute(fixture(['실패', '재확인', '완료', '알림완료', '정리완료', { exit: 9 }]));
  assert.equal(run.finishStatus, 'stopped');
  assert.equal(run.stop.step, 'learn');
  assert.equal(run.state.업무상태, '완료');
  assert.equal(run.state.알림상태, '알림완료');
  assert.equal(run.state.정리상태, '정리완료');
});
test('학습은 사용자 승인 범위를 확인한 뒤 수행한다는 정적 계약', () => {
  const text = fs.readFileSync(path.join(root, 'workflow/steps/learn.md'), 'utf8');
  assert.match(text, /학습이 금지됐거나 범위가 미확정이면 지침과 메모리를 바꾸지 않습니다/);
  assert.match(text, /현재 실행 증거에 미수행 이유/);
  assert.match(text, /정식 원문을 보관/);
  assert.match(text, /되돌립니다/);
  assert.match(text, /학습 지침과 `learn` 단계의 권한 및 진입 조건은 바꾸지 않습니다/);
});

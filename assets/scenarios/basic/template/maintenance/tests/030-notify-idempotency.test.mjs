import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root, fixture, execute } from './test-helpers.mjs';

// 전송 자체를 구현하지 않는다. 지침 계약과 모의 상태의 엔진 경로만 검사한다.
test('전송 여부 불명확은 재전송 대신 정리와 학습으로 이동', () => {
  const { run } = execute(fixture(['완료', '알림불가', '해결불가', '정리완료', '학습완료']));
  assert.equal(run.finishStatus, 'incomplete');
  assert.deepEqual(run.turns.map(t => t.step), ['work', 'notify', 'review-notify', 'cleanup', 'learn']);
});
test('중복 방지와 검토의 전송 금지 계약', () => {
  const notify = fs.readFileSync(path.join(root, 'workflow/steps/notify.md'), 'utf8');
  const review = fs.readFileSync(path.join(root, 'workflow/steps/review.md'), 'utf8');
  for (const clause of ['이미 보냈으면', '보내지 않았다는 것이 확실할 때만', '전송 여부가 불명확하면 재전송하지 않습니다', '전송 직전에 시도 기록', '증거만 보완']) assert.ok(notify.includes(clause), clause);
  assert.match(review, /편집이나 재전송 없이 해결불가/);
  assert.match(review, /알림이나 자원 정리는 이 단계에서 미리 하지 않습니다/);
});

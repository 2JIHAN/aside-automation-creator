import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { engine, fixture, records, execute, initial } from './test-helpers.mjs';

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
test('시나리오 경로 없는 직접 호출은 실행 전에 거부', () => {
  const f = fixture([]);
  const out = spawnSync(process.execPath, [path.join(f.env.ASIDE_AUTOMATION_CREATOR_REPO, 'engine.mjs'), 'u7'], { env: f.env, encoding: 'utf8' });
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /scenario-folder/);
  assert.equal(records(f.calls).length, 0);
});

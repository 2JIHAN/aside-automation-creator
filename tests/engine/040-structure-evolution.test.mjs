import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fixture, lines } from './test-helpers.mjs';

const single = {
  contextFile: 'workflow/context.md', startStep: 'work',
  initialState: { 현재턴결과: '미확인', 업무상태: '미확인' },
  steps: { work: { instructionFile: 'workflow/steps/work.md', stateKey: '업무상태', next: [{ when: { 현재턴결과: '완료' }, finishWithStatus: 'ok' }] } },
};
const split = {
  ...single, startStep: 'prepare',
  steps: {
    prepare: { instructionFile: 'workflow/steps/prepare.md', next: [{ when: { 현재턴결과: '준비완료' }, step: 'work' }] },
    ...single.steps,
  },
};

function prepare(flow, values) {
  const f = fixture(values.map(value => ({ value })));
  fs.writeFileSync(path.join(f.routine, 'workflow/flow.json'), JSON.stringify(flow));
  for (const step of Object.values(flow.steps)) fs.writeFileSync(path.join(f.routine, step.instructionFile), 'Mock instruction');
  return f;
}
function execute(f) {
  const out = spawnSync(process.execPath, [f.engine, 'u1', f.routine], { env: f.env, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const [run] = lines(out.stdout, 'ENGINE_RESULT=');
  return run;
}

for (const [name, flow, values, steps] of [
  ['통합한 단일 스텝', single, ['완료'], ['work']],
  ['준비와 작업으로 분리한 스텝', split, ['준비완료', '완료'], ['prepare', 'work']],
]) {
  test('엔진은 구조를 바꾼 flow를 읽고 완료 상태를 보존: ' + name, () => {
    const run = execute(prepare(flow, values));
    assert.equal(run.finishStatus, 'ok');
    assert.deepEqual(run.state, { 현재턴결과: '완료', 업무상태: '완료' });
    assert.deepEqual(run.turns.map(t => t.step), steps);
  });
}

for (const [value, steps] of [['준비완료', ['prepare', 'work']], ['추가확인', ['prepare', 'extra', 'work']]]) {
  test('엔진은 새 조건 분기의 해당 경로만 실행: ' + value, () => {
    const flow = structuredClone(split);
    flow.steps.prepare.next.push({ when: { 현재턴결과: '추가확인' }, step: 'extra' });
    flow.steps.extra = { instructionFile: 'workflow/steps/extra.md', next: [{ when: { 현재턴결과: '확인완료' }, step: 'work' }] };
    const run = execute(prepare(flow, [value, ...(value === '추가확인' ? ['확인완료'] : []), '완료']));
    assert.equal(run.finishStatus, 'ok');
    assert.deepEqual(run.turns.map(t => t.step), steps);
    assert.deepEqual(run.state, { 현재턴결과: '완료', 업무상태: '완료' });
  });
}

test('실행 중 파일을 바꿔도 현재 실행은 읽어 둔 flow를 유지하고 다음 실행부터 새 구조 사용', () => {
  const f = prepare(single, ['완료']);
  fs.writeFileSync(path.join(f.routine, 'workflow/steps/prepare.md'), 'Mock preparation');
  const plan = JSON.parse(fs.readFileSync(f.env.PLAN));
  plan.nextFlow = split;
  plan.flowFile = path.join(f.routine, 'workflow/flow.json');
  fs.writeFileSync(f.env.PLAN, JSON.stringify(plan));
  const cli = f.env.ASIDE_CLI_PATH;
  const original = fs.readFileSync(cli, 'utf8');
  const target = 'const value = plan.turns[i];';
  assert.ok(original.includes(target));
  fs.writeFileSync(cli, original.replace(target, target + '\nif(i===0 && plan.nextFlow) fs.writeFileSync(plan.flowFile,JSON.stringify(plan.nextFlow));'));
  if (process.platform === 'darwin') {
    if (execFileSync('/usr/bin/xattr', [cli], { encoding: 'utf8' }).includes('com.apple.quarantine')) execFileSync('/usr/bin/xattr', ['-d', 'com.apple.quarantine', cli]);
    assert.ok(!execFileSync('/usr/bin/xattr', [cli], { encoding: 'utf8' }).includes('com.apple.quarantine'));
  }
  const current = execute(f);
  assert.deepEqual(current.turns.map(t => t.step), ['work']);
  fs.writeFileSync(f.env.PLAN, JSON.stringify({ turns: [{ value: '준비완료' }, { value: '완료' }] }));
  fs.unlinkSync(f.calls);
  const next = execute(f);
  assert.deepEqual(next.turns.map(t => t.step), ['prepare', 'work']);
  assert.equal(next.finishStatus, 'ok');
});
